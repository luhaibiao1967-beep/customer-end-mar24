-- Replace the permissive ACL/RLS inherited from the historical remote schema.
-- Customer sessions are custom opaque tokens validated by Edge Functions, so
-- the browser only needs anonymous read access to the three public catalog
-- tables below.  Staff use Supabase Auth and are constrained by role + branch.

BEGIN;

-- Clients may resolve explicitly granted objects, but may never create or
-- shadow objects in the API schema.
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Secure-by-default for every object created by later migrations.  Each new
-- client-facing table/function must opt in with an explicit grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- Remove anonymous access from every existing public relation/function, not
-- just the objects known by this snapshot.  This also covers objects added by
-- the shared operations application before this migration is deployed.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM authenticated;

DO $$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS identity
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function.identity
    );
  END LOOP;
END;
$$;

-- The operations report RPCs used to be SECURITY DEFINER and trusted their
-- caller-supplied branch (including "All").  Run them as the caller instead;
-- the orders/customers/order_items RLS policies then remain authoritative.
-- The historical trend function also treated the literal HQ branch "All" as
-- a real branch name, which produced an empty dashboard.  RLS still limits a
-- branch-scoped caller, so omitting the branch predicate only for "All" is
-- both safe and compatible with the existing headquarters UI.
CREATE OR REPLACE FUNCTION public.get_trend_stats(
  p_branch text,
  p_year integer,
  p_month integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'daily', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'date', to_char(day_series.d, 'YYYY-MM-DD'),
          'gallons', COALESCE(a.gallons, 0),
          'revenue', COALESCE(a.revenue, 0)
        ) ORDER BY day_series.d
      ), '[]'::jsonb)
      FROM generate_series(
        make_date(p_year, p_month, 1),
        (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date,
        interval '1 day'
      ) AS day_series(d)
      LEFT JOIN (
        SELECT
          date(o.created_at AT TIME ZONE 'Asia/Jakarta') AS day_date,
          COALESCE(SUM(oi.quantity) FILTER (
            WHERE (
              lower(oi.product) LIKE '%gallon%'
              OR lower(oi.product) LIKE '%galon%'
              OR oi.product ~* '\d+\s*(l|liter|litre)'
            )
            AND lower(oi.product) NOT LIKE '%empty%'
            AND lower(oi.product) NOT LIKE '%collection%'
          ), 0) AS gallons,
          COALESCE(
            SUM(oi.quantity * (oi.unit_price - COALESCE(oi.discount, 0))),
            0
          ) AS revenue
        FROM public.orders AS o
        JOIN public.order_items AS oi ON oi.order_id = o.id
        WHERE (p_branch = 'All' OR o.branch = p_branch)
          AND extract(year FROM o.created_at AT TIME ZONE 'Asia/Jakarta') = p_year
          AND extract(month FROM o.created_at AT TIME ZONE 'Asia/Jakarta') = p_month
          AND o.status = 'delivered'
          AND o.is_active IS TRUE
        GROUP BY date(o.created_at AT TIME ZONE 'Asia/Jakarta')
      ) AS a ON a.day_date = day_series.d
    ),
    'monthly', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'month', month_series.m,
          'gallons', COALESCE(a.gallons, 0),
          'revenue', COALESCE(a.revenue, 0)
        ) ORDER BY month_series.m
      ), '[]'::jsonb)
      FROM generate_series(1, 12) AS month_series(m)
      LEFT JOIN (
        SELECT
          extract(month FROM o.created_at AT TIME ZONE 'Asia/Jakarta')::integer
            AS month_num,
          COALESCE(SUM(oi.quantity) FILTER (
            WHERE (
              lower(oi.product) LIKE '%gallon%'
              OR lower(oi.product) LIKE '%galon%'
              OR oi.product ~* '\d+\s*(l|liter|litre)'
            )
            AND lower(oi.product) NOT LIKE '%empty%'
            AND lower(oi.product) NOT LIKE '%collection%'
          ), 0) AS gallons,
          COALESCE(
            SUM(oi.quantity * (oi.unit_price - COALESCE(oi.discount, 0))),
            0
          ) AS revenue
        FROM public.orders AS o
        JOIN public.order_items AS oi ON oi.order_id = o.id
        WHERE (p_branch = 'All' OR o.branch = p_branch)
          AND extract(year FROM o.created_at AT TIME ZONE 'Asia/Jakarta') = p_year
          AND o.status = 'delivered'
          AND o.is_active IS TRUE
        GROUP BY extract(month FROM o.created_at AT TIME ZONE 'Asia/Jakarta')::integer
      ) AS a ON a.month_num = month_series.m
    )
  );
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.get_trend_stats(text, integer, integer)
  FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_identity regprocedure;
BEGIN
  FOREACH v_identity IN ARRAY ARRAY[
    to_regprocedure('public.get_borrowed_customers_with_last_order(text)'),
    to_regprocedure('public.get_churn_candidates(text)'),
    to_regprocedure('public.get_customer_activity(text,integer)'),
    to_regprocedure('public.get_top_customers(text,integer,integer)'),
    to_regprocedure('public.get_trend_stats(text,integer,integer)')
  ]
  LOOP
    IF v_identity IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SECURITY INVOKER', v_identity);
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path = pg_catalog, public',
        v_identity
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO authenticated',
        v_identity
      );
    END IF;
  END LOOP;
