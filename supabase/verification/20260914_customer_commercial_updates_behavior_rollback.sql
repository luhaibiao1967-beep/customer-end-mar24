-- LOCAL TEST DATABASES ONLY.
-- Behaviour regression for
-- 20260914210000_harden_customer_commercial_updates.sql.
-- Every fixture and mutation is rolled back. Run with psql
-- -v ON_ERROR_STOP=1. Expected result: every row is PASS, then ROLLBACK.

DO $database_guard$
BEGIN
  IF current_database() NOT IN (
    'audit_root_acl18', 'audit_cafa_customer', 'audit_acl18'
  ) THEN
    RAISE EXCEPTION
      'LOCAL_ONLY: run only on an approved disposable audit database';
  END IF;
END;
$database_guard$;

BEGIN;

-- A schema-only historical clone may omit the Supabase auth.role() helper.
-- Recreate it only inside this rollback transaction so the restored cafa
-- shape can exercise the same trigger code as hosted Supabase.
DO $local_clone_prerequisites$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION auth.role()
      RETURNS text
      LANGUAGE sql
      STABLE
      AS $function$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.role', true), ''),
          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb)->>'role'
        )
      $function$
    $ddl$;
  END IF;
END;
$local_clone_prerequisites$;

DO $migration_guard$
BEGIN
  IF to_regprocedure('public.guard_customer_commercial_write()') IS NULL THEN
    RAISE EXCEPTION
      'MIGRATION_MISSING: apply 20260914210000_harden_customer_commercial_updates.sql first';
  END IF;
END;
$migration_guard$;

