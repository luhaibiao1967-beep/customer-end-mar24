-- LOCAL TEST DATABASES ONLY.
-- Behaviour regression for the shared customer transaction lock plus the
-- atomic staff payment, payment evidence, trip and customer-delivery RPCs.
-- All fixtures and mutations are rolled back. Run with psql
-- -v ON_ERROR_STOP=1. Expected result: every row is PASS, then ROLLBACK.

DO $database_guard$
BEGIN
  IF current_database() NOT IN (
    'audit_root_acl18', 'audit_cafa_customer', 'audit_acl18'
  ) THEN
    RAISE EXCEPTION
      'LOCAL_ONLY: run this probe only on an approved local audit database';
  END IF;
END;
$database_guard$;

BEGIN;

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
  IF to_regprocedure(
       'public.confirm_staff_order_payment_atomic(uuid[],text,text,numeric)'
     ) IS NULL
     OR to_regprocedure('public.undo_staff_order_payment_atomic(uuid)') IS NULL
     OR to_regprocedure(
       'public.set_customer_payment_evidence_atomic(uuid,uuid[],text)'
     ) IS NULL
     OR to_regprocedure(
       'public.set_staff_order_trip_assignment_atomic(uuid,uuid,boolean)'
     ) IS NULL
     OR to_regprocedure(
       'public.finalize_staff_order_delivery_from_trip(uuid,uuid,date,text,text,integer,jsonb,boolean,text,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.confirm_customer_order_delivery_atomic(uuid,uuid,date)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'MIGRATION_MISSING: apply the 2400, 2500 and 2600 migrations first';
  END IF;
END;
$migration_guard$;

CREATE TEMP TABLE workflow_context (
  actor_id uuid NOT NULL,
  branch_a text NOT NULL,
  branch_b text NOT NULL,
  product_id uuid NOT NULL,
  customer_later uuid NOT NULL,
  customer_prepay uuid NOT NULL,
  order_pay_a uuid NOT NULL,
  order_pay_b uuid NOT NULL,
  order_pay_pending uuid NOT NULL,
  order_backend_paid uuid NOT NULL,
  order_evidence uuid NOT NULL,
  order_evidence_reserved uuid NOT NULL,
  order_trip_success uuid NOT NULL,
  order_trip_failure uuid NOT NULL,
  order_confirm_later uuid NOT NULL,
  order_confirm_prepay_unpaid uuid NOT NULL,
  order_confirm_prepay_paid uuid NOT NULL,
  trip_success uuid NOT NULL,
  trip_failure uuid NOT NULL,
  delivery_date date NOT NULL
) ON COMMIT DROP;

WITH fixture_key AS (
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS suffix
), actor_auth AS (
  INSERT INTO auth.users (id)
  SELECT gen_random_uuid()
  RETURNING id
), branch_a AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, internal_demo,
    order_cutoff_hour, closed_weekdays
  )
  SELECT gen_random_uuid(), 'Atomic 2500 A ' || suffix,
         'Rollback-only A', '620000025001', 'active', false, 23,
         '{}'::integer[]
  FROM fixture_key
  RETURNING name
), branch_b AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, internal_demo,
    order_cutoff_hour, closed_weekdays
  )
  SELECT gen_random_uuid(), 'Atomic 2500 B ' || suffix,
         'Rollback-only B', '620000025002', 'active', false, 23,
         '{}'::integer[]
  FROM fixture_key
  RETURNING name
), actor AS (
  INSERT INTO public.profiles (
    id, email, name, role, branch, status, username, phone
  )
  SELECT actor_auth.id,
         'atomic-2500-' || fixture_key.suffix || '@example.invalid',
         'Atomic 2500 rollback actor', 'finance', branch_a.name, 'active',
         'atomic_2500_' || fixture_key.suffix, '620000025003'
  FROM actor_auth
  CROSS JOIN branch_a
  CROSS JOIN fixture_key
  RETURNING id
), product AS (
  INSERT INTO public.products (id, name, price, unit, is_refill, status)
  SELECT gen_random_uuid(), 'Atomic 2500 refill ' || suffix,
         100, 'gallon', true, 'active'
  FROM fixture_key
  RETURNING id
)
INSERT INTO workflow_context
SELECT
  actor.id, branch_a.name, branch_b.name, product.id,
  gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  current_date + 30
FROM actor
CROSS JOIN branch_a
CROSS JOIN branch_b
CROSS JOIN product;

