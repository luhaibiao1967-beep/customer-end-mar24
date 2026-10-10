-- DISPOSABLE LOCAL DATABASE ONLY.
-- Actual two-connection contention tests for the shared customer transaction
-- lock. Run this only in a throw-away database cloned from a local audit DB;
-- the runner must drop that database after this script finishes.

DO $database_guard$
BEGIN
  IF current_database() NOT LIKE 'audit_lock_%' THEN
    RAISE EXCEPTION
      'LOCAL_ONLY: current database must be a disposable audit_lock_%% clone';
  END IF;
END;
$database_guard$;

CREATE EXTENSION IF NOT EXISTS dblink;

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
     OR to_regprocedure(
       'public.reserve_customer_later_pay_payment(uuid,uuid,uuid[],integer,text)'
     ) IS NULL
     OR to_regprocedure(
       'public.set_customer_payment_evidence_atomic(uuid,uuid[],text)'
     ) IS NULL THEN
    RAISE EXCEPTION
      'MIGRATION_MISSING: apply migrations through 20260914260000 first';
  END IF;
END;
$migration_guard$;

CREATE TABLE public.__audit_customer_lock_context (
  actor_id uuid PRIMARY KEY,
  branch_name text NOT NULL,
  pay_customer_a uuid NOT NULL,
  pay_customer_b uuid NOT NULL,
  pay_order_a uuid NOT NULL,
  pay_order_b uuid NOT NULL,
  reserve_customer uuid NOT NULL,
  reserve_order uuid NOT NULL,
  reserve_key uuid NOT NULL
);

WITH fixture_key AS (
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS suffix
), actor_auth AS (
  INSERT INTO auth.users (id)
  SELECT gen_random_uuid()
  RETURNING id
), branch AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, internal_demo,
    order_cutoff_hour, closed_weekdays
  )
  SELECT gen_random_uuid(), 'Lock concurrency ' || suffix,
         'Disposable local fixture', '620000027001', 'active', false, 23,
         '{}'::integer[]
  FROM fixture_key
  RETURNING name
), actor AS (
  INSERT INTO public.profiles (
    id, email, name, role, branch, status, username, phone
  )
  SELECT actor_auth.id,
         'lock-' || fixture_key.suffix || '@example.invalid',
         'Lock concurrency actor', 'finance', 'All', 'active',
         'lock_' || fixture_key.suffix, '620000027002'
  FROM actor_auth
  CROSS JOIN fixture_key
  RETURNING id
)
INSERT INTO public.__audit_customer_lock_context
SELECT actor.id, branch.name,
       gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
FROM actor
CROSS JOIN branch;

INSERT INTO public.customers (
  id, name, address, whatsapp, branch, customer_type, discount,
  is_active, created_by
)
SELECT customer_id, customer_name, 'Disposable local fixture', whatsapp,
       context.branch_name, 'later_pay', 0, true, context.actor_id
FROM public.__audit_customer_lock_context AS context
CROSS JOIN LATERAL (VALUES
  (context.pay_customer_a, 'Lock pay A', '620000027101'),
  (context.pay_customer_b, 'Lock pay B', '620000027102'),
  (context.reserve_customer, 'Lock reserve', '620000027103')
) AS fixture(customer_id, customer_name, whatsapp);

INSERT INTO public.orders (
  id, customer_id, customer_name, customer_address, customer_whatsapp,
  customer_discount, branch, total_amount, status, payment_status,
  delivery_date, created_by, is_active
)
SELECT order_id, customer_id, customer_name, 'Disposable local fixture',
       whatsapp, 0, context.branch_name, 100, order_status, 'unpaid',
       current_date + 1, context.actor_id, true
FROM public.__audit_customer_lock_context AS context
CROSS JOIN LATERAL (VALUES
  (context.pay_order_a, context.pay_customer_a, 'Lock order A',
   '620000027101', 'delivered'),
  (context.pay_order_b, context.pay_customer_b, 'Lock order B',
   '620000027102', 'delivered'),
  (context.reserve_order, context.reserve_customer, 'Lock reserve order',
   '620000027103', 'pending')
) AS fixture(order_id, customer_id, customer_name, whatsapp, order_status);