END;
$$;

-- Columns used by the current applications but absent from the oldest
-- customer-portal snapshot.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS initial_borrowed_gallons integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_borrowed_gallons integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credit_limit numeric,
  ADD COLUMN IF NOT EXISTS service_branch text;

ALTER TABLE public.customer_product_vouchers
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- One non-recursive identity helper is used by every staff policy.  The owner
-- bypasses profiles RLS; callers can only obtain their own staff context.
CREATE OR REPLACE FUNCTION public.current_staff_context()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_build_object(
        'id', p.id,
        'role', p.role,
        'branch', p.branch,
        'status', p.status
      )
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
      LIMIT 1
    ),
    '{}'::jsonb
  );
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.current_staff_context()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_staff_context()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.status = 'active'
  );
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.current_user_is_admin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin()
  TO authenticated, service_role;

-- The login page resolves a username before a Supabase Auth session exists.
-- Keep this deliberately narrow: no id, role, branch, phone, or auth metadata.
CREATE OR REPLACE FUNCTION public.lookup_login_profile(p_username text)
RETURNS TABLE(email text, username text, name text, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.email, p.username, p.name, p.status
  FROM public.profiles AS p
  WHERE lower(p.username) = lower(btrim(p_username))
  LIMIT 1;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.lookup_login_profile(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_login_profile(text)
  TO anon, authenticated, service_role;

-- The historical function let any anonymous caller rotate an arbitrary
-- customer's token and receive the replacement.  Keep the compatibility RPC
-- for trusted backend jobs only, with an in-body role check as defence in depth.
CREATE OR REPLACE FUNCTION public.regenerate_auth_token(customer_id_param uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_token uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  UPDATE public.customers
  SET auth_token = gen_random_uuid(),
      token_created_at = now()
  WHERE id = customer_id_param
    AND is_active IS TRUE
  RETURNING auth_token INTO v_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  RETURN v_token;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.regenerate_auth_token(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regenerate_auth_token(uuid) TO service_role;

-- Retain the two legacy global-voucher helpers only for backend compatibility.
-- In particular, a non-positive deduction must never mint a balance.
CREATE OR REPLACE FUNCTION public.check_voucher_balance(
  p_customer_id uuid,
  p_vouchers_needed integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_balance integer;
  v_customer_type text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_vouchers_needed IS NULL OR p_vouchers_needed <= 0 THEN
    RAISE EXCEPTION 'VOUCHER_QUANTITY_INVALID';
  END IF;

  SELECT c.voucher_balance, c.customer_type::text
    INTO v_balance, v_customer_type
  FROM public.customers AS c
  WHERE c.id = p_customer_id
    AND c.is_active IS TRUE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_customer_type = 'later_pay' THEN
    RETURN true;
  END IF;
  RETURN COALESCE(v_balance, 0) >= p_vouchers_needed;
END;
$$;

CREATE OR REPLACE FUNCTION public.deduct_vouchers(
  p_customer_id uuid,
  p_vouchers integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_customer_type text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF p_vouchers IS NULL OR p_vouchers <= 0 THEN
    RAISE EXCEPTION 'VOUCHER_QUANTITY_INVALID';
  END IF;

  SELECT c.customer_type::text
    INTO v_customer_type
  FROM public.customers AS c
  WHERE c.id = p_customer_id
    AND c.is_active IS TRUE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_customer_type = 'later_pay' THEN
    RETURN true;
  END IF;

  UPDATE public.customers
  SET voucher_balance = voucher_balance - p_vouchers,
      updated_at = now()
  WHERE id = p_customer_id
    AND COALESCE(voucher_balance, 0) >= p_vouchers;
  RETURN FOUND;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.check_voucher_balance(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.deduct_vouchers(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_voucher_balance(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_vouchers(uuid, integer) TO service_role;

DO $$
DECLARE
  v_identity regprocedure;
BEGIN
  FOREACH v_identity IN ARRAY ARRAY[
    to_regprocedure('public.delete_old_otps()'),
    to_regprocedure('public.refresh_customer_current_borrowed(uuid)')
  ]
  LOOP
    IF v_identity IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        v_identity
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION %s TO service_role',
        v_identity
      );
    END IF;
  END LOOP;
END;
$$;

-- The existing orders AFTER trigger calls the service-only refresh helper.
-- Run the trigger body with its trusted owner so ordinary authenticated order
-- writes do not fail after the helper is removed from the client RPC surface.
DO $$
DECLARE
  v_identity regprocedure :=
    to_regprocedure('public.trigger_refresh_customer_borrowed_on_order_change()');
BEGIN
  IF v_identity IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_identity);
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = pg_catalog, public',
      v_identity
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_identity
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      v_identity
    );
  END IF;
END;
$$;

-- Rebuild every client-facing policy on the security-critical tables.  RLS
-- policies are permissive/ORed, so leaving one historical PUBLIC policy would
-- silently defeat the new restrictions.
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_product_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_whatsapp_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hq_midtrans_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.midtrans_reconciliation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.otp_send_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'app_settings',
        'auth_otps',
        'billing_reminders',
        'branch_costs',
        'branch_midtrans_transfers',
        'branch_settlement_records',
        'branches',
        'customer_product_vouchers',
        'customers',
        'device_whatsapp_bindings',
        'hq_midtrans_settlements',
        'midtrans_reconciliation_events',
        'order_corrections',
        'order_items',
        'orders',
        'otp_send_log',
        'payment_transactions',
        'product_variants',
        'products',
        'profiles',
        'system_configs',
        'trips',
        'voucher_packages',
        'voucher_purchase_requests',
        'voucher_usage_ledger',
        'whatsapp_messages'
      )
      AND roles::text[] && ARRAY['public', 'anon', 'authenticated']::text[]
      -- The 1600 migration owns the canonical authenticated INSERT/UPDATE/DELETE
      -- policies for orders and order_items.  Remove only historical read/ALL
      -- policies here so this ACL pass cannot silently disable order creation.
      AND (
        tablename NOT IN ('orders', 'order_items')
        OR cmd IN ('ALL', 'SELECT')
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END;
$$;

-- Clear inherited ALL grants before restoring only actual browser operations.
REVOKE ALL PRIVILEGES ON TABLE public.app_settings FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.auth_otps FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.branches FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customer_product_vouchers FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.customers FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.device_whatsapp_bindings FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.hq_midtrans_settlements FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.midtrans_reconciliation_events FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.order_items FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.orders FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.otp_send_log FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.payment_transactions FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.products FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.trips FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.voucher_packages FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.voucher_purchase_requests FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.voucher_usage_ledger FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.whatsapp_messages FROM authenticated;

GRANT ALL PRIVILEGES ON TABLE public.app_settings TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.auth_otps TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.branches TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.customer_product_vouchers TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.customers TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.device_whatsapp_bindings TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.hq_midtrans_settlements TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.midtrans_reconciliation_events TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.order_items TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.orders TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.otp_send_log TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.payment_transactions TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.products TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.profiles TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.trips TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.voucher_packages TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.voucher_purchase_requests TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.voucher_usage_ledger TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.whatsapp_messages TO service_role;

-- order_corrections belongs to the operations application and is absent from
-- the oldest customer-portal-only schema.  When present, restore only the two
-- browser verbs used by the correction workflow; updates/deletes remain
-- backend-only so the audit trail is append-only for staff.
DO $$
BEGIN
  IF to_regclass('public.order_corrections') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.order_corrections ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.order_corrections FROM authenticated';
    EXECUTE
      'GRANT SELECT, INSERT ON TABLE public.order_corrections TO authenticated';
    EXECUTE
      'GRANT ALL PRIVILEGES ON TABLE public.order_corrections TO service_role';
  END IF;
END;
$$;

-- Optional operations-application tables are not present in the oldest
-- customer-only schema.  Their historical policies and inherited table ACLs
-- were broader than the current UI requires, so rebuild each boundary when
-- the table exists in the shared staging database.
DO $ops$
BEGIN
  IF to_regclass('public.billing_reminders') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.billing_reminders ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.billing_reminders FROM authenticated';
    EXECUTE
      'GRANT ALL PRIVILEGES ON TABLE public.billing_reminders TO service_role';
    EXECUTE $grant$
      GRANT SELECT (
        id, customer_id, reminder_type, period_key,
        attempt, sent_at, sent_by_name
      )
        ON TABLE public.billing_reminders TO authenticated
    $grant$;
    EXECUTE $grant$
      GRANT INSERT (
        customer_id, branch, reminder_type, period_key, attempt,
        sent_by_id, sent_by_name, order_ids, total_amount, message_text
      ) ON TABLE public.billing_reminders TO authenticated
    $grant$;
    EXECUTE $policy$
      CREATE POLICY staff_read_billing_reminders
        ON public.billing_reminders FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'sales', 'finance'
          )
          AND public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
          AND branch = public.current_staff_context()->>'branch'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY staff_insert_billing_reminders
        ON public.billing_reminders FOR INSERT TO authenticated
        WITH CHECK (
          sent_by_id = auth.uid()
          AND public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'sales', 'finance'
          )
          AND public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
          AND branch = public.current_staff_context()->>'branch'
          AND cardinality(billing_reminders.order_ids) > 0
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(billing_reminders.order_ids) AS requested(order_id)
            WHERE NOT EXISTS (
              SELECT 1
              FROM public.orders AS o
              WHERE o.id = requested.order_id
                AND o.customer_id = billing_reminders.customer_id
                AND o.branch = billing_reminders.branch
            )
          )
        )
    $policy$;
  END IF;

  IF to_regclass('public.branch_costs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.branch_costs ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.branch_costs FROM authenticated';
    EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.branch_costs TO service_role';
    EXECUTE $grant$
      GRANT SELECT (branch, year, month, category, item, amount, note)
        ON TABLE public.branch_costs TO authenticated
    $grant$;
    EXECUTE $grant$
      GRANT INSERT (
        branch, year, month, category, item, amount, note, created_by, updated_at
      ) ON TABLE public.branch_costs TO authenticated
    $grant$;
    EXECUTE $grant$
      GRANT UPDATE (
        branch, year, month, category, item, amount, note, created_by, updated_at
      ) ON TABLE public.branch_costs TO authenticated
    $grant$;
    EXECUTE $policy$
      CREATE POLICY staff_read_branch_costs
        ON public.branch_costs FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'finance', 'admin', 'branch_admin'
          )
          AND (
            public.current_staff_context()->>'role' = 'admin'
            OR (
              public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
              AND branch = public.current_staff_context()->>'branch'
            )
          )
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY staff_insert_branch_costs
        ON public.branch_costs FOR INSERT TO authenticated
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'finance', 'admin', 'branch_admin'
          )
          AND (
            public.current_staff_context()->>'role' = 'admin'
            OR (
              public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
              AND branch = public.current_staff_context()->>'branch'
            )
          )
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY staff_update_branch_costs
        ON public.branch_costs FOR UPDATE TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'finance', 'admin', 'branch_admin'
          )
          AND (
            public.current_staff_context()->>'role' = 'admin'
            OR (
              public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
              AND branch = public.current_staff_context()->>'branch'
            )
          )
        )
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'finance', 'admin', 'branch_admin'
          )
          AND (
            public.current_staff_context()->>'role' = 'admin'
            OR (
              public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
              AND branch = public.current_staff_context()->>'branch'
            )
          )
        )
    $policy$;
  END IF;

  IF to_regclass('public.branch_midtrans_transfers') IS NOT NULL THEN
    EXECUTE
      'ALTER TABLE public.branch_midtrans_transfers ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.branch_midtrans_transfers FROM authenticated';
    EXECUTE
      'GRANT ALL PRIVILEGES ON TABLE public.branch_midtrans_transfers TO service_role';
    EXECUTE
      'GRANT SELECT ON TABLE public.branch_midtrans_transfers TO authenticated';
    EXECUTE $grant$
      GRANT INSERT (
        branch, year, month, voucher_gross, direct_qris_gross,
        midtrans_fee, net_amount, status, transfer_date,
        transferred_by, note, updated_at
      ) ON TABLE public.branch_midtrans_transfers TO authenticated
    $grant$;
    EXECUTE $grant$
      GRANT UPDATE (
        branch, year, month, voucher_gross, direct_qris_gross,
        midtrans_fee, net_amount, status, transfer_date,
        transferred_by, note, updated_at
      ) ON TABLE public.branch_midtrans_transfers TO authenticated
    $grant$;
    EXECUTE $policy$
      CREATE POLICY active_admin_fin_read_branch_midtrans_transfers
        ON public.branch_midtrans_transfers FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY active_admin_fin_insert_branch_midtrans_transfers
        ON public.branch_midtrans_transfers FOR INSERT TO authenticated
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY active_admin_fin_update_branch_midtrans_transfers
        ON public.branch_midtrans_transfers FOR UPDATE TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
    $policy$;
  END IF;

  IF to_regclass('public.branch_settlement_records') IS NOT NULL THEN
    EXECUTE
      'ALTER TABLE public.branch_settlement_records ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.branch_settlement_records FROM authenticated';
    EXECUTE
      'GRANT ALL PRIVILEGES ON TABLE public.branch_settlement_records TO service_role';
    EXECUTE
      'GRANT SELECT ON TABLE public.branch_settlement_records TO authenticated';
    EXECUTE $grant$
      GRANT INSERT (
        branch, year, month, total_orders, gross_amount, platform_fee,
        net_amount, status, paid_date, paid_by, note, updated_at
      ) ON TABLE public.branch_settlement_records TO authenticated
    $grant$;
    EXECUTE $grant$
      GRANT UPDATE (
        branch, year, month, total_orders, gross_amount, platform_fee,
        net_amount, status, paid_date, paid_by, note, updated_at
      ) ON TABLE public.branch_settlement_records TO authenticated
    $grant$;
    EXECUTE $policy$
      CREATE POLICY active_admin_fin_read_branch_settlement_records
        ON public.branch_settlement_records FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY active_admin_fin_insert_branch_settlement_records
        ON public.branch_settlement_records FOR INSERT TO authenticated
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY active_admin_fin_update_branch_settlement_records
        ON public.branch_settlement_records FOR UPDATE TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'adminFin'
        )
    $policy$;
  END IF;

  IF to_regclass('public.product_variants') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.product_variants FROM authenticated';
    EXECUTE
      'GRANT ALL PRIVILEGES ON TABLE public.product_variants TO service_role';
    EXECUTE 'GRANT SELECT ON TABLE public.product_variants TO authenticated';
    EXECUTE $grant$
      GRANT UPDATE (qty, price, label, is_active, description, updated_at)
        ON TABLE public.product_variants TO authenticated
    $grant$;
    EXECUTE $policy$
      CREATE POLICY active_admin_read_product_variants
        ON public.product_variants FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'admin'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY active_admin_update_product_variants
        ON public.product_variants FOR UPDATE TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'admin'
        )
        WITH CHECK (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'admin'
        )
    $policy$;
  END IF;

  IF to_regclass('public.system_configs') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.system_configs ENABLE ROW LEVEL SECURITY';
    EXECUTE
      'REVOKE ALL PRIVILEGES ON TABLE public.system_configs FROM authenticated';
    EXECUTE 'GRANT ALL PRIVILEGES ON TABLE public.system_configs TO service_role';
    EXECUTE 'GRANT SELECT ON TABLE public.system_configs TO authenticated';
    EXECUTE $grant$
      GRANT UPDATE (config_value, updated_by, updated_at)
        ON TABLE public.system_configs TO authenticated
    $grant$;
    EXECUTE $policy$
      CREATE POLICY active_admin_read_system_configs
        ON public.system_configs FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'admin'
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY active_admin_update_system_configs
        ON public.system_configs FOR UPDATE TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'admin'
        )
        WITH CHECK (
          updated_by = auth.uid()
          AND public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' = 'admin'
        )
    $policy$;
  END IF;