INSERT INTO public.customers (
  id, name, address, whatsapp, branch, customer_type, discount,
  is_active, created_by
)
SELECT customer_later, 'Atomic 2500 later pay', 'Rollback-only address',
       '620000025101', branch_a, 'later_pay', 0, true, actor_id
FROM workflow_context
UNION ALL
SELECT customer_prepay, 'Atomic 2500 prepay', 'Rollback-only address',
       '620000025102', branch_a, 'pre_pay', 0, true, actor_id
FROM workflow_context;

INSERT INTO public.orders (
  id, customer_id, customer_name, customer_address, customer_whatsapp,
  customer_discount, branch, total_amount, status, payment_status,
  delivery_date, created_by, is_active, midtrans_order_id,
  payment_confirmation_type, prepay_checkout_key
)
SELECT order_id, customer_id, customer_name, 'Rollback-only address',
       whatsapp, 0, branch, 100, status, payment_status, delivery_date,
       actor_id, true, midtrans_order_id, confirmation_type,
       prepay_checkout_key
FROM workflow_context AS c
CROSS JOIN LATERAL (
  VALUES
    (c.order_pay_a, c.customer_later, 'Pay A', '620000025201', c.branch_a,
     'delivered', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_pay_b, c.customer_later, 'Pay B', '620000025201', c.branch_b,
     'delivered', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_pay_pending, c.customer_later, 'Pay pending', '620000025201', c.branch_a,
     'pending', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_backend_paid, c.customer_later, 'Backend paid', '620000025201', c.branch_a,
     'delivered', 'paid', 'op_atomic2500_backend', 'midtrans', NULL::uuid),
    (c.order_evidence, c.customer_later, 'Evidence', '620000025201', c.branch_a,
     'pending', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_evidence_reserved, c.customer_later, 'Reserved evidence', '620000025201', c.branch_a,
     'pending', 'unpaid', 'op_atomic2500_reserved', NULL::text, NULL::uuid),
    (c.order_trip_success, c.customer_later, 'Trip success', '620000025201', c.branch_a,
     'pending', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_trip_failure, c.customer_later, 'Trip failure', '620000025201', c.branch_a,
     'pending', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_confirm_later, c.customer_later, 'Confirm later', '620000025201', c.branch_a,
     'scheduled', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_confirm_prepay_unpaid, c.customer_prepay, 'Confirm prepay unpaid', '620000025202', c.branch_a,
     'scheduled', 'unpaid', NULL::text, NULL::text, NULL::uuid),
    (c.order_confirm_prepay_paid, c.customer_prepay, 'Confirm prepay paid', '620000025202', c.branch_a,
     'scheduled', 'paid', NULL::text, NULL::text, NULL::uuid)
) AS fixture(
  order_id, customer_id, customer_name, whatsapp, branch, status,
  payment_status, midtrans_order_id, confirmation_type,
  prepay_checkout_key
);

INSERT INTO public.order_items (
  order_id, product, product_id, is_refill, quantity, unit_price, discount
)
SELECT order_id, 'Atomic 2500 refill', product_id, true, 1, 100, 0
FROM workflow_context AS c
CROSS JOIN LATERAL (
  VALUES (c.order_trip_success), (c.order_trip_failure)
) AS fixture(order_id);

INSERT INTO public.trips (id, name, trip_date, branch, status, order_ids)
SELECT trip_success, 'Atomic 2500 trip success', delivery_date,
       branch_a, 'pending', ARRAY[]::text[]
FROM workflow_context
UNION ALL
SELECT trip_failure, 'Atomic 2500 trip failure', delivery_date,
       branch_a, 'pending', ARRAY[]::text[]
FROM workflow_context;

CREATE TEMP TABLE workflow_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

GRANT SELECT ON TABLE workflow_context TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE workflow_results TO authenticated, service_role;

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

