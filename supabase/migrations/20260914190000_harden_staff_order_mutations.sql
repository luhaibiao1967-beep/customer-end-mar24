-- Harden direct staff mutations of orders and order_items without changing the
-- customer Edge Function/RPC paths.  Browser staff keep only the columns and
-- state transitions used by the shared operations application; trusted
-- service_role/postgres work remains available to backend-owned workflows.
--
-- This migration intentionally tolerates the small column-shape differences
-- between the operations schema and older customer-portal clones.  Optional
-- columns are granted from the pg_attribute intersection and inspected through
-- to_jsonb(NEW/OLD), so creating the trigger functions never requires every
-- optional column to exist.

BEGIN;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- Remove every client-facing write/ALL policy.  Permissive policies are ORed,
-- so retaining one historical policy would defeat the canonical policies
-- recreated below.  Service-only policies are deliberately preserved.
DO $policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('orders', 'order_items')
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND roles::text[] && ARRAY['public', 'anon', 'authenticated']::text[]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END;
$policies$;

-- Reset both table- and column-level mutation ACLs.  SELECT remains available
-- to authenticated staff and continues to be filtered by the 1800 read
-- policies.  INSERT/UPDATE are restored only for the frontend column
-- intersection below; DELETE remains row-policy and trigger constrained.
REVOKE ALL PRIVILEGES ON TABLE public.orders
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.order_items
  FROM PUBLIC, anon, authenticated;

DO $column_acl$
DECLARE
  v_all_order_columns text;
  v_all_item_columns text;
  v_order_insert_columns text;
  v_order_update_columns text;
  v_item_insert_columns text;
  v_item_update_columns text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_all_order_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.orders'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_all_item_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.order_items'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped;

  -- REVOKE ON TABLE does not necessarily clear historical per-column grants.
  IF v_all_order_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.orders FROM PUBLIC, anon, authenticated',
      v_all_order_columns
    );
  END IF;
  IF v_all_item_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.order_items FROM PUBLIC, anon, authenticated',
      v_all_item_columns
    );
  END IF;

  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_order_insert_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.orders'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname = ANY (ARRAY[
      'customer_id', 'customer_name', 'customer_address',
      'customer_whatsapp', 'customer_discount', 'branch', 'total_amount',
      'delivery_date', 'note', 'created_by', 'created_by_display',
      'payment_status', 'paid_date', 'payment_confirmation_type'
    ]::text[]);

  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_order_update_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.orders'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname = ANY (ARRAY[
      'customer_id', 'customer_name', 'customer_address',
      'customer_whatsapp', 'customer_discount', 'branch', 'total_amount',
      'delivery_date', 'note', 'status', 'payment_status',
      'payment_evidence', 'paid_date', 'delivery_evidence',
      'delivered_date', 'empty_gallons_returned', 'borrowed_gallons',
      'evidence_amount_verified', 'evidence_detected_amount',
      'payment_confirmation_type', 'is_active', 'inactivated_at',
      'inactivated_by', 'delivered_by', 'payment_confirmed_by'
    ]::text[]);

  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_item_insert_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.order_items'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname = ANY (ARRAY[
      'order_id', 'product', 'product_id', 'is_refill', 'quantity',
      'unit_price', 'discount'
    ]::text[]);

  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_item_update_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.order_items'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname = 'quantity';

  -- Creation, cancellation, correction, and delivered-quantity mutations are
  -- installed as atomic RPCs by the next migration.  Keep the intermediate
  -- state fail-closed so applying migrations one at a time never exposes a
  -- partially trusted browser workflow.
  EXECUTE 'GRANT SELECT ON TABLE public.orders TO authenticated';
  EXECUTE 'GRANT SELECT ON TABLE public.order_items TO authenticated';

  IF v_order_update_columns IS NOT NULL THEN
    EXECUTE format(
      'GRANT UPDATE (%s) ON TABLE public.orders TO authenticated',
      v_order_update_columns
    );
  END IF;
END;
$column_acl$;

GRANT ALL PRIVILEGES ON TABLE public.orders TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.order_items TO service_role;

-- RLS-policy expressions and SECURITY INVOKER guards must be able to test for
-- an immutable voucher ledger without granting staff direct ledger SELECT.
-- The function reveals a boolean only for an active writer who can already see
-- the order in their permitted branch.
CREATE OR REPLACE FUNCTION public.staff_order_has_voucher_ledger(
  p_order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context jsonb;
  v_role text;
  v_branch text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN false;
  END IF;

  IF auth.role() = 'service_role' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.voucher_usage_ledger AS l
      WHERE l.order_id = p_order_id
    );
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_branch := v_context->>'branch';

  IF auth.uid() IS NULL
     OR v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN (
       'sales', 'operator', 'operator_manager', 'finance',
       'admin', 'branch_admin'
     ), false) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.orders AS o
    JOIN public.voucher_usage_ledger AS l ON l.order_id = o.id
    WHERE o.id = p_order_id
      AND (
        v_role = 'admin'
        OR (v_role IN ('finance', 'operator_manager') AND v_branch = 'All')
        OR (
          v_branch IS NOT NULL
          AND v_branch <> 'All'
          AND o.branch = v_branch
        )
      )
  );