END;
$ops$;

-- Public catalog: active branches/products/packages only.  Anonymous customer
-- flows need delivery metadata, but must not receive branch banking fields.
GRANT SELECT (
  id,
  name,
  address,
  phone,
  latitude,
  longitude,
  service_radius_km,
  internal_demo,
  status,
  order_cutoff_hour,
  closed_weekdays
) ON TABLE public.branches TO anon;
GRANT SELECT ON TABLE public.branches TO authenticated;
GRANT SELECT ON TABLE public.products TO anon, authenticated;
GRANT SELECT ON TABLE public.voucher_packages TO anon, authenticated;

CREATE POLICY public_read_active_branches
  ON public.branches FOR SELECT TO anon
  USING (status = 'active');
CREATE POLICY staff_read_branches
  ON public.branches FOR SELECT TO authenticated
  USING (public.current_staff_context()->>'status' = 'active');

CREATE POLICY public_read_active_products
  ON public.products FOR SELECT TO anon
  USING (status = 'active');
CREATE POLICY staff_read_products
  ON public.products FOR SELECT TO authenticated
  USING (public.current_staff_context()->>'status' = 'active');

CREATE POLICY public_read_active_voucher_packages
  ON public.voucher_packages FOR SELECT TO anon
  USING (is_active IS TRUE);