CREATE FUNCTION pg_temp.expect_sql(
  p_check_name text,
  p_sql text,
  p_should_succeed boolean,
  p_expected_sqlstate text DEFAULT NULL,
  p_expected_message text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_state text;
  v_message text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    IF NOT p_should_succeed THEN
      RAISE EXCEPTION 'unexpected success' USING ERRCODE = 'ZX001';
    END IF;
    INSERT INTO pg_temp.workflow_results VALUES (
      p_check_name, 'PASS', 'succeeded'
    );
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
    v_message := SQLERRM;
    IF v_state = 'ZX001' OR p_should_succeed THEN
      INSERT INTO pg_temp.workflow_results VALUES (
        p_check_name, 'BLOCK', format('SQLSTATE %s: %s', v_state, v_message)
      );
    ELSIF (p_expected_sqlstate IS NULL OR v_state = p_expected_sqlstate)
      AND (p_expected_message IS NULL OR
           position(lower(p_expected_message) IN lower(v_message)) > 0) THEN
      INSERT INTO pg_temp.workflow_results VALUES (
        p_check_name, 'PASS', format('rejected with SQLSTATE %s: %s', v_state, v_message)
      );
    ELSE
      INSERT INTO pg_temp.workflow_results VALUES (
        p_check_name, 'BLOCK', format('unexpected SQLSTATE %s: %s', v_state, v_message)
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
    INSERT INTO pg_temp.workflow_results VALUES (
      p_check_name,
      CASE WHEN v_ok IS TRUE THEN 'PASS' ELSE 'BLOCK' END,
      CASE WHEN v_ok IS TRUE THEN 'postcondition satisfied'
           ELSE 'postcondition false or null' END
    );
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO pg_temp.workflow_results VALUES (
      p_check_name, 'BLOCK', format('SQLSTATE %s: %s', SQLSTATE, SQLERRM)
    );
  END;
END;
$function$;

-- Static hardening and common-lock coverage.
SELECT pg_temp.expect_true(
  'atomic_rpc_acl_is_narrow',
  $sql$
    SELECT
      has_function_privilege('authenticated',
        'public.confirm_staff_order_payment_atomic(uuid[],text,text,numeric)', 'EXECUTE')
      AND has_function_privilege('authenticated',
        'public.undo_staff_order_payment_atomic(uuid)', 'EXECUTE')
      AND has_function_privilege('authenticated',
        'public.set_staff_order_trip_assignment_atomic(uuid,uuid,boolean)', 'EXECUTE')
      AND has_function_privilege('service_role',
        'public.set_customer_payment_evidence_atomic(uuid,uuid[],text)', 'EXECUTE')
      AND has_function_privilege('service_role',
        'public.confirm_customer_order_delivery_atomic(uuid,uuid,date)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated',
        'public.confirm_customer_order_delivery_atomic(uuid,uuid,date)', 'EXECUTE')
      AND NOT has_function_privilege('anon',
        'public.confirm_staff_order_payment_atomic(uuid[],text,text,numeric)', 'EXECUTE')
  $sql$
);

SELECT pg_temp.expect_true(
  'atomic_rpc_metadata_hardened',
  $sql$
    SELECT count(*) = 6
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_roles AS r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'confirm_staff_order_payment_atomic',
        'undo_staff_order_payment_atomic',
        'set_customer_payment_evidence_atomic',
        'set_staff_order_trip_assignment_atomic',
        'finalize_staff_order_delivery_from_trip',
        'confirm_customer_order_delivery_atomic'
      )
      AND p.prosecdef IS TRUE
      AND r.rolname = 'postgres'
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]
  $sql$
);

SELECT pg_temp.expect_true(
  'shared_customer_lock_present_in_all_mutation_paths',
  $sql$
    WITH required(signature) AS (
      VALUES
        ('public.create_customer_prepay_checkout(uuid,uuid,date,text,jsonb,jsonb)'),
        ('public.store_customer_prepay_snap_session(uuid,uuid,text,text)'),
        ('public.release_customer_prepay_checkout(uuid,uuid,text)'),
        ('public.settle_customer_prepay_checkout(text,integer,text,text,text,jsonb,timestamp with time zone)'),
        ('public.create_customer_voucher_only_order(uuid,uuid,date,text,jsonb,jsonb)'),
        ('public.cancel_customer_pending_order(uuid,uuid)'),
        ('public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)'),
        ('public.correct_staff_order_atomic(uuid,uuid,date,text,integer,jsonb,text)'),
        ('public.finalize_staff_order_delivery(uuid,date,text,text,integer,jsonb,boolean,text,text)'),
        ('public.cancel_staff_order_atomic(uuid)'),
        ('public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)'),
        ('public.set_staff_order_schedule_status(uuid,text)'),
        ('public.confirm_paid_voucher_purchase(uuid,uuid,text,text,integer,text,text,text,jsonb,timestamp with time zone,jsonb)'),
        ('public.confirm_staff_order_payment_atomic(uuid[],text,text,numeric)'),
        ('public.undo_staff_order_payment_atomic(uuid)'),
        ('public.set_customer_payment_evidence_atomic(uuid,uuid[],text)'),
        ('public.set_staff_order_trip_assignment_atomic(uuid,uuid,boolean)'),
        ('public.finalize_staff_order_delivery_from_trip(uuid,uuid,date,text,text,integer,jsonb,boolean,text,text)'),
        ('public.confirm_customer_order_delivery_atomic(uuid,uuid,date)')
    )
    SELECT count(*) = 19
       AND bool_and(to_regprocedure(signature) IS NOT NULL)
       AND bool_and(position(
         'vividaqua:customer-order:' IN
         pg_get_functiondef(to_regprocedure(signature))
       ) > 0)
    FROM required
  $sql$
);