CREATE TEMP TABLE customer_commercial_context (
  sales_id uuid NOT NULL,
  branch_admin_id uuid NOT NULL,
  finance_id uuid NOT NULL,
  operations_admin_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  branch_name text NOT NULL,
  refill_product_id uuid NOT NULL,
  clean_customer_id uuid NOT NULL,
  active_order_customer_id uuid NOT NULL,
  legacy_balance_customer_id uuid NOT NULL,
  product_balance_customer_id uuid NOT NULL,
  ledger_customer_id uuid NOT NULL,
  purchase_customer_id uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE customer_commercial_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

GRANT SELECT ON TABLE customer_commercial_context
  TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE customer_commercial_results
  TO authenticated, service_role;

CREATE FUNCTION pg_temp.clear_customer_test_claims()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$function$;

CREATE FUNCTION pg_temp.set_customer_test_claims(p_sub uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_sub)::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
END;
$function$;

CREATE FUNCTION pg_temp.expect_customer_sql(
  p_check_name text,
  p_sql text,
  p_should_succeed boolean,
  p_expected_sqlstate text DEFAULT NULL,
  p_expected_message text DEFAULT NULL,
  p_expected_rows integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_rows integer;
  v_state text;
  v_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF NOT p_should_succeed THEN
      RAISE EXCEPTION 'unexpected success (% row(s))', v_rows
        USING ERRCODE = 'ZX001';
    END IF;
    IF p_expected_rows IS NOT NULL AND v_rows <> p_expected_rows THEN
      RAISE EXCEPTION 'unexpected row count: expected %, got %',
        p_expected_rows, v_rows
        USING ERRCODE = 'ZX002';
    END IF;
    INSERT INTO pg_temp.customer_commercial_results
      (check_name, status, detail)
    VALUES (p_check_name, 'PASS', format('succeeded; row count %s', v_rows));
  EXCEPTION
    WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_message := SQLERRM;
      IF v_state IN ('ZX001', 'ZX002') OR p_should_succeed THEN
        INSERT INTO pg_temp.customer_commercial_results
          (check_name, status, detail)
        VALUES (
          p_check_name,
          'BLOCK',
          format('SQLSTATE %s: %s', v_state, v_message)
        );
      ELSIF (p_expected_sqlstate IS NULL OR v_state = p_expected_sqlstate)
        AND (
          p_expected_message IS NULL
          OR position(lower(p_expected_message) IN lower(v_message)) > 0
        ) THEN
        INSERT INTO pg_temp.customer_commercial_results
          (check_name, status, detail)
        VALUES (
          p_check_name,
          'PASS',
          format('rejected with SQLSTATE %s: %s', v_state, v_message)
        );
      ELSE
        INSERT INTO pg_temp.customer_commercial_results
          (check_name, status, detail)
        VALUES (
          p_check_name,
          'BLOCK',
          format('unexpected rejection, SQLSTATE %s: %s', v_state, v_message)
        );
      END IF;
  END;
END;
$function$;

SELECT pg_temp.clear_customer_test_claims();

WITH fixture_key AS (
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS suffix
), actor_ids AS (
  SELECT
    gen_random_uuid() AS sales_id,
    gen_random_uuid() AS branch_admin_id,
    gen_random_uuid() AS finance_id,
    gen_random_uuid() AS operations_admin_id,
    gen_random_uuid() AS admin_id
), auth_rows AS (
  INSERT INTO auth.users (id)
  SELECT actor_id
  FROM actor_ids
  CROSS JOIN LATERAL unnest(ARRAY[
    sales_id, branch_admin_id, finance_id, operations_admin_id, admin_id
  ]) AS actors(actor_id)
  RETURNING id
), fixture_branch AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, internal_demo,
    order_cutoff_hour, closed_weekdays
  )
  SELECT
    gen_random_uuid(),
    'Customer commercial ' || suffix,
    'Rollback-only fixture address',
    '620000008001',
    'active',
    false,
    23,
    '{}'::integer[]
  FROM fixture_key
  RETURNING name
), actor_profiles AS (
  INSERT INTO public.profiles (
    id, email, name, role, branch, status, username, phone
  )
  SELECT actor.id, actor.email, actor.name, actor.role,
         fixture_branch.name, 'active', actor.username, actor.phone
  FROM actor_ids
  CROSS JOIN fixture_key
  CROSS JOIN fixture_branch
  CROSS JOIN LATERAL (VALUES
    (sales_id, 'sales-' || suffix || '@example.invalid',
      'Customer commercial sales', 'sales',
      'commercial_sales_' || suffix, '620000008011'),
    (branch_admin_id, 'branch-admin-' || suffix || '@example.invalid',
      'Customer commercial branch admin', 'branch_admin',
      'commercial_branch_admin_' || suffix, '620000008012'),
    (finance_id, 'finance-' || suffix || '@example.invalid',
      'Customer commercial finance', 'finance',
      'commercial_finance_' || suffix, '620000008013'),
    (operations_admin_id, 'operations-admin-' || suffix || '@example.invalid',
      'Customer commercial operations admin', 'operations_admin',
      'commercial_operations_admin_' || suffix, '620000008014'),
    (admin_id, 'admin-' || suffix || '@example.invalid',
      'Customer commercial admin', 'admin',
      'commercial_admin_' || suffix, '620000008015')
  ) AS actor(id, email, name, role, username, phone)
  RETURNING id
), refill_product AS (
  INSERT INTO public.products (
    id, name, price, unit, is_refill, status
  )
  SELECT
    gen_random_uuid(),
    'Customer commercial refill ' || suffix,
    10000,
    'gallon',
    true,
    'active'
  FROM fixture_key
  RETURNING id
), fixture_customers AS (
  INSERT INTO public.customers (
    id, name, address, whatsapp, discount, branch, created_by,
    payment_term, customer_type, voucher_balance, is_active,
    payment_method
  )
  SELECT
    gen_random_uuid(),
    customer.label || ' ' || fixture_key.suffix,
    'Rollback-only customer address',
    customer.whatsapp,
    0,
    fixture_branch.name,
    actor_ids.sales_id,
    'daily',
    'later_pay',
    customer.legacy_balance,
    true,
    'transfer'
  FROM fixture_key
  CROSS JOIN fixture_branch
  CROSS JOIN actor_ids
  CROSS JOIN (VALUES
    ('clean', '620000008101', 0),
    ('active-order', '620000008102', 0),
    ('legacy-balance', '620000008103', 1),
    ('product-balance', '620000008104', 0),
    ('ledger', '620000008105', 0),
    ('purchase', '620000008106', 0)
  ) AS customer(label, whatsapp, legacy_balance)
  RETURNING id, name
), fixture_map AS (
  SELECT
    (array_agg(id) FILTER (WHERE name LIKE 'clean %'))[1]
      AS clean_customer_id,
    (array_agg(id) FILTER (WHERE name LIKE 'active-order %'))[1]
      AS active_order_customer_id,
    (array_agg(id) FILTER (WHERE name LIKE 'legacy-balance %'))[1]
      AS legacy_balance_customer_id,
    (array_agg(id) FILTER (WHERE name LIKE 'product-balance %'))[1]
      AS product_balance_customer_id,
    (array_agg(id) FILTER (WHERE name LIKE 'ledger %'))[1]
      AS ledger_customer_id,
    (array_agg(id) FILTER (WHERE name LIKE 'purchase %'))[1]
      AS purchase_customer_id
  FROM fixture_customers
), active_order AS (
  INSERT INTO public.orders (
    id, customer_id, customer_name, customer_address,
    customer_whatsapp, customer_discount, branch, total_amount,
    status, payment_status, delivery_date, created_by,
    created_by_display, is_active
  )
  SELECT
    gen_random_uuid(), active_order_customer_id,
    'active-order ' || fixture_key.suffix,
    'Rollback-only customer address', '620000008102', 0,
    fixture_branch.name, 10000, 'pending', 'unpaid', current_date + 1,
    actor_ids.sales_id, 'Customer commercial sales', true
  FROM fixture_map
  CROSS JOIN fixture_key
  CROSS JOIN fixture_branch
  CROSS JOIN actor_ids
  RETURNING id
), inactive_ledger_order AS (
  INSERT INTO public.orders (
    id, customer_id, customer_name, customer_address,
    customer_whatsapp, customer_discount, branch, total_amount,
    status, payment_status, delivery_date, created_by,
    created_by_display, is_active
  )
  SELECT
    gen_random_uuid(), ledger_customer_id,
    'ledger ' || fixture_key.suffix,
    'Rollback-only customer address', '620000008105', 0,
    fixture_branch.name, 0, 'pending', 'paid', current_date + 1,
    actor_ids.sales_id, 'Customer commercial sales', false
  FROM fixture_map
  CROSS JOIN fixture_key
  CROSS JOIN fixture_branch
  CROSS JOIN actor_ids
  RETURNING id
), product_balance AS (
  INSERT INTO public.customer_product_vouchers (
    customer_id, product_id, balance, gift_balance
  )
  SELECT product_balance_customer_id, refill_product.id, 1, 0
  FROM fixture_map
  CROSS JOIN refill_product
  RETURNING customer_id
), ledger_row AS (
  INSERT INTO public.voucher_usage_ledger (
    order_id, customer_id, branch, product_id,
    voucher_qty, unit_amount, line_amount, pricing_basis
  )
  SELECT inactive_ledger_order.id, fixture_map.ledger_customer_id,
         fixture_branch.name, refill_product.id,
         1, 10000, 10000, 'purchase_weighted_avg'
  FROM inactive_ledger_order
  CROSS JOIN fixture_map
  CROSS JOIN fixture_branch
  CROSS JOIN refill_product
  RETURNING customer_id
), purchase_row AS (
  INSERT INTO public.voucher_purchase_requests (
    customer_id, product_id, qty, amount_paid, status
  )
  SELECT purchase_customer_id, refill_product.id, 1, 10000, 'pending'
  FROM fixture_map
  CROSS JOIN refill_product
  RETURNING customer_id
)
INSERT INTO customer_commercial_context (
  sales_id, branch_admin_id, finance_id, operations_admin_id,
  admin_id, branch_name, refill_product_id, clean_customer_id,
  active_order_customer_id, legacy_balance_customer_id,
  product_balance_customer_id, ledger_customer_id, purchase_customer_id
)
SELECT
  actor_ids.sales_id, actor_ids.branch_admin_id, actor_ids.finance_id,
  actor_ids.operations_admin_id, actor_ids.admin_id,
  fixture_branch.name, refill_product.id,
  fixture_map.clean_customer_id, fixture_map.active_order_customer_id,
  fixture_map.legacy_balance_customer_id,
  fixture_map.product_balance_customer_id, fixture_map.ledger_customer_id,
  fixture_map.purchase_customer_id