CREATE POLICY staff_read_voucher_packages
  ON public.voucher_packages FOR SELECT TO authenticated
  USING (public.current_staff_context()->>'status' = 'active');

-- Staff profiles: active staff may resolve coworkers for assigned-by/driver
-- labels; only an active admin may mutate accounts.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO authenticated;

CREATE POLICY staff_read_profiles
  ON public.profiles FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.current_staff_context()->>'status' = 'active'
  );
CREATE POLICY admin_insert_profiles
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_update_profiles
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_delete_profiles
  ON public.profiles FOR DELETE TO authenticated
  USING (public.current_user_is_admin() AND id <> auth.uid());

-- Customer master data: custom login bearer/authentication material remains
-- service-role only. Explicit SELECT columns also make an accidental future
-- browser select('*') fail closed instead of downloading tokens.
GRANT SELECT (
  id, name, address, phone, whatsapp, discount, branch, created_by,
  created_at, updated_at, payment_term, customer_type, is_active,
  service_branch, payment_method, initial_borrowed_gallons,
  current_borrowed_gallons, credit_limit
) ON TABLE public.customers TO authenticated;
GRANT INSERT (
  name, address, phone, whatsapp, discount, branch, created_by,
  payment_term, customer_type, is_active, payment_method,
  initial_borrowed_gallons, credit_limit, service_branch
) ON TABLE public.customers TO authenticated;
GRANT UPDATE (
  name, address, phone, whatsapp, discount, branch, created_by, updated_at,
  payment_term, customer_type, is_active, payment_method,
  initial_borrowed_gallons, credit_limit, service_branch
) ON TABLE public.customers TO authenticated;