-- Staff payment: exact-set validation, branch scope and safe undo.
SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;

SELECT pg_temp.expect_sql(
  'finance_same_branch_payment_allowed',
  $sql$
    SELECT public.confirm_staff_order_payment_atomic(
      ARRAY[order_pay_a], 'audit/payment-proof.jpg', 'matched', 100
    ) FROM pg_temp.workflow_context
  $sql$, true
);
SELECT pg_temp.expect_sql(
  'staff_payment_duplicate_id_denied',
  $sql$
    SELECT public.confirm_staff_order_payment_atomic(
      ARRAY[order_pay_pending, order_pay_pending], NULL, NULL, NULL
    ) FROM pg_temp.workflow_context
  $sql$, false, '22023', 'DUPLICATE_STAFF_PAYMENT_ORDER_ID'
);
SELECT pg_temp.expect_sql(
  'staff_payment_pending_order_denied',
  $sql$
    SELECT public.confirm_staff_order_payment_atomic(
      ARRAY[order_pay_pending], NULL, NULL, NULL
    ) FROM pg_temp.workflow_context
  $sql$, false, '55000', 'STAFF_PAYMENT_ORDER_SET_OR_STATE_INVALID'
);
SELECT pg_temp.expect_sql(
  'finance_cross_branch_payment_denied',
  $sql$
    SELECT public.confirm_staff_order_payment_atomic(
      ARRAY[order_pay_b], NULL, NULL, NULL
    ) FROM pg_temp.workflow_context
  $sql$, false, '42501', 'ORDER_BRANCH_FORBIDDEN'
);
RESET ROLE;

SELECT pg_temp.expect_true(
  'staff_payment_writes_complete_audit_state',
  $sql$
    SELECT payment_status = 'paid'
       AND payment_confirmation_type = 'ocr'
       AND payment_evidence = 'audit/payment-proof.jpg'
       AND evidence_amount_verified = 'matched'
       AND evidence_detected_amount = 100
       AND payment_confirmed_by IS NOT NULL
       AND paid_date IS NOT NULL
    FROM public.orders
    WHERE id = (SELECT order_pay_a FROM pg_temp.workflow_context)
  $sql$
);

UPDATE public.profiles
SET branch = 'All'
WHERE id = (SELECT actor_id FROM workflow_context);
SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'finance_all_cross_branch_payment_allowed',
  $sql$
    SELECT public.confirm_staff_order_payment_atomic(
      ARRAY[order_pay_b], NULL, NULL, NULL
    ) FROM pg_temp.workflow_context
  $sql$, true
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

UPDATE public.profiles
SET role = 'branch_admin', branch = context.branch_a
FROM workflow_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'branch_admin_manual_payment_undo_allowed',
  $sql$
    SELECT public.undo_staff_order_payment_atomic(order_pay_a)
    FROM pg_temp.workflow_context
  $sql$, true
);
SELECT pg_temp.expect_sql(
  'backend_managed_payment_undo_denied',
  $sql$
    SELECT public.undo_staff_order_payment_atomic(order_backend_paid)
    FROM pg_temp.workflow_context
  $sql$, false, '42501', 'STAFF_PAYMENT_UNDO_FORBIDDEN'
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'manual_payment_undo_clears_audit_state',
  $sql$
    SELECT payment_status = 'unpaid'
       AND paid_date IS NULL
       AND payment_evidence IS NULL
       AND payment_confirmation_type IS NULL
       AND payment_confirmed_by IS NULL
       AND evidence_amount_verified IS NULL
       AND evidence_detected_amount IS NULL
    FROM public.orders
    WHERE id = (SELECT order_pay_a FROM pg_temp.workflow_context)
  $sql$
);

