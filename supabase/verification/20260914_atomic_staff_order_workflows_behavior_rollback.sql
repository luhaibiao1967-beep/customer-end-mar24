-- LOCAL TEST DATABASES ONLY.
-- Behaviour regression for 20260914200000_atomic_staff_order_workflows.sql.
-- All fixtures and mutations live inside one transaction and are rolled back.
-- Run with psql -v ON_ERROR_STOP=1. Expected result: every row is PASS,
-- followed by ROLLBACK.

DO $database_guard$
BEGIN
  IF current_database() NOT IN (
    'audit_root_acl18', 'audit_cafa_customer', 'audit_acl18'
  ) THEN
    RAISE EXCEPTION
      'LOCAL_ONLY: run this probe only on audit_root_acl18, audit_cafa_customer, or audit_acl18';
  END IF;
END;
$database_guard$;

BEGIN;

-- Historical schema-only clones omit one or another Supabase/runtime
-- prerequisite.  Recreate only the missing pieces inside this rollback-only
-- transaction so both restored shapes exercise the 2000 workflow itself.
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

  IF to_regprocedure(
       'public.cancel_customer_pending_order(uuid,uuid)'
     ) IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.cancel_customer_pending_order(
        p_customer_id uuid,
        p_order_id uuid
      )
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = pg_catalog, public
      AS $function$
      DECLARE
        v_order public.orders%ROWTYPE;
        v_customer_type text;
        v_net_voucher_qty integer;
      BEGIN
        SELECT o.*
          INTO v_order
        FROM public.orders AS o
        WHERE o.id = p_order_id
          AND o.customer_id = p_customer_id
        FOR UPDATE;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ORDER_NOT_FOUND';
        END IF;
        IF v_order.status IS DISTINCT FROM 'pending' THEN
          RAISE EXCEPTION 'ONLY_PENDING_ORDERS_CAN_BE_CANCELLED';
        END IF;
        IF v_order.is_active IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'ORDER_IS_INACTIVE';
        END IF;

        SELECT c.customer_type::text
          INTO v_customer_type
        FROM public.customers AS c
        WHERE c.id = p_customer_id;
        IF v_customer_type IS DISTINCT FROM 'pre_pay' THEN
          RAISE EXCEPTION 'TEST_PREREQUISITE_ONLY_PREPAY';
        END IF;

        SELECT COALESCE(sum(l.voucher_qty), 0)::integer
          INTO v_net_voucher_qty
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = p_order_id
          AND l.customer_id = p_customer_id;
        IF v_net_voucher_qty <= 0 THEN
          RAISE EXCEPTION 'VOUCHER_USAGE_NOT_FOUND';
        END IF;

        WITH net_by_product AS (
          SELECT
            l.product_id,
            sum(l.voucher_qty)::integer AS total_qty,
            COALESCE(
              sum(l.voucher_qty) FILTER (
                WHERE l.pricing_basis = 'gift_zero'
              ),
              0
            )::integer AS gift_qty
          FROM public.voucher_usage_ledger AS l
          WHERE l.order_id = p_order_id
            AND l.customer_id = p_customer_id
          GROUP BY l.product_id
          HAVING sum(l.voucher_qty) > 0
        )
        INSERT INTO public.customer_product_vouchers (
          customer_id, product_id, balance, gift_balance
        )
        SELECT p_customer_id, product_id, total_qty, gift_qty
        FROM net_by_product
        ON CONFLICT (customer_id, product_id) DO UPDATE
        SET
          balance = public.customer_product_vouchers.balance
                    + EXCLUDED.balance,
          gift_balance = public.customer_product_vouchers.gift_balance
                         + EXCLUDED.gift_balance;

        INSERT INTO public.voucher_usage_ledger (
          order_id, customer_id, branch, product_id,
          voucher_qty, unit_amount, line_amount, pricing_basis
        )
        SELECT
          p_order_id,
          p_customer_id,
          l.branch,
          l.product_id,
          -sum(l.voucher_qty)::integer,
          l.unit_amount,
          -sum(l.line_amount)::integer,
          l.pricing_basis
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = p_order_id
          AND l.customer_id = p_customer_id
        GROUP BY l.branch, l.product_id, l.unit_amount, l.pricing_basis
        HAVING sum(l.voucher_qty) > 0;

        UPDATE public.orders
        SET is_active = false, updated_at = now()
        WHERE id = p_order_id
          AND customer_id = p_customer_id
          AND is_active = true;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'ORDER_DEACTIVATION_FAILED';
        END IF;

        RETURN jsonb_build_object(
          'cancelled', true,
          'order_id', p_order_id,
          'refunded_voucher_qty', v_net_voucher_qty
        );
      END
      $function$
    $ddl$;
    EXECUTE $ddl$
      ALTER FUNCTION public.cancel_customer_pending_order(uuid, uuid)
      OWNER TO postgres
    $ddl$;
    EXECUTE $ddl$
      REVOKE ALL ON FUNCTION public.cancel_customer_pending_order(uuid, uuid)
      FROM PUBLIC, anon, authenticated
    $ddl$;
  END IF;
END;
$local_clone_prerequisites$;