CREATE POLICY staff_read_customers
  ON public.customers FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'operator', 'operator_manager', 'finance', 'admin',
      'branch_admin', 'operations_admin', 'adminFin'
    )
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR public.current_staff_context()->>'branch' = 'All'
      OR branch = public.current_staff_context()->>'branch'
    )
  );
CREATE POLICY staff_insert_customers
  ON public.customers FOR INSERT TO authenticated
  WITH CHECK (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'admin', 'branch_admin', 'operations_admin'
    )
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR public.current_staff_context()->>'branch' = 'All'
      OR branch = public.current_staff_context()->>'branch'
    )
  );
CREATE POLICY staff_update_customers
  ON public.customers FOR UPDATE TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'finance', 'admin', 'branch_admin', 'operations_admin'
    )
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR public.current_staff_context()->>'branch' = 'All'
      OR branch = public.current_staff_context()->>'branch'
    )
  )
  WITH CHECK (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'finance', 'admin', 'branch_admin', 'operations_admin'
    )
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR public.current_staff_context()->>'branch' = 'All'
      OR branch = public.current_staff_context()->>'branch'
    )
  );

-- Staff order reads are branch scoped.  Writes retain the canonical policies
-- from 20260914160000; the table ACL below restores their required verbs.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_items TO authenticated;

CREATE POLICY staff_read_orders
  ON public.orders FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'operator', 'operator_manager', 'finance', 'admin',
      'branch_admin', 'operations_admin', 'adminFin'
    )
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR public.current_staff_context()->>'branch' = 'All'
      OR branch = public.current_staff_context()->>'branch'
    )
  );
CREATE POLICY staff_read_order_items
  ON public.order_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_items.order_id
    )
  );