-- Customer payment evidence is service-only and refuses reserved payments.
SELECT pg_temp.set_test_claims(NULL::uuid, 'service_role');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_sql(
  'service_payment_evidence_allowed',
  $sql$
    SELECT public.set_customer_payment_evidence_atomic(
      customer_later, ARRAY[order_evidence], 'payments/customer-proof.jpg'
    ) FROM pg_temp.workflow_context
  $sql$, true
);
SELECT pg_temp.expect_sql(
  'reserved_order_payment_evidence_denied',
  $sql$
    SELECT public.set_customer_payment_evidence_atomic(
      customer_later, ARRAY[order_evidence_reserved], 'payments/forbidden.jpg'
    ) FROM pg_temp.workflow_context
  $sql$, false, '55000', 'PAYMENT_EVIDENCE_ORDER_SET_OR_STATE_INVALID'
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'payment_evidence_exact_set_postcondition',
  $sql$
    SELECT
      (SELECT payment_evidence = 'payments/customer-proof.jpg'
       FROM public.orders WHERE id = c.order_evidence)
      AND
      (SELECT payment_evidence IS NULL
       FROM public.orders WHERE id = c.order_evidence_reserved)
    FROM pg_temp.workflow_context AS c
  $sql$
);
SELECT pg_temp.clear_test_claims();

-- Trip membership and order status change together.
UPDATE public.profiles
SET role = 'operator', branch = context.branch_a
FROM workflow_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'direct_trip_membership_update_cannot_mutate',
  $sql$
    UPDATE public.trips
    SET order_ids = ARRAY[(SELECT order_trip_success::text FROM pg_temp.workflow_context)]
    WHERE id = (SELECT trip_success FROM pg_temp.workflow_context)
  $sql$, true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'direct_trip_membership_write_left_state_unchanged',
  $sql$
    SELECT o.status = 'pending'
       AND NOT (o.id::text = ANY(t.order_ids))
    FROM pg_temp.workflow_context AS c
    JOIN public.orders AS o ON o.id = c.order_trip_success
    JOIN public.trips AS t ON t.id = c.trip_success
  $sql$
);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'atomic_trip_assignment_allowed',
  $sql$
    SELECT public.set_staff_order_trip_assignment_atomic(
      order_trip_success, trip_success, true
    ) FROM pg_temp.workflow_context
  $sql$, true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'trip_assignment_and_schedule_are_consistent',
  $sql$
    SELECT o.status = 'scheduled'
       AND o.id::text = ANY(t.order_ids)
       AND t.status = 'in-progress'
    FROM pg_temp.workflow_context AS c
    JOIN public.orders AS o ON o.id = c.order_trip_success
    JOIN public.trips AS t ON t.id = c.trip_success
  $sql$
);

SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'atomic_trip_removal_allowed',
  $sql$
    SELECT public.set_staff_order_trip_assignment_atomic(
      order_trip_success, trip_success, false
    ) FROM pg_temp.workflow_context
  $sql$, true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'trip_removal_and_pending_are_consistent',
  $sql$
    SELECT o.status = 'pending'
       AND NOT (o.id::text = ANY(t.order_ids))
       AND t.status = 'completed'
    FROM pg_temp.workflow_context AS c
    JOIN public.orders AS o ON o.id = c.order_trip_success
    JOIN public.trips AS t ON t.id = c.trip_success
  $sql$
);

-- Reassign and deliver successfully from the trip.
SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT public.set_staff_order_trip_assignment_atomic(
  order_trip_success, trip_success, true
) FROM pg_temp.workflow_context;
SELECT pg_temp.expect_sql(
  'delivery_from_trip_is_atomic',
  $sql$
    SELECT public.finalize_staff_order_delivery_from_trip(
      c.order_trip_success, c.trip_success,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      'delivery-proof', 'trip delivered', 0,
      (SELECT jsonb_agg(jsonb_build_object(
         'item_id', oi.id, 'quantity', oi.quantity
       )) FROM public.order_items AS oi WHERE oi.order_id = c.order_trip_success),
      false, NULL, NULL
    )
    FROM pg_temp.workflow_context AS c
  $sql$, true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'delivery_and_trip_cleanup_are_consistent',
  $sql$
    SELECT o.status = 'delivered'
       AND o.delivery_evidence = 'delivery-proof'
       AND NOT (o.id::text = ANY(t.order_ids))
       AND t.status = 'completed'
    FROM pg_temp.workflow_context AS c
    JOIN public.orders AS o ON o.id = c.order_trip_success
    JOIN public.trips AS t ON t.id = c.trip_success
  $sql$
);