END;
$$;

ALTER FUNCTION public.staff_order_has_voucher_ledger(uuid) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.staff_order_has_voucher_ledger(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_order_has_voucher_ledger(uuid)
  TO authenticated, service_role;

-- Canonical write policies.  admin is global.  Existing finance and
-- operator_manager profiles with branch='All' retain their established global
-- operational scope.  Every other writer must have a concrete matching branch.
DROP POLICY IF EXISTS staff_insert_orders ON public.orders;
CREATE POLICY staff_insert_orders
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN ('sales', 'admin')
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR (
        public.current_staff_context()->>'branch' IS NOT NULL
        AND public.current_staff_context()->>'branch' <> 'All'
        AND branch = public.current_staff_context()->>'branch'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = orders.customer_id
        AND c.branch = orders.branch
        AND c.is_active IS TRUE
    )
  );

DROP POLICY IF EXISTS staff_update_orders ON public.orders;
CREATE POLICY staff_update_orders
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'operator', 'operator_manager', 'finance', 'admin',
      'branch_admin'
    )
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR (
        public.current_staff_context()->>'role' IN ('finance', 'operator_manager')
        AND public.current_staff_context()->>'branch' = 'All'
      )
      OR (
        public.current_staff_context()->>'branch' IS NOT NULL
        AND public.current_staff_context()->>'branch' <> 'All'
        AND branch = public.current_staff_context()->>'branch'
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'operator', 'operator_manager', 'finance', 'admin',
      'branch_admin'
    )
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR (
        public.current_staff_context()->>'role' IN ('finance', 'operator_manager')
        AND public.current_staff_context()->>'branch' = 'All'
      )
      OR (
        public.current_staff_context()->>'branch' IS NOT NULL
        AND public.current_staff_context()->>'branch' <> 'All'
        AND branch = public.current_staff_context()->>'branch'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM public.customers AS c
      WHERE c.id = orders.customer_id
        AND c.branch = orders.branch
    )
  );

DROP POLICY IF EXISTS staff_delete_orders ON public.orders;
CREATE POLICY staff_delete_orders
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND status <> 'delivered'
    AND COALESCE(payment_status, 'unpaid') NOT IN ('paid', 'partial')
    AND NULLIF(to_jsonb(orders)->>'midtrans_order_id', '') IS NULL
    AND NULLIF(to_jsonb(orders)->>'prepay_checkout_key', '') IS NULL
    AND NULLIF(to_jsonb(orders)->>'prepay_request_hash', '') IS NULL
    AND NULLIF(to_jsonb(orders)->>'voucher_order_key', '') IS NULL
    AND NULLIF(to_jsonb(orders)->>'voucher_order_request_hash', '') IS NULL
    AND NULLIF(to_jsonb(orders)->>'qris_charged_idr', '') IS NULL
    AND NULLIF(to_jsonb(orders)->'prepay_breakdown', 'null'::jsonb) IS NULL
    AND COALESCE((to_jsonb(orders)->>'voucher_used')::numeric, 0) = 0
    AND COALESCE((to_jsonb(orders)->>'voucher_deduction')::numeric, 0) = 0
    AND COALESCE(lower(NULLIF(to_jsonb(orders)->>'payment_confirmation_type', '')), '')
      NOT IN ('pre_pay', 'prepaid', 'qris', 'midtrans')
    AND NOT public.staff_order_has_voucher_ledger(orders.id)
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN ('sales', 'admin')
    AND (
      public.current_staff_context()->>'role' = 'admin'
      OR (
        public.current_staff_context()->>'branch' IS NOT NULL
        AND public.current_staff_context()->>'branch' <> 'All'
        AND branch = public.current_staff_context()->>'branch'
        AND created_by = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS staff_insert_order_items ON public.order_items;
CREATE POLICY staff_insert_order_items
  ON public.order_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'admin', 'branch_admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_items.order_id
        AND (
          public.current_staff_context()->>'role' = 'admin'
          OR (
            public.current_staff_context()->>'branch' IS NOT NULL
            AND public.current_staff_context()->>'branch' <> 'All'
            AND o.branch = public.current_staff_context()->>'branch'
          )
        )
    )
  );