-- Correction audit rows are optional in the customer-only schema.  On the
-- shared operations schema, staff may append a correction only as themselves.
-- Branch-scoped roles must have a concrete branch; only admin spans branches.
DO $do$
BEGIN
  IF to_regclass('public.order_corrections') IS NOT NULL THEN
    EXECUTE $policy$
      CREATE POLICY staff_read_order_corrections
        ON public.order_corrections FOR SELECT TO authenticated
        USING (
          public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'sales', 'admin', 'branch_admin'
          )
          AND EXISTS (
            SELECT 1
            FROM public.orders AS o
            WHERE o.id = order_corrections.order_id
              AND (
                public.current_staff_context()->>'role' = 'admin'
                OR (
                  public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
                  AND o.branch = public.current_staff_context()->>'branch'
                )
              )
          )
        )
    $policy$;
    EXECUTE $policy$
      CREATE POLICY staff_insert_order_corrections
        ON public.order_corrections FOR INSERT TO authenticated
        WITH CHECK (
          corrected_by = auth.uid()
          AND public.current_staff_context()->>'status' = 'active'
          AND public.current_staff_context()->>'role' IN (
            'sales', 'admin', 'branch_admin'
          )
          AND EXISTS (
            SELECT 1
            FROM public.orders AS o
            WHERE o.id = order_corrections.order_id
              AND (
                public.current_staff_context()->>'role' = 'admin'
                OR (
                  public.current_staff_context()->>'branch' IS DISTINCT FROM 'All'
                  AND o.branch = public.current_staff_context()->>'branch'
                )
              )
          )
        )
    $policy$;
  END IF;
END;
$do$;

-- Every order path, including already-deployed voucher RPCs, must reject a
-- branch after operations has disabled it.  Scope the update trigger to branch
-- changes so historical orders remain editable for unrelated fields.
CREATE OR REPLACE FUNCTION public.guard_order_active_branch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.branches AS b
    WHERE b.name = NEW.branch
      AND b.status = 'active'
  ) THEN
    RAISE EXCEPTION 'SERVICE_BRANCH_INACTIVE_OR_NOT_FOUND';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_order_active_branch()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_order_active_branch ON public.orders;
CREATE TRIGGER guard_order_active_branch
BEFORE INSERT OR UPDATE OF branch ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_order_active_branch();

-- Branch writes: admins manage all fields; branch administrators may change
-- only their own delivery radius.  The trigger enforces the column boundary
-- that row-level policies alone cannot express.
GRANT INSERT, UPDATE, DELETE ON TABLE public.branches TO authenticated;

CREATE POLICY admin_insert_branches
  ON public.branches FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY staff_update_branches
  ON public.branches FOR UPDATE TO authenticated
  USING (
    public.current_user_is_admin()
    OR (
      public.current_staff_context()->>'status' = 'active'
      AND public.current_staff_context()->>'role' IN ('branch_admin', 'operations_admin')
      AND name = public.current_staff_context()->>'branch'
    )
  )
  WITH CHECK (
    public.current_user_is_admin()
    OR (
      public.current_staff_context()->>'status' = 'active'
      AND public.current_staff_context()->>'role' IN ('branch_admin', 'operations_admin')
      AND name = public.current_staff_context()->>'branch'
    )
  );
CREATE POLICY admin_delete_branches
  ON public.branches FOR DELETE TO authenticated
  USING (public.current_user_is_admin());

CREATE OR REPLACE FUNCTION public.guard_branch_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role') OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_context := public.current_staff_context();
  IF v_context->>'status' IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ACTIVE_STAFF_REQUIRED';
  END IF;
  IF v_context->>'role' IS NOT DISTINCT FROM 'admin' THEN
    RETURN NEW;
  END IF;
  IF NOT COALESCE(
       (v_context->>'role') IN ('branch_admin', 'operations_admin'),
       false
     )
     OR v_context->>'branch' IS DISTINCT FROM OLD.name
     OR (to_jsonb(NEW) - ARRAY['service_radius_km', 'updated_at']::text[])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['service_radius_km', 'updated_at']::text[]) THEN
    RAISE EXCEPTION 'BRANCH_UPDATE_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_branch_client_update()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_branch_client_update ON public.branches;
CREATE TRIGGER guard_branch_client_update
BEFORE UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.guard_branch_client_update();

-- Product maintenance remains admin-only.
GRANT INSERT, UPDATE, DELETE ON TABLE public.products TO authenticated;
CREATE POLICY admin_insert_products
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_update_products
  ON public.products FOR UPDATE TO authenticated
  USING (public.current_user_is_admin())
  WITH CHECK (public.current_user_is_admin());
CREATE POLICY admin_delete_products
  ON public.products FOR DELETE TO authenticated
  USING (public.current_user_is_admin());

-- Shared trip rows are an authenticated operations workflow only.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trips TO authenticated;
CREATE POLICY operations_read_trips
  ON public.trips FOR SELECT TO authenticated
  USING (
    branch = 'Shared'
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'operator', 'operator_manager', 'admin', 'branch_admin', 'operations_admin'
    )
  );
CREATE POLICY admin_insert_trips
  ON public.trips FOR INSERT TO authenticated
  WITH CHECK (branch = 'Shared' AND public.current_user_is_admin());
