-- STAGING ONLY: read-only verification for
-- 20260914180000_harden_identity_and_voucher_acl.sql.
-- Expected result: every row is PASS and offender_count is 0.

BEGIN;
SET TRANSACTION READ ONLY;

WITH
anonymous_relation_offenders AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND grantee IN ('PUBLIC', 'anon')
    AND privilege_type <> 'SELECT'
),
anonymous_select_offenders AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND grantee = 'anon'
    AND privilege_type = 'SELECT'
    AND table_name NOT IN ('branches', 'products', 'voucher_packages')
),
anonymous_function_offenders AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind = 'f'
    AND has_function_privilege('anon', p.oid, 'EXECUTE')
    AND p.oid <> to_regprocedure('public.lookup_login_profile(text)')
),
anonymous_branch_column_offenders AS (
  SELECT (
    SELECT count(*)
    FROM information_schema.columns AS sensitive
    WHERE sensitive.table_schema = 'public'
      AND sensitive.table_name = 'branches'
      AND sensitive.column_name IN (
        'company_name', 'bank_name', 'bank_account_name',
        'bank_account_number', 'payment_qr_url'
      )
      AND has_column_privilege(
        'anon', 'public.branches', sensitive.column_name, 'SELECT'
      )
  ) + (
    SELECT count(*)
    FROM unnest(ARRAY[
      'id', 'name', 'address', 'phone', 'latitude', 'longitude',
      'service_radius_km', 'internal_demo', 'status',
      'order_cutoff_hour', 'closed_weekdays'
    ]) AS required(column_name)
    WHERE NOT has_column_privilege(
      'anon', 'public.branches', required.column_name, 'SELECT'
    )
  ) AS rows
),
authenticated_dangerous_table_grants AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
),
customer_secret_grants AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'customers'
    AND grantee = 'authenticated'
    AND privilege_type = 'SELECT'
    AND column_name IN (
      'auth_token', 'token_created_at', 'auth_user_id', 'last_login_at',
      'voucher_balance'
    )
),
critical_rls_missing AS (
  SELECT count(*)::bigint AS rows
  FROM unnest(ARRAY[
    'app_settings', 'auth_otps', 'branches', 'customer_product_vouchers',
    'customers', 'device_whatsapp_bindings', 'hq_midtrans_settlements',
    'midtrans_reconciliation_events', 'order_items', 'orders',
    'otp_send_log', 'payment_transactions', 'products', 'profiles', 'trips',
    'voucher_packages', 'voucher_purchase_requests', 'voucher_usage_ledger',
    'whatsapp_messages'
  ]) AS expected(table_name)
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.oid = to_regclass(format('public.%I', expected.table_name))
  WHERE c.oid IS NULL OR c.relrowsecurity IS NOT TRUE
),
public_write_policy_offenders AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN (
      'app_settings', 'auth_otps', 'branches', 'customer_product_vouchers',
      'billing_reminders', 'branch_costs', 'branch_midtrans_transfers',
      'branch_settlement_records', 'customers', 'device_whatsapp_bindings',
      'hq_midtrans_settlements', 'midtrans_reconciliation_events',
      'order_corrections', 'product_variants', 'system_configs',
      'order_items', 'orders',
      'otp_send_log', 'payment_transactions', 'products', 'profiles', 'trips',
      'voucher_packages', 'voucher_purchase_requests', 'voucher_usage_ledger',
      'whatsapp_messages'
    )
    AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    AND roles::text[] && ARRAY['public', 'anon']::text[]
),
order_policy_missing AS (
  SELECT count(*)::bigint AS rows
  FROM unnest(ARRAY[
    'staff_insert_orders', 'staff_update_orders', 'staff_delete_orders',
    'staff_insert_order_items', 'staff_update_order_items',
    'staff_delete_order_items', 'staff_read_orders', 'staff_read_order_items'
  ]) AS expected(policy_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.policyname = expected.policy_name
  )
),
order_correction_misconfiguration AS (
  SELECT CASE
    WHEN to_regclass('public.order_corrections') IS NULL THEN 0
    ELSE (
      (NOT COALESCE((
        SELECT c.relrowsecurity
        FROM pg_catalog.pg_class AS c
        WHERE c.oid = to_regclass('public.order_corrections')
      ), false))::integer
      + (NOT has_table_privilege(
        'authenticated', 'public.order_corrections', 'SELECT'
      ))::integer
      + (NOT has_table_privilege(
        'authenticated', 'public.order_corrections', 'INSERT'
      ))::integer
      + has_table_privilege(
        'authenticated', 'public.order_corrections', 'UPDATE'
      )::integer
      + has_table_privilege(
        'authenticated', 'public.order_corrections', 'DELETE'
      )::integer
      + has_table_privilege(
        'anon', 'public.order_corrections', 'SELECT'
      )::integer
      + (NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies AS p
        WHERE p.schemaname = 'public'
          AND p.tablename = 'order_corrections'
          AND p.policyname = 'staff_read_order_corrections'
      ))::integer
      + (NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies AS p
        WHERE p.schemaname = 'public'
          AND p.tablename = 'order_corrections'
          AND p.policyname = 'staff_insert_order_corrections'
      ))::integer
    )
  END::bigint AS rows
),
optional_operational_tables(table_name) AS (
  VALUES
    ('billing_reminders'),
    ('branch_costs'),
    ('branch_midtrans_transfers'),
    ('branch_settlement_records'),
    ('product_variants'),
    ('system_configs')
),
optional_operational_rls_missing AS (
  SELECT count(*)::bigint AS rows
  FROM optional_operational_tables AS expected
  JOIN pg_catalog.pg_class AS c
    ON c.oid = to_regclass(format('public.%I', expected.table_name))
  WHERE c.relrowsecurity IS NOT TRUE
),
optional_operational_table_acl_offenders AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.table_privileges AS privilege
  JOIN optional_operational_tables AS expected
    ON expected.table_name = privilege.table_name
  WHERE privilege.table_schema = 'public'
    AND (
      privilege.grantee IN ('PUBLIC', 'anon')
      OR (
        privilege.grantee = 'authenticated'
        AND NOT (
          privilege.privilege_type = 'SELECT'
          AND privilege.table_name IN (
            'branch_midtrans_transfers', 'branch_settlement_records',
            'product_variants', 'system_configs'
          )
        )
      )
    )
),
optional_operational_service_acl_missing AS (
  SELECT count(*)::bigint AS rows
  FROM optional_operational_tables AS expected
  JOIN pg_catalog.pg_class AS c
    ON c.oid = to_regclass(format('public.%I', expected.table_name))
  WHERE NOT has_table_privilege(
    'service_role', c.oid,
    'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'
  )
),
optional_operational_policy_expectations(table_name, policy_name, command) AS (
  VALUES
    ('billing_reminders', 'staff_read_billing_reminders', 'SELECT'),
    ('billing_reminders', 'staff_insert_billing_reminders', 'INSERT'),
    ('branch_costs', 'staff_read_branch_costs', 'SELECT'),
    ('branch_costs', 'staff_insert_branch_costs', 'INSERT'),
    ('branch_costs', 'staff_update_branch_costs', 'UPDATE'),
    ('branch_midtrans_transfers',
      'active_admin_fin_read_branch_midtrans_transfers', 'SELECT'),
    ('branch_midtrans_transfers',
      'active_admin_fin_insert_branch_midtrans_transfers', 'INSERT'),
    ('branch_midtrans_transfers',
      'active_admin_fin_update_branch_midtrans_transfers', 'UPDATE'),
    ('branch_settlement_records',
      'active_admin_fin_read_branch_settlement_records', 'SELECT'),
    ('branch_settlement_records',
      'active_admin_fin_insert_branch_settlement_records', 'INSERT'),
    ('branch_settlement_records',
      'active_admin_fin_update_branch_settlement_records', 'UPDATE'),
    ('product_variants', 'active_admin_read_product_variants', 'SELECT'),
    ('product_variants', 'active_admin_update_product_variants', 'UPDATE'),
    ('system_configs', 'active_admin_read_system_configs', 'SELECT'),
    ('system_configs', 'active_admin_update_system_configs', 'UPDATE')
),
optional_operational_policy_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM optional_operational_policy_expectations AS expected
  WHERE to_regclass(format('public.%I', expected.table_name)) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = expected.table_name
        AND policy.policyname = expected.policy_name
        AND policy.cmd = expected.command
        AND policy.roles::text[] @> ARRAY['authenticated']::text[]
        AND NOT (
          policy.roles::text[] && ARRAY['public', 'anon']::text[]
        )
    )
),
optional_operational_extra_policies AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_policies AS policy
  JOIN optional_operational_tables AS expected
    ON expected.table_name = policy.tablename
  WHERE policy.schemaname = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM optional_operational_policy_expectations AS wanted
      WHERE wanted.table_name = policy.tablename
        AND wanted.policy_name = policy.policyname
        AND wanted.command = policy.cmd
    )
),
optional_required_column_grants(
  table_name, privilege_type, column_name
) AS (
  SELECT configured.table_name, configured.privilege_type, columns.column_name
  FROM (VALUES
    ('billing_reminders', 'SELECT', ARRAY[
      'id', 'customer_id', 'reminder_type', 'period_key',
      'attempt', 'sent_at', 'sent_by_name'
    ]::text[]),
    ('billing_reminders', 'INSERT', ARRAY[
      'customer_id', 'branch', 'reminder_type', 'period_key', 'attempt',
      'sent_by_id', 'sent_by_name', 'order_ids', 'total_amount', 'message_text'
    ]::text[]),
    ('branch_costs', 'SELECT', ARRAY[
      'branch', 'year', 'month', 'category', 'item', 'amount', 'note'
    ]::text[]),
    ('branch_costs', 'INSERT', ARRAY[
      'branch', 'year', 'month', 'category', 'item', 'amount', 'note',
      'created_by', 'updated_at'
    ]::text[]),
    ('branch_costs', 'UPDATE', ARRAY[
      'branch', 'year', 'month', 'category', 'item', 'amount', 'note',
      'created_by', 'updated_at'
    ]::text[]),
    ('branch_midtrans_transfers', 'INSERT', ARRAY[
      'branch', 'year', 'month', 'voucher_gross', 'direct_qris_gross',
      'midtrans_fee', 'net_amount', 'status', 'transfer_date',
      'transferred_by', 'note', 'updated_at'
    ]::text[]),
    ('branch_midtrans_transfers', 'UPDATE', ARRAY[
      'branch', 'year', 'month', 'voucher_gross', 'direct_qris_gross',
      'midtrans_fee', 'net_amount', 'status', 'transfer_date',
      'transferred_by', 'note', 'updated_at'
    ]::text[]),
    ('branch_settlement_records', 'INSERT', ARRAY[
      'branch', 'year', 'month', 'total_orders', 'gross_amount',
      'platform_fee', 'net_amount', 'status', 'paid_date',
      'paid_by', 'note', 'updated_at'
    ]::text[]),
    ('branch_settlement_records', 'UPDATE', ARRAY[
      'branch', 'year', 'month', 'total_orders', 'gross_amount',
      'platform_fee', 'net_amount', 'status', 'paid_date',
      'paid_by', 'note', 'updated_at'
    ]::text[]),
    ('product_variants', 'UPDATE', ARRAY[
      'qty', 'price', 'label', 'is_active', 'description', 'updated_at'
    ]::text[]),
    ('system_configs', 'UPDATE', ARRAY[
      'config_value', 'updated_by', 'updated_at'
    ]::text[])
  ) AS configured(table_name, privilege_type, column_names)
  CROSS JOIN LATERAL unnest(configured.column_names) AS columns(column_name)
),
optional_missing_column_grants AS (
  SELECT count(*)::bigint AS rows
  FROM optional_required_column_grants AS required
  WHERE to_regclass(format('public.%I', required.table_name)) IS NOT NULL
    AND NOT has_column_privilege(
      'authenticated',
      to_regclass(format('public.%I', required.table_name)),
      required.column_name,
      required.privilege_type
    )
),
optional_restricted_column_privileges(table_name, privilege_type) AS (
  VALUES
    ('billing_reminders', 'SELECT'),
    ('branch_costs', 'SELECT'),
    ('billing_reminders', 'INSERT'),
    ('branch_costs', 'INSERT'),
    ('branch_midtrans_transfers', 'INSERT'),
    ('branch_settlement_records', 'INSERT'),
    ('product_variants', 'INSERT'),
    ('system_configs', 'INSERT'),
    ('billing_reminders', 'UPDATE'),
    ('branch_costs', 'UPDATE'),
    ('branch_midtrans_transfers', 'UPDATE'),
    ('branch_settlement_records', 'UPDATE'),
    ('product_variants', 'UPDATE'),
    ('system_configs', 'UPDATE')
),
optional_extra_column_grants AS (
  SELECT count(*)::bigint AS rows
  FROM optional_restricted_column_privileges AS restricted
  JOIN information_schema.columns AS column_info
    ON column_info.table_schema = 'public'
   AND column_info.table_name = restricted.table_name
  WHERE has_column_privilege(
      'authenticated',
      to_regclass(format('public.%I', restricted.table_name)),
      column_info.column_name,
      restricted.privilege_type
    )
    AND NOT EXISTS (
      SELECT 1
      FROM optional_required_column_grants AS allowed
      WHERE allowed.table_name = restricted.table_name
        AND allowed.privilege_type = restricted.privilege_type
        AND allowed.column_name = column_info.column_name
    )
),
optional_operational_misconfiguration AS (
  SELECT (
    (SELECT rows FROM optional_operational_rls_missing)
    + (SELECT rows FROM optional_operational_table_acl_offenders)
    + (SELECT rows FROM optional_operational_service_acl_missing)
    + (SELECT rows FROM optional_operational_policy_misconfiguration)
    + (SELECT rows FROM optional_operational_extra_policies)
    + (SELECT rows FROM optional_missing_column_grants)
    + (SELECT rows FROM optional_extra_column_grants)
  )::bigint AS rows
),
report_rpc_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'get_borrowed_customers_with_last_order', 'get_churn_candidates',
      'get_customer_activity', 'get_top_customers', 'get_trend_stats'
    )
    AND (
      p.prosecdef
      OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR NOT COALESCE(
        p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[],
        false
      )
      OR (
        p.proname = 'get_trend_stats'
        AND position('p_branch = ''All''' IN p.prosrc) = 0
      )
    )
),
voucher_topup_rpc_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM (VALUES (
    to_regprocedure(
      'public.increment_voucher_balance(uuid,uuid,integer)'
    )
  )) AS expected(oid)
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = expected.oid
  WHERE p.oid IS NULL
    OR NOT p.prosecdef
    OR has_function_privilege('anon', p.oid, 'EXECUTE')
    OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
    OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    OR NOT COALESCE(
      p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[],
      false
    )
),
borrow_refresh_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'refresh_customer_current_borrowed',
      'trigger_refresh_customer_borrowed_on_order_change'
    )
    AND (
      NOT p.prosecdef
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
),
dangerous_rpc_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'regenerate_auth_token', 'check_voucher_balance', 'deduct_vouchers',
      'delete_old_otps', 'confirm_paid_voucher_purchase',
      'create_customer_prepay_checkout', 'store_customer_prepay_snap_session',
      'release_customer_prepay_checkout', 'settle_customer_prepay_checkout',
      'create_customer_voucher_only_order', 'cancel_customer_pending_order'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
),
client_view_misconfiguration AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'v'
    AND (
      has_table_privilege('anon', c.oid, 'SELECT')
      OR NOT COALESCE(
        c.reloptions @> ARRAY['security_invoker=true']::text[],
        false
      )
      OR (
        has_table_privilege('authenticated', c.oid, 'SELECT')
        AND c.relname <> 'hq_vw_order_payment_settled_daily'
      )
    )
),
required_triggers_missing AS (
  SELECT count(*)::bigint AS rows
  FROM unnest(ARRAY[
    'guard_order_active_branch',
    'guard_branch_client_update',
    'guard_customer_voucher_client_update',
    'enforce_confirmed_voucher_purchase_settlement'
  ]) AS expected(trigger_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    WHERE t.tgname = expected.trigger_name
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  )
),
checks AS (
  SELECT 10 AS sort_order, 'schema_boundary'::text AS check_name,
    CASE WHEN
      has_schema_privilege('anon', 'public', 'USAGE')
      AND has_schema_privilege('authenticated', 'public', 'USAGE')
      AND NOT has_schema_privilege('anon', 'public', 'CREATE')
      AND NOT has_schema_privilege('authenticated', 'public', 'CREATE')
    THEN 'PASS' ELSE 'BLOCK' END AS status,
    0::bigint AS offender_count

  UNION ALL SELECT 20, 'anonymous_relation_writes',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM anonymous_relation_offenders
  UNION ALL SELECT 30, 'anonymous_extra_selects',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM anonymous_select_offenders
  UNION ALL SELECT 40, 'anonymous_extra_functions',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM anonymous_function_offenders
  UNION ALL SELECT 45, 'anonymous_branch_columns',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM anonymous_branch_column_offenders
  UNION ALL SELECT 50, 'authenticated_dangerous_table_grants',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM authenticated_dangerous_table_grants
  UNION ALL SELECT 60, 'customer_secret_columns',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM customer_secret_grants
  UNION ALL SELECT 70, 'critical_table_rls',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM critical_rls_missing
  UNION ALL SELECT 80, 'public_write_policies',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM public_write_policy_offenders
  UNION ALL SELECT 90, 'order_policy_set',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM order_policy_missing
  UNION ALL SELECT 95, 'order_correction_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM order_correction_misconfiguration
  UNION ALL SELECT 97, 'optional_operational_table_boundaries',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM optional_operational_misconfiguration
  UNION ALL SELECT 100, 'report_rpc_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM report_rpc_misconfiguration
  UNION ALL SELECT 105, 'voucher_topup_rpc_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM voucher_topup_rpc_misconfiguration
  UNION ALL SELECT 110, 'borrow_refresh_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM borrow_refresh_misconfiguration
  UNION ALL SELECT 120, 'dangerous_rpc_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM dangerous_rpc_misconfiguration
  UNION ALL SELECT 125, 'client_view_boundary',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM client_view_misconfiguration
  UNION ALL SELECT 130, 'required_triggers',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END, rows
    FROM required_triggers_missing
)
SELECT check_name, status, offender_count
FROM checks
ORDER BY sort_order;

COMMIT;
