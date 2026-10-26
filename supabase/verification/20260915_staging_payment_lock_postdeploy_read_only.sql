-- STAGING ONLY: read-only post-deploy verification for migrations
-- 20260914230000 through 20260914260000.
-- Expected result: every row is PASS and offender_count is 0.
-- This script performs no DDL or DML.

BEGIN;
SET TRANSACTION READ ONLY;

WITH
expected_functions(signature, allow_authenticated, allow_service_role) AS (
  VALUES
    ('public.reserve_customer_later_pay_payment(uuid,uuid,uuid[],integer,text)', false, true),
    ('public.finalize_customer_later_pay_payment(uuid,uuid,text,integer,text,text)', false, true),
    ('public.release_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)', false, true),
    ('public.settle_customer_later_pay_payment(uuid,uuid,text,integer,text,text,text,text,jsonb,timestamp with time zone)', false, true),
    ('public.set_staff_order_schedule_status(uuid,text)', true, true),
    ('public.confirm_staff_order_payment_atomic(uuid[],text,text,numeric)', true, false),
    ('public.undo_staff_order_payment_atomic(uuid)', true, false),
    ('public.set_customer_payment_evidence_atomic(uuid,uuid[],text)', false, true),
    ('public.set_staff_order_trip_assignment_atomic(uuid,uuid,boolean)', true, false),
    ('public.finalize_staff_order_delivery_from_trip(uuid,uuid,date,text,text,integer,jsonb,boolean,text,text)', true, false),
    ('public.confirm_customer_order_delivery_atomic(uuid,uuid,date)', false, true)
),
function_state AS (
  SELECT
    expected.*,
    function.oid,
    owner.rolname AS owner_name,
    function.prosecdef,
    function.proconfig,
    CASE WHEN function.oid IS NULL THEN NULL
      ELSE pg_catalog.pg_get_functiondef(function.oid)
    END AS definition
  FROM expected_functions AS expected
  LEFT JOIN pg_catalog.pg_proc AS function
    ON function.oid = pg_catalog.to_regprocedure(expected.signature)
  LEFT JOIN pg_catalog.pg_roles AS owner
    ON owner.oid = function.proowner
),
function_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM function_state
  WHERE oid IS NULL
     OR owner_name <> 'postgres'
     OR prosecdef IS NOT TRUE
     OR NOT COALESCE(
       proconfig @> ARRAY['search_path=pg_catalog, public']::text[],
       false
     )
     OR COALESCE(pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'), false)
     OR COALESCE(
       pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'),
       false
     ) IS DISTINCT FROM allow_authenticated
     OR COALESCE(
       pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE'),
       false
     ) IS DISTINCT FROM allow_service_role
),
customer_lock_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM function_state
  WHERE oid IS NULL
     OR pg_catalog.strpos(
       COALESCE(definition, ''),
       'vividaqua:customer-order:'
     ) = 0
),
expected_tables(table_name) AS (
  VALUES
    ('later_pay_payment_reservations'),
    ('later_pay_payment_reservation_orders')
),
table_state AS (
  SELECT expected.table_name, relation.oid, relation.relrowsecurity
  FROM expected_tables AS expected
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = 'public'::regnamespace
   AND relation.relname = expected.table_name
   AND relation.relkind IN ('r', 'p')
),
table_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM table_state
  WHERE oid IS NULL
     OR relrowsecurity IS NOT TRUE
     OR COALESCE(pg_catalog.has_table_privilege('anon', oid, 'SELECT'), false)
     OR COALESCE(pg_catalog.has_table_privilege('anon', oid, 'INSERT'), false)
     OR COALESCE(pg_catalog.has_table_privilege('anon', oid, 'UPDATE'), false)
     OR COALESCE(pg_catalog.has_table_privilege('anon', oid, 'DELETE'), false)
     OR COALESCE(pg_catalog.has_table_privilege('authenticated', oid, 'SELECT'), false)
     OR COALESCE(pg_catalog.has_table_privilege('authenticated', oid, 'INSERT'), false)
     OR COALESCE(pg_catalog.has_table_privilege('authenticated', oid, 'UPDATE'), false)
     OR COALESCE(pg_catalog.has_table_privilege('authenticated', oid, 'DELETE'), false)
     OR NOT COALESCE(pg_catalog.has_table_privilege('service_role', oid, 'SELECT'), false)
     OR COALESCE(pg_catalog.has_table_privilege('service_role', oid, 'INSERT'), false)
     OR COALESCE(pg_catalog.has_table_privilege('service_role', oid, 'UPDATE'), false)
     OR COALESCE(pg_catalog.has_table_privilege('service_role', oid, 'DELETE'), false)
),
reservation_integrity_offenders AS (
  SELECT count(*)::bigint AS rows
  FROM public.later_pay_payment_reservations AS reservation
  WHERE reservation.gross_amount IS DISTINCT FROM (
    SELECT COALESCE(sum(member.amount_idr), 0)::integer
    FROM public.later_pay_payment_reservation_orders AS member
    WHERE member.payment_key = reservation.payment_key
  )
     OR EXISTS (
       SELECT 1
       FROM public.later_pay_payment_reservation_orders AS member
       WHERE member.payment_key = reservation.payment_key
         AND member.customer_id IS DISTINCT FROM reservation.customer_id
     )
     OR EXISTS (
       SELECT 1
       FROM public.later_pay_payment_reservation_orders AS member
       WHERE member.payment_key = reservation.payment_key
         AND (
           (reservation.state IN ('reserved', 'ready') AND member.is_open IS NOT TRUE)
           OR (reservation.state IN ('released', 'settled') AND member.is_open IS TRUE)
         )
     )
),
assert_helper_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES (pg_catalog.to_regprocedure(
    'public.assert_later_pay_payment_orders(uuid,uuid,text,text)'
  ))) AS expected(oid)
  LEFT JOIN pg_catalog.pg_proc AS function ON function.oid = expected.oid
  LEFT JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
  WHERE expected.oid IS NULL
     OR owner.rolname <> 'postgres'
     OR function.prosecdef IS TRUE
     OR COALESCE(pg_catalog.has_function_privilege('anon', expected.oid, 'EXECUTE'), false)
     OR COALESCE(pg_catalog.has_function_privilege('authenticated', expected.oid, 'EXECUTE'), false)
     OR COALESCE(pg_catalog.has_function_privilege('service_role', expected.oid, 'EXECUTE'), false)
),
trip_trigger_misconfiguration AS (
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_proc AS function ON function.oid = trigger.tgfoid
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'trips'
      AND trigger.tgname = 'guard_trip_order_membership_write'
      AND function.proname = 'guard_trip_order_membership_write'
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'D'
  ) THEN 0::bigint ELSE 1::bigint END AS rows
),
missing_audit_columns AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES
    ('evidence_amount_verified'),
    ('evidence_detected_amount'),
    ('payment_confirmed_by')
  ) AS expected(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column
    WHERE column.table_schema = 'public'
      AND column.table_name = 'orders'
      AND column.column_name = expected.column_name
  )
),
leftover_migration_helpers AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_proc AS function
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = function.pronamespace
  WHERE namespace.nspname = 'public'
    AND function.proname IN (
      '__patch_customer_order_lock_for_migration',
      '__inject_customer_lock_for_migration'
    )
),
checks AS (
  SELECT 10 AS sort_order, 'atomic_function_security_and_acl'::text AS check_name,
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END AS status,
    rows AS offender_count
  FROM function_misconfiguration
  UNION ALL SELECT 20, 'shared_customer_lock_coverage',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM customer_lock_misconfiguration
  UNION ALL SELECT 30, 'reservation_table_security',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM table_misconfiguration
  UNION ALL SELECT 40, 'reservation_snapshot_integrity',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM reservation_integrity_offenders
  UNION ALL SELECT 50, 'internal_assert_helper_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM assert_helper_misconfiguration
  UNION ALL SELECT 60, 'trip_membership_guard',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM trip_trigger_misconfiguration
  UNION ALL SELECT 70, 'staff_payment_audit_columns',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM missing_audit_columns
  UNION ALL SELECT 80, 'migration_helpers_removed',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM leftover_migration_helpers
)
SELECT check_name, status, offender_count
FROM checks
ORDER BY sort_order;

COMMIT;