CREATE POLICY operations_update_trips
  ON public.trips FOR UPDATE TO authenticated
  USING (
    branch = 'Shared'
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN ('operator', 'operator_manager', 'admin')
  )
  WITH CHECK (
    branch = 'Shared'
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN ('operator', 'operator_manager', 'admin')
  );
CREATE POLICY admin_delete_trips
  ON public.trips FOR DELETE TO authenticated
  USING (branch = 'Shared' AND public.current_user_is_admin());

-- Payment transaction rows are written only by trusted backend functions.
GRANT SELECT ON TABLE public.payment_transactions TO authenticated;
CREATE POLICY staff_read_payment_transactions
  ON public.payment_transactions FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR (
        public.current_staff_context()->>'role' IN (
          'finance', 'branch_admin', 'operations_admin'
        )
        AND EXISTS (
          SELECT 1
          FROM public.customers AS c
          WHERE c.id = payment_transactions.customer_id
            AND (
              public.current_staff_context()->>'branch' = 'All'
              OR c.branch = public.current_staff_context()->>'branch'
            )
        )
      )
    )
  );

-- Voucher balance reads are branch scoped.  Finance/admin top-ups use the
-- guarded RPC below.  The only remaining direct staff update is the legacy
-- sales deduction path, which is constrained to a same-branch decrease.
GRANT SELECT ON TABLE public.customer_product_vouchers TO authenticated;
GRANT UPDATE (balance, updated_at)
  ON TABLE public.customer_product_vouchers TO authenticated;

CREATE POLICY staff_read_customer_vouchers
  ON public.customer_product_vouchers FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = customer_product_vouchers.customer_id
        AND (
          public.current_staff_context()->>'role' IN ('admin', 'adminFin')
          OR (
            public.current_staff_context()->>'role' IN (
              'finance', 'sales', 'operator', 'operator_manager',
              'branch_admin', 'operations_admin'
            )
            AND (
              public.current_staff_context()->>'branch' = 'All'
              OR c.branch = public.current_staff_context()->>'branch'
            )
          )
        )
    )
  );
CREATE POLICY sales_decrement_customer_vouchers
  ON public.customer_product_vouchers FOR UPDATE TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN ('sales', 'admin')
    AND EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = customer_product_vouchers.customer_id
        AND (
          public.current_staff_context()->>'role' = 'admin'
          OR (
            public.current_staff_context()->>'role' = 'sales'
            AND (
              public.current_staff_context()->>'branch' = 'All'
              OR c.branch = public.current_staff_context()->>'branch'
            )
          )
        )
    )
  )
  WITH CHECK (
    public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN ('sales', 'admin')
  );

CREATE OR REPLACE FUNCTION public.guard_customer_voucher_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role')
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.gift_balance IS DISTINCT FROM OLD.gift_balance
     OR NEW.balance > OLD.balance
     OR NEW.balance < NEW.gift_balance
     OR NEW.balance < 0 THEN
    RAISE EXCEPTION 'VOUCHER_UPDATE_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_customer_voucher_client_update()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_customer_voucher_client_update
  ON public.customer_product_vouchers;
CREATE TRIGGER guard_customer_voucher_client_update
BEFORE UPDATE ON public.customer_product_vouchers
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_voucher_client_update();

CREATE OR REPLACE FUNCTION public.increment_voucher_balance(
  p_customer_id uuid,
  p_product_id uuid,
  p_add integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context jsonb;
  v_customer_branch text;
  v_is_service boolean := auth.role() IS NOT DISTINCT FROM 'service_role';
BEGIN
  IF p_add IS NULL OR p_add <= 0 OR p_add > 100000 THEN
    RAISE EXCEPTION 'VOUCHER_TOPUP_QUANTITY_INVALID';
  END IF;

  IF NOT v_is_service THEN
    v_context := public.current_staff_context();
    IF v_context->>'status' IS DISTINCT FROM 'active'
       OR NOT COALESCE(
         (v_context->>'role') IN ('finance', 'admin', 'adminFin'),
         false
       ) THEN
      RAISE EXCEPTION 'VOUCHER_TOPUP_NOT_ALLOWED';
    END IF;
  END IF;

  SELECT c.branch
    INTO v_customer_branch
  FROM public.customers AS c
  WHERE c.id = p_customer_id
    AND c.is_active IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  IF NOT v_is_service THEN
    IF v_context->>'role' NOT IN ('admin', 'adminFin')
       AND v_context->>'branch' IS DISTINCT FROM 'All'
       AND v_context->>'branch' IS DISTINCT FROM v_customer_branch THEN
      RAISE EXCEPTION 'CUSTOMER_BRANCH_MISMATCH';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.id = p_product_id AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND';
  END IF;

  INSERT INTO public.customer_product_vouchers AS cpv (
    customer_id, product_id, balance, gift_balance, updated_at
  )
  VALUES (p_customer_id, p_product_id, p_add, 0, now())
  ON CONFLICT (customer_id, product_id)
  DO UPDATE SET
    balance = cpv.balance + EXCLUDED.balance,
    updated_at = now();
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.increment_voucher_balance(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_voucher_balance(uuid, uuid, integer)
  TO authenticated, service_role;

-- Purchase requests may only be created/confirmed by service-role payment
-- code.  Finance can reject a still-pending request but cannot forge a paid one.
GRANT SELECT ON TABLE public.voucher_purchase_requests TO authenticated;
GRANT UPDATE (status, updated_at)
  ON TABLE public.voucher_purchase_requests TO authenticated;

CREATE POLICY staff_read_voucher_purchases
  ON public.voucher_purchase_requests FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = voucher_purchase_requests.customer_id
        AND (
          public.current_staff_context()->>'role' IN ('admin', 'adminFin')
          OR (
            public.current_staff_context()->>'role' IN (
              'finance', 'sales', 'branch_admin', 'operations_admin'
            )
            AND (
              public.current_staff_context()->>'branch' = 'All'
              OR c.branch = public.current_staff_context()->>'branch'
            )
          )
        )
    )
  );