DROP POLICY IF EXISTS staff_update_order_items ON public.order_items;
CREATE POLICY staff_update_order_items
  ON public.order_items
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'operator', 'operator_manager', 'admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_items.order_id
        AND (
          public.current_staff_context()->>'role' = 'admin'
          OR (
            public.current_staff_context()->>'role' = 'operator_manager'
            AND public.current_staff_context()->>'branch' = 'All'
          )
          OR (
            public.current_staff_context()->>'branch' IS NOT NULL
            AND public.current_staff_context()->>'branch' <> 'All'
            AND o.branch = public.current_staff_context()->>'branch'
          )
        )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'operator', 'operator_manager', 'admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_items.order_id
        AND (
          public.current_staff_context()->>'role' = 'admin'
          OR (
            public.current_staff_context()->>'role' = 'operator_manager'
            AND public.current_staff_context()->>'branch' = 'All'
          )
          OR (
            public.current_staff_context()->>'branch' IS NOT NULL
            AND public.current_staff_context()->>'branch' <> 'All'
            AND o.branch = public.current_staff_context()->>'branch'
          )
        )
    )
  );

DROP POLICY IF EXISTS staff_delete_order_items ON public.order_items;
CREATE POLICY staff_delete_order_items
  ON public.order_items
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'admin', 'branch_admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_items.order_id
        AND (
          public.current_staff_context()->>'role' = 'admin'
          OR (
            public.current_staff_context()->>'branch' IS NOT NULL
            AND public.current_staff_context()->>'branch' <> 'All'
            AND o.branch = public.current_staff_context()->>'branch'
          )
        )
    )
  );

-- Field- and transition-level order guard.  It remains SECURITY INVOKER so a
-- browser write is evaluated as that browser role.  Backend functions running
-- as postgres and service-role requests bypass this staff-only state machine.
CREATE OR REPLACE FUNCTION public.guard_staff_order_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_actor_label text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb;
  v_changed text[] := ARRAY[]::text[];
  v_business_columns text[] := ARRAY[
    'customer_id', 'customer_name', 'customer_address',
    'customer_whatsapp', 'customer_discount', 'branch', 'delivery_date',
    'note', 'empty_gallons_returned', 'borrowed_gallons'
  ]::text[];
  v_delivery_columns text[] := ARRAY[
    'status', 'delivery_evidence', 'delivered_date', 'delivered_by',
    'empty_gallons_returned', 'borrowed_gallons', 'note'
  ]::text[];
  v_payment_columns text[] := ARRAY[
    'payment_status', 'paid_date', 'payment_evidence',
    'payment_confirmation_type', 'payment_confirmed_by',
    'evidence_amount_verified', 'evidence_detected_amount'
  ]::text[];
  v_inactivation_columns text[] := ARRAY[
    'is_active', 'inactivated_at', 'inactivated_by'
  ]::text[];
  v_client_mutable_columns text[];
  v_customer_type text;
  v_customer_active boolean;
  v_has_ledger boolean := false;
  v_has_backend_identity boolean := false;
  v_old_total numeric := 0;
  v_old_payment text;
  v_new_payment text;
  v_old_status text;
  v_new_status text;
  v_old_confirmation text;
  v_new_confirmation text;
  v_payment_changed boolean := false;
  v_portal_created boolean := false;
