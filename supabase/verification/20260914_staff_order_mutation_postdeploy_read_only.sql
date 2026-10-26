-- STAGING ONLY: read-only verification for the final staff-order boundary
-- established by 20260914190000_harden_staff_order_mutations.sql and
-- 20260914200000_atomic_staff_order_workflows.sql, plus the customer
-- commercial-field boundary established by
-- 20260914210000_harden_customer_commercial_updates.sql, and the atomic
-- customer later-pay boundary established by
-- 20260914220000_atomic_customer_later_pay_order.sql.
-- Expected result: every row is PASS and offender_count is 0.

BEGIN;
SET TRANSACTION READ ONLY;

WITH
expected_table_acl(role_name, table_name, privilege_type, expected) AS (
  VALUES
    ('anon', 'orders', 'SELECT', false),
    ('anon', 'orders', 'INSERT', false),
    ('anon', 'orders', 'UPDATE', false),
    ('anon', 'orders', 'DELETE', false),
    ('anon', 'order_items', 'SELECT', false),
    ('anon', 'order_items', 'INSERT', false),
    ('anon', 'order_items', 'UPDATE', false),
    ('anon', 'order_items', 'DELETE', false),
    ('anon', 'order_corrections', 'SELECT', false),
    ('anon', 'order_corrections', 'INSERT', false),
    ('anon', 'order_corrections', 'UPDATE', false),
    ('anon', 'order_corrections', 'DELETE', false),
    ('authenticated', 'orders', 'SELECT', true),
    ('authenticated', 'orders', 'INSERT', false),
    ('authenticated', 'orders', 'UPDATE', false),
    ('authenticated', 'orders', 'DELETE', false),
    ('authenticated', 'order_items', 'SELECT', true),
    ('authenticated', 'order_items', 'INSERT', false),
    ('authenticated', 'order_items', 'UPDATE', false),
    ('authenticated', 'order_items', 'DELETE', false),
    ('authenticated', 'order_corrections', 'SELECT', true),
    ('authenticated', 'order_corrections', 'INSERT', false),
    ('authenticated', 'order_corrections', 'UPDATE', false),
    ('authenticated', 'order_corrections', 'DELETE', false),
    ('service_role', 'orders', 'SELECT', true),
    ('service_role', 'orders', 'INSERT', true),
    ('service_role', 'orders', 'UPDATE', true),
    ('service_role', 'orders', 'DELETE', true),
    ('service_role', 'order_items', 'SELECT', true),
    ('service_role', 'order_items', 'INSERT', true),
    ('service_role', 'order_items', 'UPDATE', true),
    ('service_role', 'order_items', 'DELETE', true),
    ('service_role', 'order_corrections', 'SELECT', true),
    ('service_role', 'order_corrections', 'INSERT', true),
    ('service_role', 'order_corrections', 'UPDATE', true),
    ('service_role', 'order_corrections', 'DELETE', true)
),
table_acl_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM expected_table_acl AS expected
  WHERE to_regclass(format('public.%I', expected.table_name)) IS NULL
     OR has_table_privilege(
          expected.role_name,
          format('public.%I', expected.table_name),
          expected.privilege_type
        ) IS DISTINCT FROM expected.expected
),
allowed_order_update(column_name) AS (
  VALUES
    ('customer_id'), ('customer_name'), ('customer_address'),
    ('customer_whatsapp'), ('customer_discount'), ('branch'),
    ('total_amount'), ('delivery_date'), ('note'), ('status'),
    ('payment_status'), ('payment_evidence'), ('paid_date'),
    ('delivery_evidence'), ('delivered_date'),
    ('empty_gallons_returned'), ('borrowed_gallons'),
    ('evidence_amount_verified'), ('evidence_detected_amount'),
    ('payment_confirmation_type'), ('is_active'), ('inactivated_at'),
    ('inactivated_by'), ('delivered_by'), ('payment_confirmed_by')
),
existing_allowed_order_update AS (
  SELECT allowed.column_name
  FROM allowed_order_update AS allowed
  JOIN information_schema.columns AS column_info
    ON column_info.table_schema = 'public'
   AND column_info.table_name = 'orders'
   AND column_info.column_name = allowed.column_name
),
missing_order_update_columns AS (
  SELECT count(*)::bigint AS rows
  FROM existing_allowed_order_update AS allowed
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.column_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name = 'orders'
      AND privilege.column_name = allowed.column_name
      AND privilege.grantee = 'authenticated'
      AND privilege.privilege_type = 'UPDATE'
  )
),
unexpected_browser_write_columns AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.column_privileges AS privilege
  WHERE privilege.table_schema = 'public'
    AND privilege.grantee IN ('anon', 'authenticated')
    AND privilege.table_name IN ('orders', 'order_items', 'order_corrections')
    AND privilege.privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    AND NOT (
      privilege.grantee = 'authenticated'
      AND privilege.table_name = 'orders'
      AND privilege.privilege_type = 'UPDATE'
      AND EXISTS (
        SELECT 1
        FROM existing_allowed_order_update AS allowed
        WHERE allowed.column_name = privilege.column_name
      )
    )
),
column_acl_misconfiguration AS (
  SELECT (
    (SELECT rows FROM missing_order_update_columns)
    + (SELECT rows FROM unexpected_browser_write_columns)
  )::bigint AS rows
),
policy_misconfiguration AS (
  SELECT (
    (
      SELECT count(*)
      FROM (VALUES ('orders', 'staff_update_orders', 'UPDATE'))
        AS required(table_name, policy_name, command)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_policies AS policy
        WHERE policy.schemaname = 'public'
          AND policy.tablename = required.table_name
          AND policy.policyname = required.policy_name
          AND policy.cmd = required.command
          AND policy.roles::text[] = ARRAY['authenticated']::text[]
      )
    ) + (
      SELECT count(*)
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename IN ('orders', 'order_items', 'order_corrections')
        AND policy.cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
        AND NOT (
          policy.tablename = 'orders'
          AND policy.policyname = 'staff_update_orders'
          AND policy.cmd = 'UPDATE'
          AND policy.roles::text[] = ARRAY['authenticated']::text[]
        )
    )
  )::bigint AS rows
),
read_policy_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES
    ('orders', 'staff_read_orders'),
    ('order_items', 'staff_read_order_items'),
    ('order_corrections', 'staff_read_order_corrections')
  ) AS required(table_name, policy_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = required.table_name
      AND policy.policyname = required.policy_name
      AND policy.cmd = 'SELECT'
      AND policy.roles::text[] = ARRAY['authenticated']::text[]
  )
),
rls_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES ('orders'), ('order_items'), ('order_corrections'))
    AS required(table_name)
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.oid = to_regclass(format('public.%I', required.table_name))
  WHERE relation.oid IS NULL OR relation.relrowsecurity IS DISTINCT FROM true
),
expected_triggers(table_name, trigger_name, function_name, trigger_type) AS (
  VALUES
    ('orders', 'guard_staff_order_write', 'guard_staff_order_write', 23::smallint),
    ('order_items', 'guard_staff_order_item_write',
      'guard_staff_order_item_write', 31::smallint),
    ('order_items', 'refresh_order_total_from_items',
      'refresh_order_total_from_items', 29::smallint),
    ('customers', 'guard_customer_commercial_write',
      'guard_customer_commercial_write', 23::smallint)
),
trigger_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM expected_triggers AS expected
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_catalog.pg_proc AS function ON function.oid = trigger.tgfoid
    WHERE namespace.nspname = 'public'
      AND relation.relname = expected.table_name
      AND trigger.tgname = expected.trigger_name
      AND function.proname = expected.function_name
      AND trigger.tgtype = expected.trigger_type
      AND NOT trigger.tgisinternal
      AND trigger.tgenabled <> 'D'
  )
),
expected_functions(
  signature, security_definer, authenticated_execute, service_execute
) AS (
  VALUES
    ('public.normalize_staff_order_items(jsonb)', true, false, false),
    ('public.staff_order_actor_label()', true, false, false),
    ('public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)',
      true, true, false),
    ('public.correct_staff_order_atomic(uuid,uuid,date,text,integer,jsonb,text)',
      true, true, false),
    ('public.finalize_staff_order_delivery(uuid,date,text,text,integer,jsonb,boolean,text,text)',
      true, true, false),
    ('public.cancel_staff_order_atomic(uuid)', true, true, false),
    ('public.cancel_customer_pending_order(uuid,uuid)', true, false, true),
    ('public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)',
      true, false, true),
    ('public.staff_order_has_voucher_ledger(uuid)', true, true, true),
    ('public.guard_staff_order_write()', false, false, false),
    ('public.guard_staff_order_item_write()', false, false, false),
    ('public.refresh_order_total_from_items()', true, false, false),
    ('public.guard_customer_commercial_write()', true, false, false)
),
function_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM expected_functions AS expected
  LEFT JOIN pg_catalog.pg_proc AS function
    ON function.oid = to_regprocedure(expected.signature)
  LEFT JOIN pg_catalog.pg_roles AS owner ON owner.oid = function.proowner
  WHERE function.oid IS NULL
    OR function.prosecdef IS DISTINCT FROM expected.security_definer
    OR owner.rolname IS DISTINCT FROM 'postgres'
    OR NOT COALESCE(
      function.proconfig @> ARRAY['search_path=pg_catalog, public']::text[],
      false
    )
    OR has_function_privilege('anon', function.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', function.oid, 'EXECUTE')
         IS DISTINCT FROM expected.authenticated_execute
    OR has_function_privilege('service_role', function.oid, 'EXECUTE')
         IS DISTINCT FROM expected.service_execute
),
customer_commercial_acl_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES
    ('table', 'anon', 'SELECT', NULL::text, false),
    ('table', 'anon', 'INSERT', NULL::text, false),
    ('table', 'anon', 'UPDATE', NULL::text, false),
    ('table', 'anon', 'DELETE', NULL::text, false),
    ('table', 'authenticated', 'UPDATE', NULL::text, false),
    ('column', 'authenticated', 'UPDATE', 'discount', true),
    ('column', 'authenticated', 'UPDATE', 'customer_type', true),
    ('column', 'authenticated', 'UPDATE', 'voucher_balance', false),
    ('column', 'authenticated', 'UPDATE', 'auth_token', false),
    ('table', 'service_role', 'UPDATE', NULL::text, true)
  ) AS expected(scope, role_name, privilege_type, column_name, allowed)
  WHERE CASE expected.scope
    WHEN 'table' THEN has_table_privilege(
      expected.role_name,
      'public.customers',
      expected.privilege_type
    )
    ELSE has_column_privilege(
      expected.role_name,
      'public.customers',
      expected.column_name,
      expected.privilege_type
    )
  END IS DISTINCT FROM expected.allowed
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       WHERE relation.oid = to_regclass('public.customers')
         AND relation.relrowsecurity IS TRUE
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_policies AS policy
       WHERE policy.schemaname = 'public'
         AND policy.tablename = 'customers'
         AND policy.policyname = 'staff_update_customers'
         AND policy.cmd = 'UPDATE'
         AND policy.roles::text[] = ARRAY['authenticated']::text[]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS function
       WHERE function.oid =
         to_regprocedure('public.guard_customer_commercial_write()')
         AND position(
           'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
           IN pg_get_functiondef(function.oid)
         ) > 0
         AND position(
           'CUSTOMER_BORROWED_BALANCE_INVALID'
           IN pg_get_functiondef(function.oid)
         ) > 0
         AND position(
           'pg_trigger_depth() > 1'
           IN pg_get_functiondef(function.oid)
         ) > 0
     )
),
later_pay_atomic_boundary_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES
    ('later_pay_order_key', 'uuid'),
    ('later_pay_order_request_hash', 'text')
  ) AS expected(column_name, data_type)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_info
    WHERE column_info.table_schema = 'public'
      AND column_info.table_name = 'orders'
      AND column_info.column_name = expected.column_name
      AND column_info.data_type = expected.data_type
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_info
    WHERE constraint_info.conrelid = to_regclass('public.orders')
      AND constraint_info.conname = 'orders_later_pay_order_identity_check'
      AND constraint_info.contype = 'c'
      AND constraint_info.convalidated IS TRUE
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_index AS index_info
      ON index_info.indexrelid = index_relation.oid
    WHERE index_relation.oid =
          to_regclass('public.orders_later_pay_order_key_key')
      AND index_info.indrelid = to_regclass('public.orders')
      AND index_info.indisunique IS TRUE
      AND index_info.indisvalid IS TRUE
      AND index_info.indpred IS NOT NULL
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS function
    WHERE function.oid = to_regprocedure(
      'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)'
    )
      AND position('pg_advisory_xact_lock' IN pg_get_functiondef(function.oid)) > 0
      AND position('FOR UPDATE' IN pg_get_functiondef(function.oid)) > 0
      AND position('CREDIT_LIMIT_EXCEEDED' IN pg_get_functiondef(function.oid)) > 0
      AND position('OUTSTANDING_PAYMENT_BLOCKED' IN pg_get_functiondef(function.oid)) > 0
      AND position('LATER_PAY_ORDER_KEY_CONFLICT' IN pg_get_functiondef(function.oid)) > 0
  )
),
active_order_item_blockers AS (
  SELECT (
    (
      SELECT count(*)
      FROM public.orders AS orders
      WHERE orders.is_active IS TRUE
        AND orders.status IN ('pending', 'scheduled')
        AND NOT EXISTS (
          SELECT 1 FROM public.order_items AS item
          WHERE item.order_id = orders.id
        )
    ) + (
      SELECT count(*)
      FROM public.order_items AS item
      JOIN public.orders AS orders ON orders.id = item.order_id
      WHERE orders.is_active IS TRUE
        AND orders.status IN ('pending', 'scheduled')
        AND (
          item.product_id IS NULL
          OR NULLIF(btrim(item.product), '') IS NULL
          OR item.quantity <= 0
          OR item.unit_price < 0
          OR COALESCE(item.discount, 0) < 0
          OR COALESCE(item.discount, 0) > item.unit_price
        )
    )
  )::bigint AS rows
),
active_order_total_drift AS (
  SELECT count(*)::bigint AS rows
  FROM public.orders AS orders
  JOIN LATERAL (
    SELECT COALESCE(SUM(
      (item.unit_price::bigint - COALESCE(item.discount, 0)::bigint)
      * item.quantity::bigint
    ), 0)::bigint AS trusted_total
    FROM public.order_items AS item
    WHERE item.order_id = orders.id
  ) AS totals ON true
  WHERE orders.is_active IS TRUE
    AND orders.status IN ('pending', 'scheduled')
    AND orders.total_amount::bigint IS DISTINCT FROM totals.trusted_total
),
checks AS (
  SELECT 10 AS sort_order, 'atomic_table_acl'::text AS check_name,
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END AS status,
    rows AS offender_count
  FROM table_acl_misconfiguration
  UNION ALL SELECT 20, 'guarded_order_update_columns',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM column_acl_misconfiguration
  UNION ALL SELECT 30, 'atomic_write_policies',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM policy_misconfiguration
  UNION ALL SELECT 40, 'staff_read_policies',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM read_policy_misconfiguration
  UNION ALL SELECT 50, 'staff_order_rls',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM rls_misconfiguration
  UNION ALL SELECT 60, 'staff_order_guard_triggers',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM trigger_misconfiguration
  UNION ALL SELECT 70, 'atomic_rpc_and_helper_acl',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM function_misconfiguration
  UNION ALL SELECT 75, 'customer_commercial_write_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM customer_commercial_acl_misconfiguration
  UNION ALL SELECT 77, 'customer_later_pay_atomic_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM later_pay_atomic_boundary_misconfiguration
  UNION ALL SELECT 80, 'active_order_item_integrity',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM active_order_item_blockers
  UNION ALL SELECT 90, 'active_order_total_integrity',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM active_order_total_drift
)
SELECT check_name, status, offender_count
FROM checks
ORDER BY sort_order;

COMMIT;