CREATE POLICY finance_reject_pending_voucher_purchases
  ON public.voucher_purchase_requests FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND public.current_staff_context()->>'status' = 'active'
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR (
        public.current_staff_context()->>'role' = 'finance'
        AND EXISTS (
          SELECT 1
          FROM public.customers AS c
          WHERE c.id = voucher_purchase_requests.customer_id
            AND (
              public.current_staff_context()->>'branch' = 'All'
              OR c.branch = public.current_staff_context()->>'branch'
            )
        )
      )
    )
  )
  WITH CHECK (
    status = 'rejected'
    AND public.current_staff_context()->>'status' = 'active'
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR (
        public.current_staff_context()->>'role' = 'finance'
        AND EXISTS (
          SELECT 1
          FROM public.customers AS c
          WHERE c.id = voucher_purchase_requests.customer_id
            AND (
              public.current_staff_context()->>'branch' = 'All'
              OR c.branch = public.current_staff_context()->>'branch'
            )
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.enforce_confirmed_voucher_purchase_settlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'confirmed'
     AND NOT EXISTS (
       SELECT 1
       FROM public.hq_midtrans_settlements AS h
       WHERE h.voucher_purchase_request_id = NEW.id
         AND h.customer_id = NEW.customer_id
         AND h.midtrans_order_id = NEW.midtrans_order_id
         AND h.gross_amount = NEW.amount_paid
         AND h.source_type = 'voucher_purchase'
     ) THEN
    RAISE EXCEPTION 'CONFIRMED_VOUCHER_PURCHASE_REQUIRES_SETTLEMENT';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION public.enforce_confirmed_voucher_purchase_settlement()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_confirmed_voucher_purchase_settlement
  ON public.voucher_purchase_requests;
CREATE CONSTRAINT TRIGGER enforce_confirmed_voucher_purchase_settlement
AFTER INSERT OR UPDATE ON public.voucher_purchase_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_confirmed_voucher_purchase_settlement();

-- Voucher usage and Midtrans settlement are append-only backend records.
GRANT SELECT ON TABLE public.voucher_usage_ledger TO authenticated;
GRANT SELECT ON TABLE public.hq_midtrans_settlements TO authenticated;

CREATE POLICY staff_read_voucher_usage
  ON public.voucher_usage_ledger FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR (
        public.current_staff_context()->>'role' IN (
          'finance', 'sales', 'operator_manager', 'branch_admin', 'operations_admin'
        )
        AND (
          public.current_staff_context()->>'branch' = 'All'
          OR branch = public.current_staff_context()->>'branch'
        )
      )
    )
  );
CREATE POLICY staff_read_hq_settlements
  ON public.hq_midtrans_settlements FOR SELECT TO authenticated
  USING (
    public.current_staff_context()->>'status' = 'active'
    AND (
      public.current_staff_context()->>'role' IN ('admin', 'adminFin')
      OR (
        public.current_staff_context()->>'role' IN (
          'finance', 'sales', 'branch_admin', 'operations_admin'
        )
        AND (
          public.current_staff_context()->>'branch' = 'All'
          OR branch = public.current_staff_context()->>'branch'
        )
      )
    )
  );

-- Definer views otherwise bypass all of the table policies above.  Only the
-- one view used by the operations UI remains client-readable; the others stay
-- backend/owner-only until a concrete UI needs them.
DO $$
DECLARE
  v_view record;
BEGIN
  FOR v_view IN
    SELECT n.nspname, c.relname
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
  LOOP
    EXECUTE format(
      'ALTER VIEW %I.%I SET (security_invoker = true)',
      v_view.nspname,
      v_view.relname
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
      v_view.nspname,
      v_view.relname
    );
    EXECUTE format(
      'GRANT ALL PRIVILEGES ON TABLE %I.%I TO service_role',
      v_view.nspname,
      v_view.relname
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.hq_vw_order_payment_settled_daily') IS NOT NULL THEN
    EXECUTE
      'GRANT SELECT ON TABLE public.hq_vw_order_payment_settled_daily TO authenticated';
  END IF;
END;
$$;

-- All historical custom customer tokens were readable through the old PUBLIC
-- customer policy.  Rotate them once so copied tokens cannot survive the fix.
UPDATE public.customers
SET auth_token = gen_random_uuid(),
    token_created_at = now()
WHERE auth_token IS NOT NULL;

COMMIT;