CREATE TEMP TABLE atomic_staff_context (
  actor_id uuid NOT NULL,
  missing_actor_id uuid NOT NULL,
  branch_a text NOT NULL,
  branch_b text NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  product_price integer NOT NULL,
  non_refill_product_id uuid NOT NULL,
  collection_product_id uuid NOT NULL,
  delivery_a date NOT NULL,
  delivery_b date NOT NULL,
  customer_a uuid NOT NULL,
  customer_b uuid NOT NULL,
  customer_reprice uuid NOT NULL,
  customer_prepay uuid NOT NULL,
  order_main_a uuid NOT NULL,
  order_reprice_a uuid NOT NULL,
  order_cancel_a uuid NOT NULL,
  order_branch_admin_a uuid NOT NULL,
  order_guard_a uuid NOT NULL,
  order_non_refill_a uuid NOT NULL,
  order_collection_a uuid NOT NULL,
  order_b uuid NOT NULL,
  order_b_item_id uuid,
  prepay_cancel_key uuid NOT NULL,
  prepay_cancel_order_id uuid,
  prepay_delivery_key uuid NOT NULL,
  prepay_delivery_order_id uuid,
  prepay_insufficient_key uuid NOT NULL
) ON COMMIT DROP;

-- Build the complete fixture instead of borrowing business rows from the
-- restored database.  Only columns shared by the root and customer historical
-- schemas are named.  Everything is inside this transaction and is removed by
-- the final ROLLBACK.
WITH fixture_key AS (
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS suffix
), actor_auth AS (
  INSERT INTO auth.users (id)
  SELECT gen_random_uuid()
  FROM fixture_key
  RETURNING id
), branch_a AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, internal_demo,
    order_cutoff_hour, closed_weekdays
  )
  SELECT
    gen_random_uuid(),
    'Atomic 2000 A ' || suffix,
    'Rollback-only fixture address A',
    '620000009001',
    'active',
    false,
    23,
    '{}'::integer[]
  FROM fixture_key
  RETURNING name, closed_weekdays
), branch_b AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, internal_demo,
    order_cutoff_hour, closed_weekdays
  )
  SELECT
    gen_random_uuid(),
    'Atomic 2000 B ' || suffix,
    'Rollback-only fixture address B',
    '620000009002',
    'active',
    false,
    23,
    '{}'::integer[]
  FROM fixture_key
  RETURNING name, closed_weekdays
), actor AS (
  INSERT INTO public.profiles (
    id, email, name, role, branch, status, username, phone
  )
  SELECT
    actor_auth.id,
    'atomic-2000-' || fixture_key.suffix || '@example.invalid',
    'Atomic 2000 rollback actor',
    'sales',
    branch_a.name,
    'active',
    'atomic_2000_' || fixture_key.suffix,
    '620000009003'
  FROM actor_auth
  CROSS JOIN branch_a
  CROSS JOIN fixture_key
  RETURNING id
), product AS (
  INSERT INTO public.products (
    id, name, price, unit, is_refill, status
  )
  SELECT
    gen_random_uuid(),
    'Atomic 2000 refill ' || suffix,
    1100,
    'gallon',
    true,
    'active'
  FROM fixture_key
  RETURNING id, name, price
), non_refill_product AS (
  INSERT INTO public.products (
    id, name, price, unit, is_refill, status
  )
  SELECT
    gen_random_uuid(),
    'Atomic 2000 non-refill ' || suffix,
    700,
    'unit',
    false,
    'active'
  FROM fixture_key
  RETURNING id
), collection_product AS (
  INSERT INTO public.products (
    id, name, price, unit, is_refill, status
  )
  SELECT
    gen_random_uuid(),
    'Atomic 2000 empty collection ' || suffix,
    0,
    'gallon',
    false,
    'active'
  FROM fixture_key
  RETURNING id
)
INSERT INTO atomic_staff_context (
  actor_id, missing_actor_id, branch_a, branch_b,
  product_id, product_name, product_price,
  non_refill_product_id, collection_product_id, delivery_a, delivery_b,
  customer_a, customer_b, customer_reprice, customer_prepay,
  order_main_a, order_reprice_a, order_cancel_a,
  order_branch_admin_a, order_guard_a,
  order_non_refill_a, order_collection_a,
  order_b, prepay_cancel_key, prepay_delivery_key,
  prepay_insufficient_key
)
SELECT
  actor.id,
  gen_random_uuid(),
  branch_a.name,
  branch_b.name,
  product.id,
  product.name,
  product.price,
  non_refill_product.id,
  collection_product.id,
  delivery_a.delivery_date,
  delivery_b.delivery_date,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
FROM actor
CROSS JOIN branch_a
CROSS JOIN branch_b
CROSS JOIN product
CROSS JOIN non_refill_product
CROSS JOIN collection_product
CROSS JOIN LATERAL (
  SELECT candidate.day_value::date AS delivery_date
  FROM generate_series(
    current_date + 30,
    current_date + 60,
    interval '1 day'
  ) AS candidate(day_value)
  WHERE NOT (
    EXTRACT(DOW FROM candidate.day_value)::integer = ANY (
      COALESCE(branch_a.closed_weekdays, '{}'::integer[])
    )
  )
  ORDER BY candidate.day_value
  LIMIT 1
) AS delivery_a
CROSS JOIN LATERAL (
  SELECT candidate.day_value::date AS delivery_date
  FROM generate_series(
    current_date + 30,
    current_date + 60,
    interval '1 day'
  ) AS candidate(day_value)
  WHERE NOT (
    EXTRACT(DOW FROM candidate.day_value)::integer = ANY (
      COALESCE(branch_b.closed_weekdays, '{}'::integer[])
    )
  )
  ORDER BY candidate.day_value
  LIMIT 1
) AS delivery_b;