BEGIN
  IF current_user IN ('postgres', 'service_role')
     OR auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';

  IF auth.uid() IS NULL
     OR v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN (
       'sales', 'operator', 'operator_manager', 'finance',
       'admin', 'branch_admin'
     ), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_WRITE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
           NULLIF(to_jsonb(p)->>'name', ''),
           NULLIF(to_jsonb(p)->>'username', ''),
           NULLIF(to_jsonb(p)->>'email', ''),
           auth.uid()::text
         )
    INTO v_actor_label
  FROM public.profiles AS p
  WHERE p.id = auth.uid();
  v_actor_label := COALESCE(v_actor_label, auth.uid()::text);

  v_client_mutable_columns :=
    v_business_columns
    || v_delivery_columns
    || v_payment_columns
    || v_inactivation_columns;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    IF v_role NOT IN ('sales', 'admin') THEN
      RAISE EXCEPTION 'ORDER_INSERT_ROLE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    IF v_role <> 'admin'
       AND (
         v_staff_branch IS NULL
         OR v_staff_branch = 'All'
         OR v_new->>'branch' IS DISTINCT FROM v_staff_branch
       ) THEN
      RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    SELECT c.customer_type::text, c.is_active
      INTO v_customer_type, v_customer_active
    FROM public.customers AS c
    WHERE c.id = (v_new->>'customer_id')::uuid
      AND c.branch = v_new->>'branch';

    IF NOT FOUND OR v_customer_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'ORDER_CUSTOMER_BRANCH_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    IF COALESCE(v_new->>'status', 'pending') <> 'pending'
       OR COALESCE((v_new->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR NULLIF(v_new->>'delivery_trip_id', '') IS NOT NULL
       OR COALESCE((v_new->>'is_external_delivery')::boolean, false)
       OR NULLIF(v_new->>'midtrans_order_id', '') IS NOT NULL
       OR NULLIF(v_new->>'qris_charged_idr', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_checkout_key', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_request_hash', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_snap_token', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_snap_redirect_url', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_snap_created_at', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_released_at', '') IS NOT NULL
       OR NULLIF(v_new->>'prepay_release_reason', '') IS NOT NULL
       OR NULLIF(v_new->>'voucher_order_key', '') IS NOT NULL
       OR NULLIF(v_new->>'voucher_order_request_hash', '') IS NOT NULL
       OR NULLIF(v_new->'prepay_breakdown', 'null'::jsonb) IS NOT NULL
       OR COALESCE((v_new->>'voucher_used')::numeric, 0) <> 0
       OR COALESCE((v_new->>'voucher_deduction')::numeric, 0) <> 0 THEN
      RAISE EXCEPTION 'ORDER_BACKEND_IDENTITY_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    v_new_payment := COALESCE(v_new->>'payment_status', 'unpaid');
    v_new_confirmation := lower(NULLIF(v_new->>'payment_confirmation_type', ''));

    IF v_new_payment = 'unpaid' THEN
      IF v_customer_type = 'pre_pay'
         OR NULLIF(v_new->>'paid_date', '') IS NOT NULL
         OR v_new_confirmation IS NOT NULL THEN
        RAISE EXCEPTION 'ORDER_INITIAL_PAYMENT_STATE_INVALID'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_new_payment = 'paid' THEN
      IF NULLIF(v_new->>'paid_date', '') IS NULL
         OR NOT COALESCE((
           v_customer_type = 'pre_pay'
           AND v_new_confirmation = 'pre_pay'
         ), false) THEN
        RAISE EXCEPTION 'ORDER_INITIAL_PAYMENT_STATE_INVALID'
          USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'ORDER_INITIAL_PAYMENT_STATE_INVALID'
        USING ERRCODE = '42501';
    END IF;

    -- Staff order identity and totals are server-authored.  Unknown JSON keys
    -- are ignored by jsonb_populate_record on schemas lacking an optional
    -- column.
    NEW.total_amount := 0;
    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'created_by', auth.uid(),
        'created_by_display', 'Sales',
        'total_amount', 0
      )
    );
    RETURN NEW;
  END IF;

  v_old := to_jsonb(OLD);
  v_old_total := COALESCE((v_old->>'total_amount')::numeric, 0);

  -- total_amount is derived from order_items.  Keeping the old value here (as
  -- opposed to rejecting the statement) preserves all three existing call
  -- orders: items->order, order->items, and delete->order->insert.
  NEW.total_amount := OLD.total_amount;
  v_new := to_jsonb(NEW);

  IF NOT (
    v_role = 'admin'
    OR (v_role IN ('finance', 'operator_manager') AND v_staff_branch = 'All')
    OR (
      v_staff_branch IS NOT NULL
      AND v_staff_branch <> 'All'
      AND v_old->>'branch' = v_staff_branch
      AND v_new->>'branch' = v_staff_branch
    )
  ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT c.customer_type::text, c.is_active
    INTO v_customer_type, v_customer_active
  FROM public.customers AS c
  WHERE c.id = (v_new->>'customer_id')::uuid
    AND c.branch = v_new->>'branch';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_CUSTOMER_BRANCH_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(e.key ORDER BY e.key), ARRAY[]::text[])
    INTO v_changed
  FROM jsonb_each(v_new) AS e(key, value)
  WHERE e.key <> 'updated_at'
    AND e.value IS DISTINCT FROM (v_old->e.key);

  IF cardinality(v_changed) = 0 THEN
    RETURN NEW;
  END IF;

  IF NOT (v_changed <@ v_client_mutable_columns) THEN
    RAISE EXCEPTION 'ORDER_IDENTITY_IMMUTABLE'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE((v_new->>'empty_gallons_returned')::numeric, 0) < 0 THEN
    RAISE EXCEPTION 'ORDER_GALLON_COUNT_INVALID'
      USING ERRCODE = '22023';
  END IF;

  v_old_payment := COALESCE(v_old->>'payment_status', 'unpaid');
  v_new_payment := COALESCE(v_new->>'payment_status', 'unpaid');
  v_old_status := COALESCE(v_old->>'status', 'pending');
  v_new_status := COALESCE(v_new->>'status', 'pending');
  v_old_confirmation := lower(NULLIF(v_old->>'payment_confirmation_type', ''));
  v_new_confirmation := lower(NULLIF(v_new->>'payment_confirmation_type', ''));
  v_payment_changed := v_changed && v_payment_columns;
  -- Every browser-side staff INSERT is canonicalised above to a non-null
  -- created_by plus the exact display marker "Sales".  Treat anything else
  -- as portal/legacy provenance so a bare pre_pay marker still fails closed.
  v_portal_created := NOT (
    NULLIF(v_old->>'created_by', '') IS NOT NULL
    AND lower(COALESCE(NULLIF(v_old->>'created_by_display', ''), '')) = 'sales'
  );

  v_has_ledger := public.staff_order_has_voucher_ledger(OLD.id);
  v_has_backend_identity :=
    NULLIF(v_old->>'midtrans_order_id', '') IS NOT NULL
    OR NULLIF(v_old->>'qris_charged_idr', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_checkout_key', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_request_hash', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_snap_token', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_snap_redirect_url', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_snap_created_at', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_released_at', '') IS NOT NULL
    OR NULLIF(v_old->>'prepay_release_reason', '') IS NOT NULL
    OR NULLIF(v_old->>'voucher_order_key', '') IS NOT NULL
    OR NULLIF(v_old->>'voucher_order_request_hash', '') IS NOT NULL
    OR NULLIF(v_old->'prepay_breakdown', 'null'::jsonb) IS NOT NULL
    OR COALESCE((v_old->>'voucher_used')::numeric, 0) <> 0
    OR COALESCE((v_old->>'voucher_deduction')::numeric, 0) <> 0
    OR COALESCE(v_old_confirmation, '') IN ('prepaid', 'qris', 'midtrans')
    OR (
      COALESCE(v_old_confirmation, '') = 'pre_pay'
      AND v_portal_created
    )
    OR v_has_ledger;

  -- Item replacement plus header correction, and item-quantity adjustment plus
  -- delivery, must commit as one transaction.  Direct browser UPDATE cannot
  -- provide that guarantee, so these paths are RPC-only.
  IF array_position(v_changed, 'status') IS NOT NULL
     AND v_new_status = 'delivered' THEN
    RAISE EXCEPTION 'ORDER_DELIVERY_REQUIRES_ATOMIC_RPC'
      USING ERRCODE = '42501';
  END IF;

  IF v_changed && v_business_columns THEN
    RAISE EXCEPTION 'ORDER_CORRECTION_REQUIRES_ATOMIC_RPC'
      USING ERRCODE = '42501';
  END IF;

  -- Atomic soft-inactivation.  Sales may only inactivate a customer-portal
  -- order; admin/branch_admin may inactivate ordinary keyless orders.
  IF v_changed <@ v_inactivation_columns
     AND array_position(v_changed, 'is_active') IS NOT NULL THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR COALESCE((v_new->>'is_active')::boolean, true) IS DISTINCT FROM false
       -- Soft-inactivation is a cancellation path, not a way to hide fulfilled
       -- or financially settled orders.  Those records remain immutable audit
       -- evidence and require an explicit reversal workflow.
       OR v_old_status <> 'pending'
       OR v_old_payment <> 'unpaid'
       OR v_has_backend_identity
       OR NOT (
         v_role IN ('admin', 'branch_admin')
         OR (v_role = 'sales' AND v_portal_created)
       ) THEN
      RAISE EXCEPTION 'ORDER_INACTIVATION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'is_active', false,
        'inactivated_at', now(),
        'inactivated_by', auth.uid()
      )
    );
    RETURN NEW;
  END IF;

  -- Finance records receivables only after fulfilment.  A pending/scheduled
  -- order is not yet accounts receivable, and backend-managed prepay,
  -- voucher, or Midtrans payment state is never editable by staff.
  IF v_role = 'finance' AND v_changed <@ v_payment_columns THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR v_old_status <> 'delivered'
       OR v_old_payment <> 'unpaid'
       OR v_new_payment <> 'paid'
       OR v_customer_type <> 'later_pay'
       OR v_has_backend_identity
       OR NOT COALESCE(v_new_confirmation IN ('manual', 'ocr'), false)
       OR NULLIF(v_new->>'paid_date', '') IS NULL THEN
      RAISE EXCEPTION 'ORDER_PAYMENT_TRANSITION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object('payment_confirmed_by', v_actor_label)
    );
    RETURN NEW;
  END IF;

  -- Delivery is one-way.  Paid backend-managed orders may proceed through the
  -- operational delivery transition, but their payment fields remain frozen.
  IF v_role IN ('operator', 'operator_manager', 'admin', 'branch_admin')
     AND v_changed <@ (v_delivery_columns || v_payment_columns)
     AND array_position(v_changed, 'status') IS NOT NULL
     AND v_new_status = 'delivered' THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR v_old_status NOT IN ('pending', 'scheduled')
       OR (v_has_backend_identity AND v_old_payment <> 'paid') THEN
      RAISE EXCEPTION 'ORDER_DELIVERY_TRANSITION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    IF v_has_backend_identity AND v_payment_changed THEN
      RAISE EXCEPTION 'ORDER_BACKEND_PAYMENT_IMMUTABLE'
        USING ERRCODE = '42501';
    ELSIF NOT v_has_backend_identity AND v_payment_changed THEN
      IF v_role NOT IN ('operator', 'operator_manager', 'admin')
         OR v_old_payment <> 'unpaid'
         OR v_new_payment <> 'paid'
         OR v_customer_type <> 'later_pay'
         OR NULLIF(v_new->>'paid_date', '') IS NULL
         OR NOT COALESCE((
            v_new_confirmation IN ('manual', 'ocr', 'cash', 'transfer')
            OR (v_new_confirmation IS NULL AND v_old_total = 0)
          ), false) THEN
        RAISE EXCEPTION 'ORDER_PAYMENT_TRANSITION_FORBIDDEN'
          USING ERRCODE = '42501';
      END IF;

      NEW := jsonb_populate_record(
        NEW,
        jsonb_build_object('payment_confirmed_by', v_actor_label)
      );
    ELSIF v_old_payment IS DISTINCT FROM v_new_payment THEN
      RAISE EXCEPTION 'ORDER_PAYMENT_TRANSITION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object('delivered_by', v_actor_label)
    );
    RETURN NEW;
  END IF;

  -- Trip arrangement can only toggle pending <-> scheduled.  A special order
  -- must already be paid before it enters the fulfilment workflow.
  IF v_role IN ('operator', 'operator_manager', 'admin')
     AND v_changed <@ ARRAY['status']::text[] THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR NOT (
         (v_old_status = 'pending' AND v_new_status = 'scheduled')
         OR (v_old_status = 'scheduled' AND v_new_status = 'pending')
       )
       OR (v_has_backend_identity AND v_old_payment <> 'paid')
       OR NOT EXISTS (
         SELECT 1
         FROM public.order_items AS oi
         WHERE oi.order_id = OLD.id
         GROUP BY oi.order_id
         HAVING SUM(oi.quantity::bigint) > 0
       ) THEN
      RAISE EXCEPTION 'ORDER_SCHEDULE_TRANSITION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Sales records payment only after delivery.
  IF v_role = 'sales' AND v_changed <@ v_payment_columns THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR v_old_status <> 'delivered'
       OR v_old_payment <> 'unpaid'
       OR v_new_payment <> 'paid'
       OR v_customer_type <> 'later_pay'
       OR v_has_backend_identity
       OR NOT COALESCE(v_new_confirmation IN ('manual', 'ocr'), false)
       OR NULLIF(v_new->>'paid_date', '') IS NULL THEN
      RAISE EXCEPTION 'ORDER_PAYMENT_TRANSITION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object('payment_confirmed_by', v_actor_label)
    );
    RETURN NEW;
  END IF;

  -- Only admin/branch_admin may undo a browser-managed payment.  All evidence
  -- and verification fields are cleared server-side as one transition.
  IF v_role IN ('admin', 'branch_admin')
     AND v_changed <@ v_payment_columns
     AND v_old_payment = 'paid'
     AND v_new_payment = 'unpaid' THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR v_has_backend_identity
       OR NOT COALESCE((
          v_old_confirmation IN ('manual', 'ocr', 'cash', 'transfer')
          OR (v_old_confirmation IS NULL AND v_old_total = 0)
        ), false) THEN
      RAISE EXCEPTION 'ORDER_PAYMENT_UNDO_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    NEW := jsonb_populate_record(
      NEW,
      jsonb_build_object(
        'payment_status', 'unpaid',
        'paid_date', NULL,
        'payment_evidence', NULL,
        'payment_confirmation_type', NULL,
        'payment_confirmed_by', NULL,
        'evidence_amount_verified', NULL,
        'evidence_detected_amount', NULL
      )
    );
    RETURN NEW;
  END IF;

  -- Keyless business corrections.  total_amount is deliberately absent from
  -- this list because it was restored above and is recomputed after item DML.
  IF v_role IN ('sales', 'admin', 'branch_admin')
     AND v_changed <@ v_business_columns THEN
    IF COALESCE((v_old->>'is_active')::boolean, true) IS DISTINCT FROM true
       OR v_has_backend_identity
       OR (
         (
           (v_old->>'customer_id') IS DISTINCT FROM (v_new->>'customer_id')
           OR (v_old->>'branch') IS DISTINCT FROM (v_new->>'branch')
         )
         AND v_customer_active IS DISTINCT FROM true
       )
       OR (
         v_role = 'sales'
         AND NOT (
           v_old_status IN ('pending', 'scheduled')
           OR (v_old_status = 'delivered' AND v_old_payment = 'unpaid')
         )
       ) THEN
      RAISE EXCEPTION 'ORDER_CORRECTION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'ORDER_UPDATE_PATH_FORBIDDEN'
    USING ERRCODE = '42501';