FROM actor_ids
CROSS JOIN fixture_branch
CROSS JOIN refill_product
CROSS JOIN fixture_map
CROSS JOIN active_order
CROSS JOIN product_balance
CROSS JOIN ledger_row
CROSS JOIN purchase_row;

-- Finance may maintain settlement terms, but nothing else on the customer.
SELECT pg_temp.set_customer_test_claims(finance_id)
FROM customer_commercial_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_customer_sql(
  'finance_payment_terms_allowed',
  $sql$
    UPDATE public.customers
    SET payment_term = 'weekly', payment_method = 'cash', updated_at = now()
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  true, NULL, NULL, 1
);
SELECT pg_temp.expect_customer_sql(
  'finance_discount_denied',
  $sql$
    UPDATE public.customers
    SET discount = 1
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '42501', 'FINANCE_CUSTOMER_UPDATE_FORBIDDEN'
);
SELECT pg_temp.expect_customer_sql(
  'finance_customer_type_denied',
  $sql$
    UPDATE public.customers
    SET customer_type = 'pre_pay'
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '42501', 'FINANCE_CUSTOMER_UPDATE_FORBIDDEN'
);
SELECT pg_temp.expect_customer_sql(
  'finance_identity_update_denied',
  $sql$
    UPDATE public.customers
    SET name = name || ' attack'
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '42501', 'FINANCE_CUSTOMER_UPDATE_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_customer_test_claims();

-- Legacy operations admin can maintain operational data, but cannot choose or
-- change commercial terms. A neutral pre-pay/zero-discount insert still works.
SELECT pg_temp.set_customer_test_claims(operations_admin_id)
FROM customer_commercial_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_customer_sql(
  'operations_admin_operational_update_allowed',
  $sql$
    UPDATE public.customers
    SET address = 'Updated operational address', updated_at = now()
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  true, NULL, NULL, 1
);
SELECT pg_temp.expect_customer_sql(
  'operations_admin_discount_denied',
  $sql$
    UPDATE public.customers
    SET discount = 1
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '42501', 'CUSTOMER_COMMERCIAL_FIELDS_FORBIDDEN'
);
SELECT pg_temp.expect_customer_sql(
  'operations_admin_customer_type_denied',
  $sql$
    UPDATE public.customers
    SET customer_type = 'pre_pay'
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '42501', 'CUSTOMER_COMMERCIAL_FIELDS_FORBIDDEN'
);
SELECT pg_temp.expect_customer_sql(
  'operations_admin_neutral_insert_allowed',
  $sql$
    INSERT INTO public.customers (
      name, address, whatsapp, discount, branch, created_by,
      payment_term, customer_type, is_active, payment_method
    )
    SELECT
      'Neutral operations customer', 'Rollback-only address',
      '620000008201', 0, branch_name, operations_admin_id,
      'daily', 'pre_pay', true, 'transfer'
    FROM pg_temp.customer_commercial_context
  $sql$,
  true, NULL, NULL, 1
);
SELECT pg_temp.expect_customer_sql(
  'operations_admin_commercial_insert_denied',
  $sql$
    INSERT INTO public.customers (
      name, address, whatsapp, discount, branch, created_by,
      payment_term, customer_type, is_active, payment_method
    )
    SELECT
      'Commercial operations attack', 'Rollback-only address',
      '620000008202', 1, branch_name, operations_admin_id,
      'daily', 'later_pay', true, 'transfer'
    FROM pg_temp.customer_commercial_context
  $sql$,
  false, '42501', 'CUSTOMER_COMMERCIAL_FIELDS_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_customer_test_claims();

-- Sales and branch admin retain the existing customer-maintenance workflow,
-- with an explicit range tied to the cheapest active refill product.
SELECT pg_temp.set_customer_test_claims(sales_id)
FROM customer_commercial_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_customer_sql(
  'sales_discount_within_range_allowed',
  $sql$
    UPDATE public.customers
    SET discount = 5000, updated_at = now()
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  true, NULL, NULL, 1
);
SELECT pg_temp.expect_customer_sql(
  'sales_negative_discount_denied',
  $sql$
    UPDATE public.customers
    SET discount = -1
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '22023', 'CUSTOMER_DISCOUNT_OUT_OF_RANGE'
);
SELECT pg_temp.expect_customer_sql(
  'sales_discount_above_refill_min_denied',
  $sql$
    UPDATE public.customers
    SET discount = 10001
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '22023', 'CUSTOMER_DISCOUNT_OUT_OF_RANGE'
);
SELECT pg_temp.expect_customer_sql(
  'sales_customer_type_immutable',
  $sql$
    UPDATE public.customers
    SET customer_type = 'pre_pay', updated_at = now()
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  false, '55000', 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
);
RESET ROLE;
SELECT pg_temp.clear_customer_test_claims();

SELECT pg_temp.set_customer_test_claims(branch_admin_id)
FROM customer_commercial_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_customer_sql(
  'branch_admin_discount_allowed',
  $sql$
    UPDATE public.customers
    SET discount = 10000, updated_at = now()
    WHERE id = (SELECT clean_customer_id FROM pg_temp.customer_commercial_context)
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;
SELECT pg_temp.clear_customer_test_claims();

-- Customer type is immutable after creation, regardless of whether financial
-- exposure exists.  The varied fixtures ensure no historical state opens a
-- browser-side transition path.
SELECT pg_temp.set_customer_test_claims(sales_id)
FROM customer_commercial_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_customer_sql(
  'type_change_active_order_denied',
  $sql$
    UPDATE public.customers SET customer_type = 'pre_pay'
    WHERE id = (
      SELECT active_order_customer_id
      FROM pg_temp.customer_commercial_context
    )
  $sql$,
  false, '55000', 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
);
SELECT pg_temp.expect_customer_sql(
  'type_change_legacy_balance_denied',
  $sql$
    UPDATE public.customers SET customer_type = 'pre_pay'
    WHERE id = (
      SELECT legacy_balance_customer_id
      FROM pg_temp.customer_commercial_context
    )
  $sql$,
  false, '55000', 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
);
SELECT pg_temp.expect_customer_sql(
  'type_change_product_balance_denied',
  $sql$
    UPDATE public.customers SET customer_type = 'pre_pay'
    WHERE id = (
      SELECT product_balance_customer_id
      FROM pg_temp.customer_commercial_context
    )
  $sql$,
  false, '55000', 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
);
SELECT pg_temp.expect_customer_sql(
  'type_change_ledger_history_denied',
  $sql$
    UPDATE public.customers SET customer_type = 'pre_pay'
    WHERE id = (
      SELECT ledger_customer_id
      FROM pg_temp.customer_commercial_context
    )
  $sql$,
  false, '55000', 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
);
SELECT pg_temp.expect_customer_sql(
  'type_change_purchase_request_denied',
  $sql$
    UPDATE public.customers SET customer_type = 'pre_pay'
    WHERE id = (
      SELECT purchase_customer_id
      FROM pg_temp.customer_commercial_context
    )
  $sql$,
  false, '55000', 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
);
RESET ROLE;
SELECT pg_temp.clear_customer_test_claims();

TABLE customer_commercial_results ORDER BY check_name;

DO $assert_all_passed$
DECLARE
  v_total integer;
  v_blocked integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status <> 'PASS')
    INTO v_total, v_blocked
  FROM customer_commercial_results;

  IF v_total <> 19 OR v_blocked <> 0 THEN
    RAISE EXCEPTION
      'CUSTOMER_COMMERCIAL_REGRESSION_FAILED: expected 19 PASS rows, got % total and % blocked',
      v_total, v_blocked;
  END IF;
END;
$assert_all_passed$;

ROLLBACK;