CREATE OR REPLACE FUNCTION public.__audit_run_staff_payment(
  p_order_ids uuid[],
  p_actor_id uuid,
  p_hold_seconds numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', p_actor_id)::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', p_actor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.confirm_staff_order_payment_atomic(
    p_order_ids, NULL, NULL, NULL
  );
  PERFORM pg_sleep(p_hold_seconds::double precision);

  RETURN jsonb_build_object(
    'ok', true,
    'elapsed_ms', round(
      extract(epoch FROM (clock_timestamp() - v_started)) * 1000
    ),
    'result', v_result
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'sqlstate', SQLSTATE,
    'message', SQLERRM,
    'elapsed_ms', round(
      extract(epoch FROM (clock_timestamp() - v_started)) * 1000
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.__audit_run_reservation(
  p_customer_id uuid,
  p_order_id uuid,
  p_payment_key uuid,
  p_hold_seconds numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.reserve_customer_later_pay_payment(
    p_customer_id, p_payment_key, ARRAY[p_order_id], 100, 'other_qris'
  );
  PERFORM pg_sleep(p_hold_seconds::double precision);
  RETURN jsonb_build_object(
    'ok', true,
    'elapsed_ms', round(
      extract(epoch FROM (clock_timestamp() - v_started)) * 1000
    ),
    'result', v_result
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'sqlstate', SQLSTATE,
    'message', SQLERRM,
    'elapsed_ms', round(
      extract(epoch FROM (clock_timestamp() - v_started)) * 1000
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.__audit_run_evidence(
  p_customer_id uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_result := public.set_customer_payment_evidence_atomic(
    p_customer_id, ARRAY[p_order_id], 'audit/concurrent-evidence.jpg'
  );
  RETURN jsonb_build_object(
    'ok', true,
    'elapsed_ms', round(
      extract(epoch FROM (clock_timestamp() - v_started)) * 1000
    ),
    'result', v_result
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'sqlstate', SQLSTATE,
    'message', SQLERRM,
    'elapsed_ms', round(
      extract(epoch FROM (clock_timestamp() - v_started)) * 1000
    )
  );
END;
$function$;

CREATE TEMP TABLE concurrency_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail jsonb NOT NULL
);

-- Scenario 1: two calls name the same two customers in opposite order. The
-- first transaction holds both locks; the second must wait and then fail on
-- the new paid state, never deadlock.
SELECT dblink_connect(
  'audit_pay_a',
  format(
    'host=127.0.0.1 port=55440 dbname=%s user=postgres application_name=audit_pay_a',
    current_database()
  )
);
SELECT dblink_connect(
  'audit_pay_b',
  format(
    'host=127.0.0.1 port=55440 dbname=%s user=postgres application_name=audit_pay_b',
    current_database()
  )
);

SELECT dblink_send_query(
  'audit_pay_a',
  format(
    'SELECT public.__audit_run_staff_payment(ARRAY[%L::uuid,%L::uuid],%L::uuid,2.5)',
    pay_order_a, pay_order_b, actor_id
  )
)
FROM public.__audit_customer_lock_context;

DO $wait_until_first_payment_holds_locks$
DECLARE
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..100 LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE application_name = 'audit_pay_a'
        AND state = 'active'
        AND wait_event = 'PgSleep'
    );
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE application_name = 'audit_pay_a'
      AND state = 'active'
      AND wait_event = 'PgSleep'
  ) THEN
    RAISE EXCEPTION 'FIRST_PAYMENT_DID_NOT_REACH_LOCK_HOLD_STATE';
  END IF;
END;
$wait_until_first_payment_holds_locks$;

SELECT dblink_send_query(
  'audit_pay_b',
  format(
    'SELECT public.__audit_run_staff_payment(ARRAY[%L::uuid,%L::uuid],%L::uuid,0)',
    pay_order_b, pay_order_a, actor_id
  )
)
FROM public.__audit_customer_lock_context;

CREATE TEMP TABLE payment_connection_results (
  connection_name text PRIMARY KEY,
  payload jsonb NOT NULL
);
INSERT INTO payment_connection_results
SELECT 'audit_pay_a', payload
FROM dblink_get_result('audit_pay_a') AS result(payload jsonb);
INSERT INTO payment_connection_results
SELECT 'audit_pay_b', payload
FROM dblink_get_result('audit_pay_b') AS result(payload jsonb);

INSERT INTO concurrency_results
SELECT
  'opposite_order_staff_payment_no_deadlock',
  CASE WHEN
    (SELECT (payload->>'ok')::boolean FROM payment_connection_results
     WHERE connection_name = 'audit_pay_a') IS TRUE
    AND
    (SELECT (payload->>'ok')::boolean FROM payment_connection_results
     WHERE connection_name = 'audit_pay_b') IS FALSE
    AND
    (SELECT payload->>'sqlstate' FROM payment_connection_results
     WHERE connection_name = 'audit_pay_b') <> '40P01'
    AND
    (SELECT payload->>'message' FROM payment_connection_results
     WHERE connection_name = 'audit_pay_b') LIKE
       '%STAFF_PAYMENT_ORDER_SET_OR_STATE_INVALID%'
    AND
    (SELECT (payload->>'elapsed_ms')::numeric FROM payment_connection_results
     WHERE connection_name = 'audit_pay_b') >= 1000
  THEN 'PASS' ELSE 'BLOCK' END,
  jsonb_build_object(
    'first', (SELECT payload FROM payment_connection_results
              WHERE connection_name = 'audit_pay_a'),
    'second', (SELECT payload FROM payment_connection_results
               WHERE connection_name = 'audit_pay_b')
  );

INSERT INTO concurrency_results
SELECT
  'opposite_order_staff_payment_commits_once',
  CASE WHEN count(*) = 2
             AND count(*) FILTER (WHERE payment_status = 'paid') = 2
       THEN 'PASS' ELSE 'BLOCK' END,
  jsonb_build_object(
    'order_count', count(*),
    'paid_count', count(*) FILTER (WHERE payment_status = 'paid')
  )
FROM public.orders
WHERE id IN (
  SELECT pay_order_a FROM public.__audit_customer_lock_context
  UNION ALL
  SELECT pay_order_b FROM public.__audit_customer_lock_context
);

SELECT dblink_disconnect('audit_pay_a');
SELECT dblink_disconnect('audit_pay_b');

-- Scenario 2: reservation owns the customer lock and freezes the order. A
-- simultaneous evidence edit waits, then rejects the now-reserved state.
SELECT dblink_connect(
  'audit_reserve',
  format(
    'host=127.0.0.1 port=55440 dbname=%s user=postgres application_name=audit_reserve',
    current_database()
  )
);
SELECT dblink_connect(
  'audit_evidence',
  format(
    'host=127.0.0.1 port=55440 dbname=%s user=postgres application_name=audit_evidence',
    current_database()
  )
);

SELECT dblink_send_query(
  'audit_reserve',
  format(
    'SELECT public.__audit_run_reservation(%L::uuid,%L::uuid,%L::uuid,2.5)',
    reserve_customer, reserve_order, reserve_key
  )
)
FROM public.__audit_customer_lock_context;

DO $wait_until_reservation_holds_lock$
DECLARE
  v_attempt integer;
BEGIN
  FOR v_attempt IN 1..100 LOOP
    EXIT WHEN EXISTS (
      SELECT 1
      FROM pg_stat_activity
      WHERE application_name = 'audit_reserve'
        AND state = 'active'
        AND wait_event = 'PgSleep'
    );
    PERFORM pg_sleep(0.05);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_stat_activity
    WHERE application_name = 'audit_reserve'
      AND state = 'active'
      AND wait_event = 'PgSleep'
  ) THEN
    RAISE EXCEPTION 'RESERVATION_DID_NOT_REACH_LOCK_HOLD_STATE';
  END IF;
END;
$wait_until_reservation_holds_lock$;

SELECT dblink_send_query(
  'audit_evidence',
  format(
    'SELECT public.__audit_run_evidence(%L::uuid,%L::uuid)',
    reserve_customer, reserve_order
  )
)
FROM public.__audit_customer_lock_context;

CREATE TEMP TABLE reservation_connection_results (
  connection_name text PRIMARY KEY,
  payload jsonb NOT NULL
);
INSERT INTO reservation_connection_results
SELECT 'audit_reserve', payload
FROM dblink_get_result('audit_reserve') AS result(payload jsonb);
INSERT INTO reservation_connection_results
SELECT 'audit_evidence', payload
FROM dblink_get_result('audit_evidence') AS result(payload jsonb);

INSERT INTO concurrency_results
SELECT
  'reservation_blocks_then_rejects_concurrent_edit',
  CASE WHEN
    (SELECT (payload->>'ok')::boolean FROM reservation_connection_results
     WHERE connection_name = 'audit_reserve') IS TRUE
    AND
    (SELECT (payload->>'ok')::boolean FROM reservation_connection_results
     WHERE connection_name = 'audit_evidence') IS FALSE
    AND
    (SELECT payload->>'sqlstate' FROM reservation_connection_results
     WHERE connection_name = 'audit_evidence') <> '40P01'
    AND
    (SELECT payload->>'message' FROM reservation_connection_results
     WHERE connection_name = 'audit_evidence') LIKE
       '%PAYMENT_EVIDENCE_ORDER_SET_OR_STATE_INVALID%'
    AND
    (SELECT (payload->>'elapsed_ms')::numeric FROM reservation_connection_results
     WHERE connection_name = 'audit_evidence') >= 1000
  THEN 'PASS' ELSE 'BLOCK' END,
  jsonb_build_object(
    'reservation', (SELECT payload FROM reservation_connection_results
                    WHERE connection_name = 'audit_reserve'),
    'evidence', (SELECT payload FROM reservation_connection_results
                 WHERE connection_name = 'audit_evidence')
  );

INSERT INTO concurrency_results
SELECT
  'reservation_freezes_exact_order',
  CASE WHEN r.state = 'reserved'
             AND o.midtrans_order_id = r.midtrans_order_id
             AND o.payment_evidence IS NULL
       THEN 'PASS' ELSE 'BLOCK' END,
  jsonb_build_object(
    'reservation_state', r.state,
    'midtrans_order_id', o.midtrans_order_id,
    'payment_evidence', o.payment_evidence
  )
FROM public.__audit_customer_lock_context AS context
JOIN public.later_pay_payment_reservations AS r
  ON r.payment_key = context.reserve_key
JOIN public.orders AS o ON o.id = context.reserve_order;

SELECT dblink_disconnect('audit_reserve');
SELECT dblink_disconnect('audit_evidence');

TABLE concurrency_results;

DO $assert_all_passed$
DECLARE
  v_total integer;
  v_blocks integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status <> 'PASS')
    INTO v_total, v_blocks
  FROM concurrency_results;
  IF v_total <> 4 OR v_blocks <> 0 THEN
    RAISE EXCEPTION
      'CUSTOMER_LOCK_CONCURRENCY_FAILED: % blocked of % checks',
      v_blocks, v_total;
  END IF;
END;
$assert_all_passed$;