END;
$$;

ALTER FUNCTION public.guard_staff_order_write() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_staff_order_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_staff_order_write ON public.orders;
CREATE TRIGGER guard_staff_order_write
BEFORE INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_staff_order_write();

COMMENT ON FUNCTION public.guard_staff_order_write() IS
  'SECURITY INVOKER state/field guard for authenticated staff order INSERT/UPDATE; backend payment identity is immutable and total_amount is item-derived.';

-- Field- and parent-state guard for order_items.  product_id is optional for
-- compatibility with legacy correction screens that rebuild rows from the
-- historical product text.  When supplied, however, it must still identify an
-- active catalog row with matching name, refill class, and base price.
CREATE OR REPLACE FUNCTION public.guard_staff_order_item_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_old jsonb := '{}'::jsonb;
  v_new jsonb := '{}'::jsonb;
  v_parent jsonb;
  v_parent_id uuid;
  v_changed text[] := ARRAY[]::text[];
  v_has_ledger boolean := false;
  v_has_backend_identity boolean := false;
  v_staff_created boolean := false;
  v_product jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role')
     OR auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';

  IF auth.uid() IS NULL
     OR v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN (
       'sales', 'operator', 'operator_manager', 'admin', 'branch_admin'
     ), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_ITEM_WRITE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_parent_id := NEW.order_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_parent_id := OLD.order_id;
  ELSE
    v_old := to_jsonb(OLD);
    v_parent_id := OLD.order_id;
  END IF;

  SELECT to_jsonb(o)
    INTO v_parent
  FROM public.orders AS o
  WHERE o.id = v_parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_ITEM_PARENT_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  IF NOT (
    v_role = 'admin'
    OR (v_role = 'operator_manager' AND v_staff_branch = 'All')
    OR (
      v_staff_branch IS NOT NULL
      AND v_staff_branch <> 'All'
      AND v_parent->>'branch' = v_staff_branch
    )
  ) THEN
    RAISE EXCEPTION 'ORDER_ITEM_BRANCH_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  v_has_ledger := public.staff_order_has_voucher_ledger(v_parent_id);
  v_staff_created :=
    NULLIF(v_parent->>'created_by', '') IS NOT NULL
    AND lower(
      COALESCE(NULLIF(v_parent->>'created_by_display', ''), '')
    ) = 'sales';
  v_has_backend_identity :=
    NULLIF(v_parent->>'midtrans_order_id', '') IS NOT NULL
    OR NULLIF(v_parent->>'qris_charged_idr', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_checkout_key', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_request_hash', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_snap_token', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_snap_redirect_url', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_snap_created_at', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_released_at', '') IS NOT NULL
    OR NULLIF(v_parent->>'prepay_release_reason', '') IS NOT NULL
    OR NULLIF(v_parent->>'voucher_order_key', '') IS NOT NULL
    OR NULLIF(v_parent->>'voucher_order_request_hash', '') IS NOT NULL
    OR NULLIF(v_parent->'prepay_breakdown', 'null'::jsonb) IS NOT NULL
    OR COALESCE((v_parent->>'voucher_used')::numeric, 0) <> 0
    OR COALESCE((v_parent->>'voucher_deduction')::numeric, 0) <> 0
    OR COALESCE(
      lower(NULLIF(v_parent->>'payment_confirmation_type', '')),
      ''
    ) IN ('prepaid', 'qris', 'midtrans')
    OR (
      COALESCE(
        lower(NULLIF(v_parent->>'payment_confirmation_type', '')),
        ''
      ) = 'pre_pay'
      AND NOT v_staff_created
    )
    OR v_has_ledger;

  IF COALESCE((v_parent->>'is_active')::boolean, true) IS DISTINCT FROM true
     OR v_has_backend_identity THEN
    RAISE EXCEPTION 'ORDER_ITEM_PARENT_LOCKED'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_role NOT IN ('sales', 'admin', 'branch_admin') THEN
      RAISE EXCEPTION 'ORDER_ITEM_INSERT_ROLE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    IF v_role = 'sales'
       AND NOT (
         v_parent->>'status' IN ('pending', 'scheduled')
         OR (
           v_parent->>'status' = 'delivered'
           AND COALESCE(v_parent->>'payment_status', 'unpaid') = 'unpaid'
         )
       ) THEN
      RAISE EXCEPTION 'ORDER_ITEM_CORRECTION_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.quantity < 0
       OR NEW.unit_price < 0
       OR COALESCE(NEW.discount, 0) < 0
       OR COALESCE(NEW.discount, 0) > NEW.unit_price THEN
      RAISE EXCEPTION 'ORDER_ITEM_VALUE_INVALID'
        USING ERRCODE = '22023';
    END IF;

    IF NULLIF(v_new->>'product_id', '') IS NULL THEN
      RAISE EXCEPTION 'ORDER_ITEM_PRODUCT_ID_REQUIRED'
        USING ERRCODE = '42501';
    END IF;

    SELECT to_jsonb(p)
      INTO v_product
    FROM public.products AS p
    WHERE p.id = (v_new->>'product_id')::uuid
      AND p.status = 'active';

    IF NOT FOUND
       OR v_new->>'product' IS DISTINCT FROM v_product->>'name'
       OR (v_new->>'unit_price')::numeric
            IS DISTINCT FROM (v_product->>'price')::numeric
       OR COALESCE((v_new->>'is_refill')::boolean, false)
            IS DISTINCT FROM COALESCE((v_product->>'is_refill')::boolean, false) THEN
      RAISE EXCEPTION 'ORDER_ITEM_PRODUCT_IDENTITY_MISMATCH'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(array_agg(e.key ORDER BY e.key), ARRAY[]::text[])
      INTO v_changed
    FROM jsonb_each(v_new) AS e(key, value)
    WHERE e.value IS DISTINCT FROM (v_old->e.key);

    IF cardinality(v_changed) = 0 THEN
      RETURN NEW;
    END IF;

    IF v_role NOT IN ('operator', 'operator_manager', 'admin')
       OR NOT (v_changed <@ ARRAY['quantity']::text[])
       OR v_parent->>'status' <> 'delivered'
       OR NEW.quantity < 0 THEN
      RAISE EXCEPTION 'ORDER_ITEM_UPDATE_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF v_role NOT IN ('sales', 'admin', 'branch_admin') THEN
    RAISE EXCEPTION 'ORDER_ITEM_DELETE_ROLE_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  IF v_role = 'sales'
     AND NOT (
       v_parent->>'status' IN ('pending', 'scheduled')
       OR (
         v_parent->>'status' = 'delivered'
         AND COALESCE(v_parent->>'payment_status', 'unpaid') = 'unpaid'
       )
     ) THEN
    RAISE EXCEPTION 'ORDER_ITEM_CORRECTION_FORBIDDEN'
      USING ERRCODE = '42501';
  END IF;

  RETURN OLD;