DO $fixture_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM atomic_staff_context) THEN
    RAISE EXCEPTION
      'TEST_FIXTURE_BUILD_FAILED: self-contained actor/branch/product fixture was not created';
  END IF;

  IF to_regprocedure(
       'public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)'
     ) IS NULL
     OR to_regprocedure(
       'public.correct_staff_order_atomic(uuid,uuid,date,text,integer,jsonb,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.finalize_staff_order_delivery(uuid,date,text,text,integer,jsonb,boolean,text,text)'
     ) IS NULL
     OR to_regprocedure('public.cancel_staff_order_atomic(uuid)') IS NULL THEN
    RAISE EXCEPTION
      'MIGRATION_MISSING: apply 20260914200000_atomic_staff_order_workflows.sql first';
  END IF;
END;
$fixture_guard$;

CREATE TEMP TABLE atomic_staff_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

GRANT SELECT ON TABLE atomic_staff_context TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE atomic_staff_results TO authenticated, service_role;

CREATE FUNCTION pg_temp.clear_test_claims()
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

CREATE FUNCTION pg_temp.set_test_claims(p_sub uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', p_role, 'sub', p_sub)::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
END;
$function$;

-- Failed statements, including an unexpected success, are rolled back to the
-- implicit savepoint created by this EXCEPTION block. This keeps later checks
-- independent from an attack that unexpectedly got through.
CREATE FUNCTION pg_temp.expect_sql(
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

    INSERT INTO pg_temp.atomic_staff_results (check_name, status, detail)
    VALUES (
      p_check_name,
      'PASS',
      format('succeeded; row count %s', v_rows)
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_message := SQLERRM;

      IF v_state IN ('ZX001', 'ZX002') OR p_should_succeed THEN
        INSERT INTO pg_temp.atomic_staff_results (check_name, status, detail)
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
        INSERT INTO pg_temp.atomic_staff_results (check_name, status, detail)
        VALUES (
          p_check_name,
          'PASS',
          format('rejected with SQLSTATE %s: %s', v_state, v_message)
        );
      ELSE
        INSERT INTO pg_temp.atomic_staff_results (check_name, status, detail)
        VALUES (
          p_check_name,
          'BLOCK',
          format('unexpected rejection, SQLSTATE %s: %s', v_state, v_message)
        );
      END IF;
  END;
END;
$function$;

CREATE FUNCTION pg_temp.expect_true(p_check_name text, p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_ok boolean;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v_ok;
    INSERT INTO pg_temp.atomic_staff_results (check_name, status, detail)
    VALUES (
      p_check_name,
      CASE WHEN v_ok IS TRUE THEN 'PASS' ELSE 'BLOCK' END,
      CASE WHEN v_ok IS TRUE THEN 'postcondition satisfied'
           ELSE 'postcondition was false or null' END
    );
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO pg_temp.atomic_staff_results (check_name, status, detail)
      VALUES (
        p_check_name,
        'BLOCK',
        format('SQLSTATE %s: %s', SQLSTATE, SQLERRM)
      );
  END;
END;
$function$;

-- Isolated business fixtures. Postgres setup is intentional; browser-facing
-- mutations below are made only as authenticated with JWT claims.
INSERT INTO public.customers (
  id, name, address, whatsapp, branch, customer_type, discount,
  is_active, created_by
)
SELECT customer_a, 'Atomic 2000 Later Pay A', 'Test address',
       '620000002001', branch_a, 'later_pay', 0, true, actor_id
FROM atomic_staff_context
UNION ALL
SELECT customer_b, 'Atomic 2000 Later Pay B', 'Test address',
       '620000002002', branch_b, 'later_pay', 0, true, actor_id
FROM atomic_staff_context
UNION ALL
SELECT customer_reprice, 'Atomic 2000 Later Pay Reprice', 'Test address',
       '620000002004', branch_a, 'later_pay', 100, true, actor_id
FROM atomic_staff_context
UNION ALL
SELECT customer_prepay, 'Atomic 2000 Prepay A', 'Test address',
       '620000002003', branch_a, 'pre_pay', 0, true, actor_id
FROM atomic_staff_context;

-- Gift vouchers avoid dependence on purchase/package cost-basis fixtures.
INSERT INTO public.customer_product_vouchers (
  customer_id, product_id, balance, gift_balance
)
SELECT customer_prepay, product_id, 3, 3
FROM atomic_staff_context;

-- -------------------------------------------------------------------------
-- Static ACL: authenticated has only the four RPC entry points. Direct order
-- creation/deletion and every direct order-item mutation are revoked.
-- -------------------------------------------------------------------------
SELECT pg_temp.expect_true(
  'acl_authenticated_rpc_execute_only',
  $sql$
    SELECT
      has_function_privilege(
        'authenticated',
        'public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)',
        'EXECUTE'
      )
      AND has_function_privilege(
        'authenticated',
        'public.correct_staff_order_atomic(uuid,uuid,date,text,integer,jsonb,text)',
        'EXECUTE'
      )
      AND has_function_privilege(
        'authenticated',
        'public.finalize_staff_order_delivery(uuid,date,text,text,integer,jsonb,boolean,text,text)',
        'EXECUTE'
      )
      AND has_function_privilege(
        'authenticated',
        'public.cancel_staff_order_atomic(uuid)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'anon',
        'public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'service_role',
        'public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)',
        'EXECUTE'
      )
  $sql$
);

SELECT pg_temp.expect_true(
  'acl_direct_order_insert_delete_revoked',
  $sql$
    SELECT
      NOT has_table_privilege('authenticated', 'public.orders', 'INSERT')
      AND NOT has_any_column_privilege(
        'authenticated', 'public.orders', 'INSERT'
      )
      AND NOT has_table_privilege('authenticated', 'public.orders', 'DELETE')
  $sql$
);

SELECT pg_temp.expect_true(
  'acl_direct_item_mutations_revoked',
  $sql$
    SELECT
      NOT has_table_privilege('authenticated', 'public.order_items', 'INSERT')
      AND NOT has_any_column_privilege(
        'authenticated', 'public.order_items', 'INSERT'
      )
      AND NOT has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
      AND NOT has_any_column_privilege(
        'authenticated', 'public.order_items', 'UPDATE'
      )
      AND NOT has_table_privilege('authenticated', 'public.order_items', 'DELETE')
      AND NOT has_table_privilege(
        'authenticated', 'public.order_corrections', 'INSERT'
      )
  $sql$
);

-- Missing/inactive profiles fail closed even though the function itself is
-- executable by authenticated.
SELECT pg_temp.set_test_claims(missing_actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'missing_profile_create_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, gen_random_uuid(), delivery_a, NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'STAFF_ORDER_CREATE_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

UPDATE public.profiles
SET role = 'sales', branch = context.branch_a, status = 'inactive'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'inactive_sales_create_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, gen_random_uuid(), delivery_a, NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'STAFF_ORDER_CREATE_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

-- -------------------------------------------------------------------------
-- Sales, branch A: later-pay creation/correction, direct ACL, soft cancel,
-- and voucher-only prepay conservation.
-- -------------------------------------------------------------------------
UPDATE public.profiles
SET role = 'sales', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'sales_direct_order_insert_denied',
  $sql$
    INSERT INTO public.orders (
      customer_id, customer_name, customer_address, customer_whatsapp,
      customer_discount, branch, total_amount, status, payment_status,
      delivery_date, created_by, created_by_display, is_active
    )
    SELECT customer_a, 'spoof', 'spoof', '620000009999', 0, branch_a,
           1, 'pending', 'unpaid', delivery_a, actor_id, 'Sales', true
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_create_later_pay_atomic',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_main_a, delivery_a, 'atomic-main',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1),
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_true(
  'later_pay_snapshot_and_duplicate_product_normalized',
  $sql$
    SELECT
      o.customer_id = context.customer_a
      AND o.branch = context.branch_a
      AND o.created_by = context.actor_id
      AND o.created_by_display = 'Sales'
      AND o.status = 'pending'
      AND o.payment_status = 'unpaid'
      AND o.total_amount = context.product_price * 2
      AND (
        SELECT count(*) = 1
          AND bool_and(oi.product_id = context.product_id)
          AND min(oi.product) = context.product_name
          AND sum(oi.quantity) = 2
          AND min(oi.unit_price) = context.product_price
          AND min(COALESCE(oi.discount, 0)) = 0
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_main_a
  $sql$
);

SELECT pg_temp.expect_sql(
  'sales_create_repricing_fixture',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_reprice_a, delivery_a, 'frozen-snapshot',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_true(
  'later_pay_same_key_idempotent',
  $sql$
    SELECT COALESCE(
      (
        public.create_staff_order_atomic(
          customer_a, order_main_a, delivery_a, 'atomic-main',
          jsonb_build_array(
            jsonb_build_object('product_id', product_id, 'quantity', 2)
          )
        )->>'already_created'
      )::boolean,
      false
    )
    FROM pg_temp.atomic_staff_context
  $sql$
);

SELECT pg_temp.expect_sql(
  'later_pay_same_key_changed_payload_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_main_a, delivery_a, 'atomic-main',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 3)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, NULL, 'STAFF_ORDER_KEY_CONFLICT'
);

SELECT pg_temp.expect_sql(
  'sales_cross_branch_create_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_b, gen_random_uuid(), delivery_b, NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'ORDER_BRANCH_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'sales_create_cancel_fixture',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_cancel_a, delivery_a, 'cancel-me',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_sql(
  'sales_create_branch_admin_delivery_fixture',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_branch_admin_a, delivery_a, 'branch-admin-delivery',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_sql(
  'sales_create_payment_role_guard_fixture',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_guard_a, delivery_a, 'payment-role-guard',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_sql(
  'sales_create_non_refill_delivery_fixture',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_non_refill_a, delivery_a, 'non-refill-guard',
      jsonb_build_array(
        jsonb_build_object(
          'product_id', non_refill_product_id,
          'quantity', 1
        )
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_sql(
  'sales_create_collection_delivery_fixture',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, order_collection_a, delivery_a, 'collection-guard',
      jsonb_build_array(
        jsonb_build_object(
          'product_id', collection_product_id,
          'quantity', 1
        )
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_sql(
  'sales_direct_order_delete_denied',
  $sql$
    DELETE FROM public.orders
    WHERE id = (SELECT order_main_a FROM pg_temp.atomic_staff_context)
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_direct_item_insert_denied',
  $sql$
    INSERT INTO public.order_items (
      order_id, product_id, product, is_refill, quantity, unit_price, discount
    )
    SELECT order_main_a, product_id, product_name, true, 1, product_price, 0
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_direct_item_update_denied',
  $sql$
    UPDATE public.order_items
    SET quantity = quantity + 1
    WHERE order_id = (SELECT order_main_a FROM pg_temp.atomic_staff_context)
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_direct_item_snapshot_tamper_denied',
  $sql$
    UPDATE public.order_items
    SET unit_price = 0, product = 'forged snapshot'
    WHERE order_id = (
      SELECT order_reprice_a FROM pg_temp.atomic_staff_context
    )
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_direct_item_delete_denied',
  $sql$
    DELETE FROM public.order_items
    WHERE order_id = (SELECT order_main_a FROM pg_temp.atomic_staff_context)
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_direct_correction_log_insert_denied',
  $sql$
    INSERT INTO public.order_corrections (
      order_id, corrected_by, changes, reason
    )
    SELECT order_main_a, actor_id, '{}'::jsonb, 'spoof'
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'sales_correct_later_pay_atomic',
  $sql$
    SELECT public.correct_staff_order_atomic(
      order_main_a, customer_a, delivery_a, 'atomic-corrected', 1,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 3)
      ),
      'regression correction'
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_true(
  'correction_replaces_items_reprices_and_audits',
  $sql$
    SELECT
      o.note = 'atomic-corrected'
      AND o.total_amount = context.product_price * 3
      AND o.empty_gallons_returned = 1
      AND o.borrowed_gallons = 2
      AND (
        SELECT count(*) = 1 AND sum(oi.quantity) = 3
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
      AND EXISTS (
        SELECT 1
        FROM public.order_corrections AS correction
        WHERE correction.order_id = o.id
          AND correction.corrected_by = context.actor_id
          AND correction.reason = 'regression correction'
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_main_a
  $sql$
);

SELECT pg_temp.expect_true(
  'ordinary_pending_cancel_returns_soft_mode',
  $sql$
    SELECT public.cancel_staff_order_atomic(order_cancel_a)->>'mode'
             = 'soft_cancel_unpaid'
    FROM pg_temp.atomic_staff_context
  $sql$
);

SELECT pg_temp.expect_true(
  'ordinary_cancel_preserves_audit_rows',
  $sql$
    SELECT
      o.is_active IS FALSE
      AND o.status = 'pending'
      AND o.payment_status = 'unpaid'
      AND EXISTS (
        SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_cancel_a
  $sql$
);

SELECT pg_temp.expect_sql(
  'staff_prepay_create_atomic',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_prepay, prepay_cancel_key, delivery_a, 'voucher-cancel',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;

UPDATE atomic_staff_context AS context
SET prepay_cancel_order_id = order_row.id
FROM public.orders AS order_row
WHERE order_row.voucher_order_key = context.prepay_cancel_key;

SELECT pg_temp.expect_true(
  'prepay_create_balance_order_items_ledger_conserved',
  $sql$
    SELECT
      context.prepay_cancel_order_id IS NOT NULL
      AND cpv.balance = 2
      AND cpv.gift_balance = 2
      AND o.payment_status = 'paid'
      AND o.is_active IS TRUE
      AND o.created_by = context.actor_id
      AND o.payment_confirmation_type = 'pre_pay'
      AND (
        SELECT COALESCE(sum(oi.quantity), 0) = 1
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id AND oi.product_id = context.product_id
      )
      AND (
        SELECT COALESCE(sum(l.voucher_qty), 0) = 1
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = o.id AND l.product_id = context.product_id
      )
    FROM pg_temp.atomic_staff_context AS context
    JOIN public.customer_product_vouchers AS cpv
      ON cpv.customer_id = context.customer_prepay
     AND cpv.product_id = context.product_id
    JOIN public.orders AS o ON o.id = context.prepay_cancel_order_id
  $sql$
);

SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'prepay_insufficient_balance_rolls_back_all',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_prepay, prepay_insufficient_key, delivery_a, 'too-many',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 3)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, NULL, 'INSUFFICIENT_OR_INVALID_VOUCHER_BALANCE'
);
RESET ROLE;

SELECT pg_temp.expect_true(
  'prepay_insufficient_has_no_partial_header_or_deduction',
  $sql$
    SELECT
      cpv.balance = 2
      AND cpv.gift_balance = 2
      AND NOT EXISTS (
        SELECT 1
        FROM public.orders AS o
        WHERE o.voucher_order_key = context.prepay_insufficient_key
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id IN (
          SELECT o.id
          FROM public.orders AS o
          WHERE o.voucher_order_key = context.prepay_insufficient_key
        )
      )
    FROM pg_temp.atomic_staff_context AS context
    JOIN public.customer_product_vouchers AS cpv
      ON cpv.customer_id = context.customer_prepay
     AND cpv.product_id = context.product_id
  $sql$
);

SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_true(
  'prepay_cancel_uses_voucher_refund_path',
  $sql$
    SELECT public.cancel_staff_order_atomic(prepay_cancel_order_id)->>'mode'
             = 'voucher_refund'
    FROM pg_temp.atomic_staff_context
  $sql$
);
RESET ROLE;

SELECT pg_temp.expect_true(
  'prepay_cancel_restores_balance_and_net_ledger_zero',
  $sql$
    SELECT
      cpv.balance = 3
      AND cpv.gift_balance = 3
      AND o.is_active IS FALSE
      AND EXISTS (
        SELECT 1 FROM public.order_items AS oi WHERE oi.order_id = o.id
      )
      AND (
        SELECT COALESCE(sum(l.voucher_qty), 0) = 0
          AND count(*) >= 2
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = o.id AND l.product_id = context.product_id
      )
    FROM pg_temp.atomic_staff_context AS context
    JOIN public.customer_product_vouchers AS cpv
      ON cpv.customer_id = context.customer_prepay
     AND cpv.product_id = context.product_id
    JOIN public.orders AS o ON o.id = context.prepay_cancel_order_id
  $sql$
);

SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'staff_prepay_delivery_fixture_create',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_prepay, prepay_delivery_key, delivery_a, 'voucher-delivery',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 2)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;

UPDATE atomic_staff_context AS context
SET prepay_delivery_order_id = order_row.id
FROM public.orders AS order_row
WHERE order_row.voucher_order_key = context.prepay_delivery_key;

SELECT pg_temp.expect_true(
  'prepay_second_create_conservation',
  $sql$
    SELECT
      context.prepay_delivery_order_id IS NOT NULL
      AND cpv.balance = 1
      AND cpv.gift_balance = 1
      AND (
        SELECT COALESCE(sum(l.voucher_qty), 0) = 2
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = context.prepay_delivery_order_id
          AND l.product_id = context.product_id
      )
    FROM pg_temp.atomic_staff_context AS context
    JOIN public.customer_product_vouchers AS cpv
      ON cpv.customer_id = context.customer_prepay
     AND cpv.product_id = context.product_id
  $sql$
);

SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'prepay_correction_denied',
  $sql$
    SELECT public.correct_staff_order_atomic(
      prepay_delivery_order_id, customer_prepay, delivery_a, NULL, 0,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 2)
      ),
      'must not edit voucher order'
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'ORDER_CORRECTION'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

-- Create a genuine branch-B order through the same RPC before exercising
-- global operator-manager and cross-branch rejection paths.
UPDATE public.profiles
SET role = 'sales', branch = context.branch_b, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'sales_branch_b_create_atomic',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_b, order_b, delivery_b, 'branch-b',
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;

UPDATE atomic_staff_context AS context
SET order_b_item_id = item_row.id
FROM public.order_items AS item_row
WHERE item_row.order_id = context.order_b;

DO $branch_b_item_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM atomic_staff_context WHERE order_b_item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING: branch-B item was not created';
  END IF;
END;
$branch_b_item_guard$;

SELECT pg_temp.clear_test_claims();

-- Freeze semantics: a same-customer correction keeps the order-item snapshot
-- even after catalog price changes.  Reassigning to another customer is the
-- explicit boundary that must rebuild every line from the current catalog and
-- the new customer's discount.
UPDATE public.products AS product
SET price = context.product_price + 400
FROM atomic_staff_context AS context
WHERE product.id = context.product_id;

UPDATE public.profiles
SET role = 'sales', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'same_customer_note_edit_keeps_frozen_snapshot',
  $sql$
    SELECT public.correct_staff_order_atomic(
      order_reprice_a, customer_a, delivery_a, 'snapshot-note-only', 0,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      ),
      'same customer snapshot regression'
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_true(
  'same_customer_note_edit_did_not_reprice',
  $sql$
    SELECT
      o.customer_id = context.customer_a
      AND o.customer_discount = 0
      AND o.total_amount = context.product_price
      AND (
        SELECT count(*) = 1
          AND min(oi.product) = context.product_name
          AND min(oi.unit_price) = context.product_price
          AND min(COALESCE(oi.discount, 0)) = 0
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_reprice_a
  $sql$
);

SELECT pg_temp.expect_sql(
  'customer_change_rebuilds_full_catalog_snapshot',
  $sql$
    SELECT public.correct_staff_order_atomic(
      order_reprice_a, customer_reprice, delivery_a, 'repriced-customer', 0,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      ),
      'customer reassignment regression'
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_true(
  'customer_change_uses_current_price_and_new_discount',
  $sql$
    SELECT
      o.customer_id = context.customer_reprice
      AND o.customer_name = 'Atomic 2000 Later Pay Reprice'
      AND o.customer_discount = 100
      AND o.total_amount = (context.product_price + 400 - 100)
      AND (
        SELECT count(*) = 1
          AND min(oi.product) = context.product_name
          AND min(oi.unit_price) = context.product_price + 400
          AND min(COALESCE(oi.discount, 0)) = 100
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_reprice_a
  $sql$
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

-- -------------------------------------------------------------------------
-- Branch admin: cannot create, cannot cross branches, and cannot receive
-- payment. Same-branch operational finalization remains allowed.
-- -------------------------------------------------------------------------
UPDATE public.profiles
SET role = 'branch_admin', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'branch_admin_rpc_create_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, gen_random_uuid(), delivery_a, NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'STAFF_ORDER_CREATE_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'branch_admin_direct_insert_denied',
  $sql$
    INSERT INTO public.orders (
      customer_id, customer_name, customer_address, customer_whatsapp,
      customer_discount, branch, total_amount, status, payment_status,
      delivery_date, created_by, created_by_display, is_active
    )
    SELECT customer_a, 'spoof', 'spoof', '620000009998', 0, branch_a,
           1, 'pending', 'unpaid', delivery_a, actor_id, 'Branch Admin', true
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501'
);

SELECT pg_temp.expect_sql(
  'branch_admin_payment_at_delivery_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_guard_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      'branch-admin-evidence', NULL, 0,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', oi.quantity)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_guard_a
      ),
      true, 'cash', NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '42501', 'ORDER_PAYMENT_ROLE_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'branch_admin_cross_branch_finalize_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_b,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 0,
      jsonb_build_array(
        jsonb_build_object(
          'item_id', context.order_b_item_id,
          'quantity', 1
        )
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '42501', 'ORDER_BRANCH_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'branch_admin_cross_branch_cancel_denied',
  $sql$
    SELECT public.cancel_staff_order_atomic(order_b)
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'ORDER_BRANCH_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'branch_admin_same_branch_finalize_allowed',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_branch_admin_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, 'branch-admin-finalized', 0,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', oi.quantity)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_branch_admin_a
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;

SELECT pg_temp.expect_true(
  'branch_admin_finalize_keeps_later_pay_unpaid',
  $sql$
    SELECT status = 'delivered'
       AND payment_status = 'unpaid'
       AND note = 'branch-admin-finalized'
    FROM public.orders
    WHERE id = (
      SELECT order_branch_admin_a FROM pg_temp.atomic_staff_context
    )
  $sql$
);
SELECT pg_temp.clear_test_claims();

-- -------------------------------------------------------------------------
-- Operator: direct UPDATE ... RETURNING still schedules an order, while the
-- RPC atomically validates the full item set, quantity, total and settlement.
-- -------------------------------------------------------------------------
UPDATE public.profiles
SET role = 'operator', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'operator_direct_schedule_returning_allowed',
  $sql$
    UPDATE public.orders
    SET status = 'scheduled'
    WHERE id = (SELECT order_main_a FROM pg_temp.atomic_staff_context)
    RETURNING id
  $sql$,
  true, NULL, NULL, 1
);

-- Scheduling closes the sales correction/cancellation window.  Exercise both
-- entry points as sales, then restore operator claims for delivery tests.
RESET ROLE;
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'sales', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'sales_scheduled_order_correction_denied',
  $sql$
    SELECT public.correct_staff_order_atomic(
      order_main_a, customer_a, delivery_a, 'must-not-correct', 0,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 3)
      ),
      'scheduled order must be immutable to sales'
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'ORDER_CORRECTION_STATE_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'sales_scheduled_order_cancel_denied',
  $sql$
    SELECT public.cancel_staff_order_atomic(order_main_a)
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'ORDER_CANCEL_REQUIRES_FINANCIAL_REVERSAL'
);

RESET ROLE;
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'operator', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'operator_correction_rpc_denied',
  $sql$
    SELECT public.correct_staff_order_atomic(
      order_main_a, customer_a, delivery_a, NULL, 0,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      ),
      NULL
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'STAFF_ORDER_CORRECTION_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'operator_actual_item_set_mismatch_rolls_back',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_main_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 1,
      jsonb_build_array(
        jsonb_build_object('item_id', gen_random_uuid(), 'quantity', 4)
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '22023', 'ACTUAL_ITEMS_MUST_MATCH_ORDER'
);

SELECT pg_temp.expect_sql(
  'operator_duplicate_actual_item_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_main_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 1,
      (
        SELECT jsonb_build_array(
          jsonb_build_object('item_id', oi.id, 'quantity', 3),
          jsonb_build_object('item_id', oi.id, 'quantity', 3)
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_main_a
        LIMIT 1
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '22023', 'DUPLICATE_ACTUAL_ITEM'
);

SELECT pg_temp.expect_sql(
  'operator_non_refill_quantity_change_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_non_refill_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 0,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', 2)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_non_refill_a
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '42501', 'NON_REFILL_DELIVERY_QUANTITY_IMMUTABLE'
);

SELECT pg_temp.expect_true(
  'non_refill_rejection_is_atomic',
  $sql$
    SELECT
      o.status = 'pending'
      AND (
        SELECT sum(oi.quantity) = 1
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    WHERE o.id = (
      SELECT order_non_refill_a FROM pg_temp.atomic_staff_context
    )
  $sql$
);

SELECT pg_temp.expect_sql(
  'operator_collection_count_mismatch_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_collection_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 1,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', 2)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_collection_a
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '22023', 'COLLECTION_COUNT_MISMATCH'
);

SELECT pg_temp.expect_true(
  'collection_mismatch_rejection_is_atomic',
  $sql$
    SELECT
      o.status = 'pending'
      AND (
        SELECT sum(oi.quantity) = 1
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    WHERE o.id = (
      SELECT order_collection_a FROM pg_temp.atomic_staff_context
    )
  $sql$
);

SELECT pg_temp.expect_sql(
  'operator_transfer_without_evidence_rolls_back',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_main_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 1,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', 4)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_main_a
      ),
      true, 'transfer', NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '22023', 'INVALID_DELIVERY_PAYMENT'
);

SELECT pg_temp.expect_true(
  'failed_finalize_attempts_leave_order_and_items_unchanged',
  $sql$
    SELECT
      o.status = 'scheduled'
      AND o.payment_status = 'unpaid'
      AND o.total_amount = context.product_price * 3
      AND (
        SELECT sum(oi.quantity) = 3
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_main_a
  $sql$
);

SELECT pg_temp.expect_sql(
  'operator_finalize_and_transfer_atomic',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_main_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      'delivery-proof', 'delivered-atomically', 1,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', 4)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_main_a
      ),
      true, 'transfer', 'transfer-proof'
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  true, NULL, NULL, 1
);

SELECT pg_temp.expect_true(
  'finalize_recomputes_total_gallons_and_payment',
  $sql$
    SELECT
      o.status = 'delivered'
      AND o.payment_status = 'paid'
      AND o.payment_confirmation_type = 'transfer'
      AND o.payment_evidence = 'transfer-proof'
      AND o.delivery_evidence = 'delivery-proof'
      AND o.note = 'delivered-atomically'
      AND o.total_amount = context.product_price * 4
      AND o.empty_gallons_returned = 1
      AND o.borrowed_gallons = 3
      AND (
        SELECT sum(oi.quantity) = 4
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id
      )
    FROM public.orders AS o
    CROSS JOIN pg_temp.atomic_staff_context AS context
    WHERE o.id = context.order_main_a
  $sql$
);

SELECT pg_temp.expect_true(
  'finalize_same_payload_is_idempotent',
  $sql$
    SELECT COALESCE(
      (
        public.finalize_staff_order_delivery(
          order_main_a,
          (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
          'ignored-on-retry', 'ignored-on-retry', 1,
          (
            SELECT jsonb_agg(
              jsonb_build_object('item_id', oi.id, 'quantity', oi.quantity)
              ORDER BY oi.id
            )
            FROM public.order_items AS oi
            WHERE oi.order_id = context.order_main_a
          ),
          false, NULL, NULL
        )->>'already_delivered'
      )::boolean,
      false
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$
);

-- A fulfilled and financially settled ordinary order is audit evidence.  Even
-- an admin must use an explicit reversal workflow instead of hiding it through
-- the narrow direct soft-inactivation allowance.
RESET ROLE;
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'admin', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'admin_delivered_paid_direct_inactivation_denied',
  $sql$
    UPDATE public.orders
    SET is_active = false
    WHERE id = (SELECT order_main_a FROM pg_temp.atomic_staff_context)
  $sql$,
  false, '42501', 'ORDER_INACTIVATION_FORBIDDEN'
);
SELECT pg_temp.expect_true(
  'delivered_paid_order_remains_active_after_inactivation_attempt',
  $sql$
    SELECT o.is_active IS TRUE
    FROM public.orders AS o
    WHERE o.id = (SELECT order_main_a FROM pg_temp.atomic_staff_context)
  $sql$
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'operator', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'operator_cross_branch_finalize_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_b,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 0,
      jsonb_build_array(
        jsonb_build_object(
          'item_id', context.order_b_item_id,
          'quantity', 1
        )
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '42501', 'ORDER_BRANCH_FORBIDDEN'
);

SELECT pg_temp.expect_sql(
  'prepay_delivery_quantity_change_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      prepay_delivery_order_id,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 0,
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'item_id', oi.id,
            'quantity', oi.quantity + 1
          )
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.prepay_delivery_order_id
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '42501', 'PAID_ORDER_QUANTITY_IMMUTABLE'
);

SELECT pg_temp.expect_sql(
  'prepay_delivery_exact_quantity_allowed',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      prepay_delivery_order_id,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, 'voucher-delivered', 0,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', oi.quantity)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.prepay_delivery_order_id
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;

SELECT pg_temp.expect_true(
  'prepay_delivery_preserves_voucher_conservation',
  $sql$
    SELECT
      o.status = 'delivered'
      AND o.payment_status = 'paid'
      AND o.total_amount = 0
      AND cpv.balance = 1
      AND cpv.gift_balance = 1
      AND (
        SELECT COALESCE(sum(oi.quantity), 0) = 2
        FROM public.order_items AS oi
        WHERE oi.order_id = o.id AND oi.product_id = context.product_id
      )
      AND (
        SELECT COALESCE(sum(l.voucher_qty), 0) = 2
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = o.id AND l.product_id = context.product_id
      )
    FROM pg_temp.atomic_staff_context AS context
    JOIN public.orders AS o ON o.id = context.prepay_delivery_order_id
    JOIN public.customer_product_vouchers AS cpv
      ON cpv.customer_id = context.customer_prepay
     AND cpv.product_id = context.product_id
  $sql$
);
SELECT pg_temp.clear_test_claims();

-- operator_manager with branch All is the sole non-admin global delivery role.
UPDATE public.profiles
SET role = 'operator_manager', branch = 'All', status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'operator_manager_all_cross_branch_finalize_allowed',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_b,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, 'global-manager', 0,
      jsonb_build_array(
        jsonb_build_object(
          'item_id', context.order_b_item_id,
          'quantity', 1
        )
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  true, NULL, NULL, 1
);
RESET ROLE;

SELECT pg_temp.expect_true(
  'operator_manager_all_finalize_keeps_unpaid',
  $sql$
    SELECT status = 'delivered'
       AND payment_status = 'unpaid'
       AND note = 'global-manager'
    FROM public.orders
    WHERE id = (SELECT order_b FROM pg_temp.atomic_staff_context)
  $sql$
);
SELECT pg_temp.clear_test_claims();

-- Finance and read-only admin roles have no atomic workflow authority.
UPDATE public.profiles
SET role = 'finance', branch = 'All', status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'finance_finalize_denied',
  $sql$
    SELECT public.finalize_staff_order_delivery(
      order_guard_a,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 0,
      (
        SELECT jsonb_agg(
          jsonb_build_object('item_id', oi.id, 'quantity', oi.quantity)
          ORDER BY oi.id
        )
        FROM public.order_items AS oi
        WHERE oi.order_id = context.order_guard_a
      ),
      false, NULL, NULL
    )
    FROM pg_temp.atomic_staff_context AS context
  $sql$,
  false, '42501', 'STAFF_ORDER_DELIVERY_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

UPDATE public.profiles
SET role = 'operations_admin', branch = context.branch_a, status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'operations_admin_create_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, gen_random_uuid(), delivery_a, NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'STAFF_ORDER_CREATE_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

UPDATE public.profiles
SET role = 'adminFin', branch = 'All', status = 'active'
FROM atomic_staff_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM atomic_staff_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'admin_fin_create_denied',
  $sql$
    SELECT public.create_staff_order_atomic(
      customer_a, gen_random_uuid(), delivery_a, NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', product_id, 'quantity', 1)
      )
    )
    FROM pg_temp.atomic_staff_context
  $sql$,
  false, '42501', 'STAFF_ORDER_CREATE_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

SELECT check_name, status, detail
FROM atomic_staff_results
ORDER BY check_name;

DO $assert_all_passed$
DECLARE
  v_total integer;
  v_blocks integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status <> 'PASS')
    INTO v_total, v_blocks
  FROM atomic_staff_results;

  IF v_total < 40 THEN
    RAISE EXCEPTION
      'ATOMIC_STAFF_ORDER_REGRESSION_INCOMPLETE: only % checks ran', v_total;
  END IF;
  IF v_blocks <> 0 THEN
    RAISE EXCEPTION
      'ATOMIC_STAFF_ORDER_REGRESSION_FAILED: % of % checks blocked',
      v_blocks, v_total;
  END IF;
END;
$assert_all_passed$;

ROLLBACK;