-- Failed delivery must preserve both the order and trip membership.
SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT public.set_staff_order_trip_assignment_atomic(
  order_trip_failure, trip_failure, true
) FROM pg_temp.workflow_context;
SELECT pg_temp.expect_sql(
  'failed_trip_delivery_rejects_bad_item_set',
  $sql$
    SELECT public.finalize_staff_order_delivery_from_trip(
      order_trip_failure, trip_failure,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,
      NULL, NULL, 0,
      jsonb_build_array(jsonb_build_object(
        'item_id', gen_random_uuid(), 'quantity', 1
      )),
      false, NULL, NULL
    ) FROM pg_temp.workflow_context
  $sql$, false, '22023', 'ACTUAL_ITEMS_MUST_MATCH_ORDER'
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'failed_trip_delivery_rolls_back_both_sides',
  $sql$
    SELECT o.status = 'scheduled'
       AND o.id::text = ANY(t.order_ids)
       AND t.status = 'in-progress'
    FROM pg_temp.workflow_context AS c
    JOIN public.orders AS o ON o.id = c.order_trip_failure
    JOIN public.trips AS t ON t.id = c.trip_failure
  $sql$
);

-- Customer delivery confirmation is a service-role-only exact-order workflow.
SELECT pg_temp.set_test_claims(NULL::uuid, 'service_role');
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_sql(
  'customer_later_pay_delivery_confirmation_allowed',
  $sql$
    SELECT public.confirm_customer_order_delivery_atomic(
      customer_later, order_confirm_later,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date
    ) FROM pg_temp.workflow_context
  $sql$, true
);
SELECT pg_temp.expect_sql(
  'customer_prepay_unpaid_delivery_denied',
  $sql$
    SELECT public.confirm_customer_order_delivery_atomic(
      customer_prepay, order_confirm_prepay_unpaid,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date
    ) FROM pg_temp.workflow_context
  $sql$, false, '55000', 'ORDER_NOT_CONFIRMABLE'
);
SELECT pg_temp.expect_sql(
  'customer_prepay_paid_delivery_allowed',
  $sql$
    SELECT public.confirm_customer_order_delivery_atomic(
      customer_prepay, order_confirm_prepay_paid,
      (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date
    ) FROM pg_temp.workflow_context
  $sql$, true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'customer_delivery_postconditions_exact',
  $sql$
    SELECT
      (SELECT status = 'delivered' AND delivered_date IS NOT NULL
       FROM public.orders WHERE id = c.order_confirm_later)
      AND
      (SELECT status = 'scheduled' AND delivered_date IS NULL
       FROM public.orders WHERE id = c.order_confirm_prepay_unpaid)
      AND
      (SELECT status = 'delivered' AND delivered_date IS NOT NULL
       FROM public.orders WHERE id = c.order_confirm_prepay_paid)
    FROM pg_temp.workflow_context AS c
  $sql$
);

SELECT pg_temp.set_test_claims(actor_id, 'authenticated') FROM workflow_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_sql(
  'authenticated_customer_delivery_rpc_denied',
  $sql$
    SELECT public.confirm_customer_order_delivery_atomic(
      customer_later, order_confirm_later, current_date
    ) FROM pg_temp.workflow_context
  $sql$, false, '42501', 'permission denied'
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

SELECT check_name, status, detail
FROM workflow_results
ORDER BY check_name;

DO $assert_all_passed$
DECLARE
  v_total integer;
  v_blocks integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status <> 'PASS')
    INTO v_total, v_blocks
  FROM workflow_results;
  IF v_total < 25 THEN
    RAISE EXCEPTION
      'ATOMIC_PAYMENT_TRIP_DELIVERY_REGRESSION_INCOMPLETE: only % checks ran',
      v_total;
  END IF;
  IF v_blocks <> 0 THEN
    RAISE EXCEPTION
      'ATOMIC_PAYMENT_TRIP_DELIVERY_REGRESSION_FAILED: % of % checks blocked',
      v_blocks, v_total;
  END IF;
END;
$assert_all_passed$;

ROLLBACK;