END;
$$;

ALTER FUNCTION public.guard_staff_order_item_write() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_staff_order_item_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_staff_order_item_write ON public.order_items;
CREATE TRIGGER guard_staff_order_item_write
BEFORE INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_staff_order_item_write();

COMMENT ON FUNCTION public.guard_staff_order_item_write() IS
  'SECURITY INVOKER role/field/parent-state guard for direct authenticated order_items mutations.';

-- The database, not a browser-supplied total_amount, is authoritative.  AFTER
-- item DML is required to preserve the deployed frontend sequences, including
-- multi-step corrections and delivery quantity updates.  This function is
-- deliberately SECURITY DEFINER and owned by postgres so its internal order
-- update bypasses the staff guard and RLS while exposing no callable RPC.
CREATE OR REPLACE FUNCTION public.refresh_order_total_from_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order_ids uuid[];
  v_order_id uuid;
  v_total bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_order_ids := ARRAY[NEW.order_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_order_ids := ARRAY[OLD.order_id];
  ELSE
    v_order_ids := ARRAY[OLD.order_id, NEW.order_id];
  END IF;

  FOR v_order_id IN
    SELECT DISTINCT candidate.order_id
    FROM unnest(v_order_ids) AS candidate(order_id)
    WHERE candidate.order_id IS NOT NULL
  LOOP
    SELECT COALESCE(
             SUM(
               (oi.unit_price::bigint - COALESCE(oi.discount, 0)::bigint)
               * oi.quantity::bigint
             ),
             0
           )
      INTO v_total
    FROM public.order_items AS oi
    WHERE oi.order_id = v_order_id;

    IF v_total < 0 OR v_total > 2147483647 THEN
      RAISE EXCEPTION 'ORDER_TOTAL_OUT_OF_RANGE';
    END IF;

    UPDATE public.orders AS o
    SET total_amount = v_total::integer
    WHERE o.id = v_order_id
      AND o.total_amount IS DISTINCT FROM v_total::integer;
  END LOOP;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.refresh_order_total_from_items() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.refresh_order_total_from_items()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS refresh_order_total_from_items ON public.order_items;
CREATE TRIGGER refresh_order_total_from_items
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW
EXECUTE FUNCTION public.refresh_order_total_from_items();

COMMENT ON FUNCTION public.refresh_order_total_from_items() IS
  'Authoritatively recomputes orders.total_amount after order_items DML; SECURITY DEFINER owner must remain postgres.';

COMMIT;
