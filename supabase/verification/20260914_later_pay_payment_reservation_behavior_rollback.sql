-- LOCAL TEST DATABASES ONLY.
-- Behaviour regression for the atomic later-pay payment reservation lifecycle.
-- Every fixture and mutation is rolled back. Run with psql -v ON_ERROR_STOP=1.

DO $database_guard$
BEGIN
  IF current_database() NOT IN ('audit_root_acl18', 'audit_cafa_customer') THEN
    RAISE EXCEPTION 'LOCAL_ONLY: run only on an approved disposable audit database';
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
      AS $body$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.role', true), ''),
          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb)->>'role'
        )
      $body$
    $ddl$;
  END IF;
END;
$local_clone_prerequisites$;

DO $migration_guard$
BEGIN
  IF to_regprocedure('public.reserve_customer_later_pay_payment(uuid,uuid,uuid[],integer,text)') IS NULL
     OR to_regprocedure('public.finalize_customer_later_pay_payment(uuid,uuid,text,integer,text,text)') IS NULL
     OR to_regprocedure('public.release_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)') IS NULL
     OR to_regprocedure('public.settle_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_MISSING: apply 20260914230000 first';
  END IF;
END;
$migration_guard$;

CREATE TEMP TABLE payment_reservation_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE payment_reservation_calls (
  call_name text PRIMARY KEY,
  result jsonb NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE payment_reservation_context AS
SELECT
  substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS suffix,
  gen_random_uuid() AS branch_id,
  'Payment 2300 ' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS branch_name,
  gen_random_uuid() AS main_customer_id,
  gen_random_uuid() AS other_customer_id,
  gen_random_uuid() AS prepay_customer_id,
  gen_random_uuid() AS order_one,
  gen_random_uuid() AS order_two,
  gen_random_uuid() AS order_release,
  gen_random_uuid() AS order_amount_mismatch,
  gen_random_uuid() AS order_other_customer,
  gen_random_uuid() AS order_prepay,
  gen_random_uuid() AS payment_key,
  gen_random_uuid() AS release_key,
  gen_random_uuid() AS alternate_key;

GRANT SELECT ON payment_reservation_context TO service_role, authenticated, anon;
GRANT SELECT, INSERT ON payment_reservation_calls TO service_role, authenticated, anon;
GRANT SELECT, INSERT ON payment_reservation_results TO service_role, authenticated, anon;

CREATE FUNCTION pg_temp.record_payment_check(
  p_check_name text,
  p_ok boolean,
  p_detail text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  INSERT INTO pg_temp.payment_reservation_results(check_name, status, detail)
  VALUES (
    p_check_name,
    CASE WHEN COALESCE(p_ok, false) THEN 'PASS' ELSE 'BLOCK' END,
    COALESCE(p_detail, '')
  );
END;
$function$;

CREATE FUNCTION pg_temp.expect_payment_error(
  p_check_name text,
  p_sql text,
  p_expected_state text,
  p_expected_message text
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
    PERFORM pg_temp.record_payment_check(p_check_name, false, 'unexpected success');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                            v_message = MESSAGE_TEXT;
    PERFORM pg_temp.record_payment_check(
      p_check_name,
      (p_expected_state IS NULL OR v_state = p_expected_state)
        AND (p_expected_message IS NULL
          OR position(lower(p_expected_message) IN lower(v_message)) > 0),
      format('SQLSTATE %s: %s', v_state, v_message)
    );
  END;
END;
$function$;

INSERT INTO public.branches (
  id, name, address, phone, status, internal_demo,
  order_cutoff_hour, closed_weekdays
)
SELECT branch_id, branch_name, 'Rollback fixture',
       'audit2300-' || suffix, 'active', false, 23, '{}'::integer[]
FROM payment_reservation_context;

INSERT INTO public.customers (
  id, name, address, whatsapp, discount, branch,
  payment_term, customer_type, is_active
)
SELECT fixture.customer_id, fixture.customer_name, 'Rollback fixture',
       fixture.whatsapp_prefix || context.suffix, 0, context.branch_name,
       'daily', fixture.customer_type, true
FROM payment_reservation_context AS context
CROSS JOIN LATERAL (VALUES
  (context.main_customer_id, 'Payment main', 'audit2300-main-', 'later_pay'),
  (context.other_customer_id, 'Payment other', 'audit2300-other-', 'later_pay'),
  (context.prepay_customer_id, 'Payment prepay', 'audit2300-pre-', 'pre_pay')
) AS fixture(customer_id, customer_name, whatsapp_prefix, customer_type);

INSERT INTO public.orders (
  id, customer_id, customer_name, customer_address, customer_whatsapp,
  customer_discount, branch, total_amount, status, payment_status,
  delivery_date, created_by_display, is_active
)
SELECT fixture.order_id, fixture.customer_id, fixture.customer_name,
       'Rollback fixture', fixture.whatsapp, 0, context.branch_name,
       fixture.amount_idr, fixture.order_status, 'unpaid',
       current_date + 1, 'Payment 2300 audit', true
FROM payment_reservation_context AS context
CROSS JOIN LATERAL (VALUES
  (context.order_one, context.main_customer_id, 'Payment one', 'audit2300-main', 100, 'pending'),
  (context.order_two, context.main_customer_id, 'Payment two', 'audit2300-main', 200, 'scheduled'),
  (context.order_release, context.main_customer_id, 'Payment release', 'audit2300-main', 300, 'pending'),
  (context.order_amount_mismatch, context.main_customer_id, 'Payment mismatch', 'audit2300-main', 400, 'pending'),
  (context.order_other_customer, context.other_customer_id, 'Payment other', 'audit2300-other', 500, 'pending'),
  (context.order_prepay, context.prepay_customer_id, 'Payment prepay', 'audit2300-pre', 600, 'pending')
) AS fixture(order_id, customer_id, customer_name, whatsapp, amount_idr, order_status);

-- Metadata and ACL are part of the contract.
SELECT pg_temp.record_payment_check(
  'reservation_rpc_metadata_hardened',
  bool_and(p.prosecdef)
    AND bool_and(pg_get_userbyid(p.proowner) = 'postgres')
    AND bool_and(p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[]),
  'all four lifecycle RPCs are postgres-owned SECURITY DEFINER functions'
)
FROM pg_proc AS p
WHERE p.oid IN (
  'public.reserve_customer_later_pay_payment(uuid,uuid,uuid[],integer,text)'::regprocedure,
  'public.finalize_customer_later_pay_payment(uuid,uuid,text,integer,text,text)'::regprocedure,
  'public.release_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure,
  'public.settle_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure
);

SELECT pg_temp.record_payment_check(
  'reservation_rpc_acl_service_role_only',
  bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND bool_and(NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    AND bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND bool_and(NOT has_function_privilege('public', p.oid, 'EXECUTE')),
  'only service_role can execute the lifecycle RPCs'
)
FROM pg_proc AS p
WHERE p.oid IN (
  'public.reserve_customer_later_pay_payment(uuid,uuid,uuid[],integer,text)'::regprocedure,
  'public.finalize_customer_later_pay_payment(uuid,uuid,text,integer,text,text)'::regprocedure,
  'public.release_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure,
  'public.settle_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)'::regprocedure
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_payment_error(
  'authenticated_reserve_execute_denied',
  format(
    'SELECT public.reserve_customer_later_pay_payment(%L::uuid,%L::uuid,ARRAY[%L::uuid],100,%L)',
    main_customer_id, payment_key, order_one, 'other_qris'
  ),
  '42501', 'permission denied'
)
FROM payment_reservation_context;
RESET ROLE;

SELECT set_config('request.jwt.claim.role', 'service_role', true);
SET LOCAL ROLE service_role;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'reserve_created', public.reserve_customer_later_pay_payment(
  main_customer_id, payment_key, ARRAY[order_two, order_one], 300, 'other_qris'
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'reserve_creates_canonical_immutable_snapshot',
  (calls.result->>'reserved')::boolean
    AND (calls.result->>'created')::boolean
    AND (calls.result->>'should_create')::boolean
    AND calls.result->>'midtrans_order_id'
      = 'op_' || replace(context.payment_key::text, '-', '')
    AND (calls.result->>'gross_amount')::integer = 300
    AND jsonb_array_length(calls.result->'order_ids') = 2,
  calls.result::text
)
FROM payment_reservation_calls AS calls
CROSS JOIN payment_reservation_context AS context
WHERE calls.call_name = 'reserve_created';

SELECT pg_temp.record_payment_check(
  'reserve_tags_exact_order_set',
  count(*) = 2
    AND count(DISTINCT o.midtrans_order_id) = 1
    AND min(o.midtrans_order_id) = 'op_' || replace(context.payment_key::text, '-', ''),
  format('tagged=%s', count(*))
)
FROM payment_reservation_context AS context
JOIN public.orders AS o ON o.id IN (context.order_one, context.order_two)
GROUP BY context.payment_key;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'reserve_replay', public.reserve_customer_later_pay_payment(
  main_customer_id, payment_key, ARRAY[order_one, order_two], 300, 'other_qris'
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'reserve_same_key_same_set_is_idempotent',
  NOT (result->>'created')::boolean
    AND NOT (result->>'should_create')::boolean
    AND result->>'payment_disposition' = 'retry_same_key',
  result::text
)
FROM payment_reservation_calls
WHERE call_name = 'reserve_replay';

SELECT pg_temp.expect_payment_error(
  'reserve_key_reuse_with_different_set_denied',
  format(
    'SELECT public.reserve_customer_later_pay_payment(%L::uuid,%L::uuid,ARRAY[%L::uuid],100,%L)',
    main_customer_id, payment_key, order_one, 'other_qris'
  ),
  '22023', 'LATER_PAY_PAYMENT_KEY_REUSE_MISMATCH'
)
FROM payment_reservation_context;

SELECT pg_temp.expect_payment_error(
  'second_open_attempt_for_reserved_order_denied',
  format(
    'SELECT public.reserve_customer_later_pay_payment(%L::uuid,%L::uuid,ARRAY[%L::uuid],100,%L)',
    main_customer_id, alternate_key, order_one, 'other_qris'
  ),
  '55000', 'LATER_PAY_PAYMENT_ORDER_SET_OR_STATE_INVALID'
)
FROM payment_reservation_context;

SELECT pg_temp.expect_payment_error(
  'reservation_amount_mismatch_denied',
  format(
    'SELECT public.reserve_customer_later_pay_payment(%L::uuid,%L::uuid,ARRAY[%L::uuid],401,%L)',
    main_customer_id, gen_random_uuid(), order_amount_mismatch, 'other_qris'
  ),
  '22023', 'LATER_PAY_PAYMENT_AMOUNT_MISMATCH'
)
FROM payment_reservation_context;

SELECT pg_temp.expect_payment_error(
  'prepay_customer_reservation_denied',
  format(
    'SELECT public.reserve_customer_later_pay_payment(%L::uuid,%L::uuid,ARRAY[%L::uuid],600,%L)',
    prepay_customer_id, gen_random_uuid(), order_prepay, 'other_qris'
  ),
  NULL, 'CUSTOMER_NOT_ELIGIBLE_FOR_LATER_PAY_PAYMENT'
)
FROM payment_reservation_context;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'finalize_created', public.finalize_customer_later_pay_payment(
  main_customer_id,
  payment_key,
  'op_' || replace(payment_key::text, '-', ''),
  300,
  'snap-audit-token',
  'https://example.invalid/snap-audit'
)
FROM payment_reservation_context;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'finalize_replay', public.finalize_customer_later_pay_payment(
  main_customer_id,
  payment_key,
  'op_' || replace(payment_key::text, '-', ''),
  300,
  'snap-audit-token',
  'https://example.invalid/snap-audit'
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'snap_finalize_and_replay_are_idempotent',
  first.result->>'state' = 'ready'
    AND NOT (first.result->>'already_finalized')::boolean
    AND (replay.result->>'already_finalized')::boolean
    AND replay.result->>'snap_token' = 'snap-audit-token',
  replay.result::text
)
FROM payment_reservation_calls AS first
JOIN payment_reservation_calls AS replay ON replay.call_name = 'finalize_replay'
WHERE first.call_name = 'finalize_created';

SELECT pg_temp.expect_payment_error(
  'snap_token_conflict_denied',
  format(
    'SELECT public.finalize_customer_later_pay_payment(%L::uuid,%L::uuid,%L,300,%L,NULL)',
    main_customer_id, payment_key,
    'op_' || replace(payment_key::text, '-', ''),
    'different-snap-token'
  ),
  NULL, 'LATER_PAY_PAYMENT_SNAP_SESSION_CONFLICT'
)
FROM payment_reservation_context;

SELECT pg_temp.expect_payment_error(
  'unverified_settlement_status_denied',
  format(
    'SELECT public.settle_customer_later_pay_payment(%L::uuid,%L::uuid,%L,300,%L,%L,NULL,%L,%L::jsonb,now())',
    main_customer_id, payment_key,
    'op_' || replace(payment_key::text, '-', ''),
    'tx-audit-main', 'pending', 'qris', '{"transaction_status":"pending"}'
  ),
  NULL, 'LATER_PAY_PAYMENT_NOT_VERIFIED_SETTLED'
)
FROM payment_reservation_context;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'settle_created', public.settle_customer_later_pay_payment(
  main_customer_id,
  payment_key,
  'op_' || replace(payment_key::text, '-', ''),
  300,
  'tx-audit-main',
  'settlement',
  NULL,
  'qris',
  jsonb_build_object('order_id', 'op_' || replace(payment_key::text, '-', ''),
                     'gross_amount', '300.00',
                     'transaction_status', 'settlement'),
  now()
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'settlement_updates_exact_orders_and_hq_once',
  (calls.result->>'settled')::boolean
    AND NOT (calls.result->>'already_settled')::boolean
    AND (SELECT count(*) FROM public.orders AS o
         WHERE o.id IN (context.order_one, context.order_two)
           AND o.payment_status = 'paid'
           AND o.payment_confirmation_type = 'qris') = 2
    AND (SELECT count(*) FROM public.hq_midtrans_settlements AS h
         WHERE h.midtrans_order_id = 'op_' || replace(context.payment_key::text, '-', '')) = 1
    AND (SELECT count(*) FROM public.later_pay_payment_reservation_orders AS m
         WHERE m.payment_key = context.payment_key AND m.is_open) = 0,
  calls.result::text
)
FROM payment_reservation_calls AS calls
CROSS JOIN payment_reservation_context AS context
WHERE calls.call_name = 'settle_created';

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'settle_replay', public.settle_customer_later_pay_payment(
  main_customer_id,
  payment_key,
  'op_' || replace(payment_key::text, '-', ''),
  300,
  'tx-audit-main',
  'settlement',
  NULL,
  'qris',
  jsonb_build_object('transaction_status', 'settlement', 'gross_amount', '300.00'),
  now()
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'settlement_replay_is_idempotent',
  (calls.result->>'already_settled')::boolean
    AND (SELECT count(*) FROM public.hq_midtrans_settlements AS h
         WHERE h.midtrans_order_id = 'op_' || replace(context.payment_key::text, '-', '')) = 1,
  calls.result::text
)
FROM payment_reservation_calls AS calls
CROSS JOIN payment_reservation_context AS context
WHERE calls.call_name = 'settle_replay';

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'reserve_after_settle', public.reserve_customer_later_pay_payment(
  main_customer_id, payment_key, ARRAY[order_one, order_two], 300, 'other_qris'
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'settled_reservation_replay_returns_paid',
  (result->>'paid')::boolean
    AND result->>'state' = 'settled'
    AND result->>'payment_disposition' = 'discard_key',
  result::text
)
FROM payment_reservation_calls
WHERE call_name = 'reserve_after_settle';

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'release_reserve', public.reserve_customer_later_pay_payment(
  main_customer_id, release_key, ARRAY[order_release], 300, 'other_qris'
)
FROM payment_reservation_context;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'release_created', public.release_customer_later_pay_payment(
  main_customer_id,
  release_key,
  'op_' || replace(release_key::text, '-', ''),
  300,
  'payment_expired',
  'tx-audit-expired',
  'expire',
  'qris',
  jsonb_build_object('transaction_status', 'expire', 'gross_amount', '300.00'),
  now()
)
FROM payment_reservation_context;

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'release_replay', public.release_customer_later_pay_payment(
  main_customer_id,
  release_key,
  'op_' || replace(release_key::text, '-', ''),
  300,
  'payment_expired',
  'tx-audit-expired',
  'expire',
  'qris',
  jsonb_build_object('transaction_status', 'expire', 'gross_amount', '300.00'),
  now()
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'release_clears_order_tag_and_is_idempotent',
  (created.result->>'released')::boolean
    AND NOT (created.result->>'already_released')::boolean
    AND (replay.result->>'already_released')::boolean
    AND (SELECT o.midtrans_order_id IS NULL AND o.payment_status = 'unpaid'
         FROM public.orders AS o WHERE o.id = context.order_release)
    AND (SELECT NOT m.is_open FROM public.later_pay_payment_reservation_orders AS m
         WHERE m.payment_key = context.release_key),
  replay.result::text
)
FROM payment_reservation_calls AS created
JOIN payment_reservation_calls AS replay ON replay.call_name = 'release_replay'
CROSS JOIN payment_reservation_context AS context
WHERE created.call_name = 'release_created';

INSERT INTO payment_reservation_calls(call_name, result)
SELECT 'late_settlement', public.settle_customer_later_pay_payment(
  main_customer_id,
  release_key,
  'op_' || replace(release_key::text, '-', ''),
  300,
  'tx-audit-late',
  'settlement',
  NULL,
  'qris',
  jsonb_build_object('transaction_status', 'settlement', 'gross_amount', '300.00'),
  now()
)
FROM payment_reservation_context;

SELECT pg_temp.record_payment_check(
  'late_settlement_after_release_requires_reconciliation',
  NOT (calls.result->>'settled')::boolean
    AND (calls.result->>'late_payment')::boolean
    AND (calls.result->>'requires_reconciliation')::boolean
    AND (SELECT o.payment_status = 'unpaid' AND o.midtrans_order_id IS NULL
         FROM public.orders AS o WHERE o.id = context.order_release)
    AND (SELECT r.late_payment_detected_at IS NOT NULL
         FROM public.later_pay_payment_reservations AS r
         WHERE r.payment_key = context.release_key),
  calls.result::text
)
FROM payment_reservation_calls AS calls
CROSS JOIN payment_reservation_context AS context
WHERE calls.call_name = 'late_settlement';

SELECT pg_temp.record_payment_check(
  'released_order_can_be_cancelled_normally',
  (public.cancel_customer_pending_order(main_customer_id, order_release)->>'cancelled')::boolean,
  'released reservation no longer blocks ordinary pending-order cancellation'
)
FROM payment_reservation_context;

RESET ROLE;

SELECT *
FROM payment_reservation_results
ORDER BY check_name;

DO $assert_all_passed$
DECLARE
  v_blocked integer;
  v_total integer;
BEGIN
  SELECT count(*) FILTER (WHERE status <> 'PASS'), count(*)
    INTO v_blocked, v_total
  FROM payment_reservation_results;

  IF v_total < 18 OR v_blocked > 0 THEN
    RAISE EXCEPTION 'PAYMENT_RESERVATION_REGRESSION_FAILED: % blocked of % checks',
      v_blocked, v_total;
  END IF;
END;
$assert_all_passed$;

ROLLBACK;
