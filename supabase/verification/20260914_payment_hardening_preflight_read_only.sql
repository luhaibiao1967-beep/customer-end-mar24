-- STAGING ONLY: read-only checks to run before the 2026-09-14 payment/order
-- hardening migrations.  This script performs no INSERT/UPDATE/DELETE/DDL.

BEGIN;
SET TRANSACTION READ ONLY;

WITH
invalid_customer_types AS (
  SELECT count(*)::bigint AS rows
  FROM public.customers
  WHERE customer_type IS NULL
     OR customer_type::text NOT IN ('pre_paid', 'later_paid', 'pre_pay', 'later_pay')
),
duplicate_voucher_midtrans_ids AS (
  SELECT count(*)::bigint AS groups
  FROM (
    SELECT midtrans_order_id
    FROM public.voucher_purchase_requests
    WHERE midtrans_order_id IS NOT NULL
    GROUP BY midtrans_order_id
    HAVING count(*) > 1
  ) AS duplicates
),
duplicate_pop_midtrans_ids AS (
  SELECT count(*)::bigint AS groups
  FROM (
    SELECT midtrans_order_id
    FROM public.orders
    WHERE left(midtrans_order_id, 4) = 'pop_'
    GROUP BY midtrans_order_id
    HAVING count(*) > 1
  ) AS duplicates
),
invalid_voucher_balances AS (
  SELECT count(*)::bigint AS rows
  FROM public.customer_product_vouchers
  WHERE balance < 0
     OR gift_balance < 0
     OR gift_balance > balance
),
paid_vouchers_without_cost_basis AS (
  SELECT count(*)::bigint AS rows
  FROM public.customer_product_vouchers AS cpv
  WHERE cpv.balance > cpv.gift_balance
    AND NOT EXISTS (
      SELECT 1
      FROM public.voucher_purchase_requests AS r
      WHERE r.customer_id = cpv.customer_id
        AND r.product_id = cpv.product_id
        AND r.status = 'confirmed'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.voucher_packages AS vp
      WHERE vp.product_id = cpv.product_id
        AND vp.is_active = true
        AND vp.qty > 0
        AND vp.price > 0
    )
),
active_legacy_items_without_product_id AS (
  SELECT count(*)::bigint AS rows
  FROM public.order_items AS oi
  JOIN public.orders AS o ON o.id = oi.order_id
  WHERE to_jsonb(oi) ->> 'product_id' IS NULL
    AND COALESCE((to_jsonb(o) ->> 'is_active')::boolean, true)
),
legacy_keyless_prepay_payment_rows AS (
  SELECT count(*)::bigint AS rows
  FROM public.orders AS o
  WHERE to_jsonb(o) ->> 'prepay_checkout_key' IS NULL
    AND (
      left(o.midtrans_order_id, 4) = 'pop_'
      OR COALESCE((to_jsonb(o) ->> 'qris_charged_idr')::numeric, 0) > 0
      OR to_jsonb(o) ->> 'prepay_snap_token' IS NOT NULL
      OR to_jsonb(o) ->> 'prepay_released_at' IS NOT NULL
    )
),
public_write_policies AS (
  SELECT count(*)::bigint AS rows
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('orders', 'order_items')
    AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    AND (
      'public' = ANY (roles::text[])
      OR 'anon' = ANY (roles::text[])
    )
),
public_write_grants AS (
  SELECT count(*)::bigint AS rows
  FROM information_schema.table_privileges
  WHERE table_schema = 'public'
    AND table_name IN ('orders', 'order_items')
    AND grantee IN ('PUBLIC', 'anon')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
),
expected_columns(table_name, column_name) AS (
  VALUES
    ('orders', 'is_active'),
    ('orders', 'inactivated_at'),
    ('orders', 'note'),
    ('orders', 'payment_confirmation_type'),
    ('order_items', 'product_id')
),
missing_compatibility_columns AS (
  SELECT count(*)::bigint AS rows
  FROM expected_columns AS e
  LEFT JOIN information_schema.columns AS c
    ON c.table_schema = 'public'
   AND c.table_name = e.table_name
   AND c.column_name = e.column_name
  WHERE c.column_name IS NULL
),
checks AS (
  SELECT
    10 AS sort_order,
    'customer_type_values'::text AS check_name,
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END AS status,
    format('%s rows are NULL or outside the known legacy/current values', rows) AS details
  FROM invalid_customer_types

  UNION ALL
  SELECT
    20,
    'voucher_midtrans_uniqueness',
    CASE WHEN groups = 0 THEN 'PASS' ELSE 'BLOCK' END,
    format('%s duplicate non-null Midtrans id groups', groups)
  FROM duplicate_voucher_midtrans_ids

  UNION ALL
  SELECT
    30,
    'prepay_pop_midtrans_uniqueness',
    CASE WHEN groups = 0 THEN 'PASS' ELSE 'BLOCK' END,
    format('%s duplicate pop_* Midtrans id groups', groups)
  FROM duplicate_pop_midtrans_ids

  UNION ALL
  SELECT
    40,
    'voucher_balance_invariants',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'BLOCK' END,
    format('%s rows have negative balance/gift balance or gift balance above total', rows)
  FROM invalid_voucher_balances

  UNION ALL
  SELECT
    50,
    'paid_voucher_cost_basis',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'REVIEW' END,
    format('%s positive paid-voucher rows have neither a confirmed purchase nor an active package', rows)
  FROM paid_vouchers_without_cost_basis

  UNION ALL
  SELECT
    60,
    'active_legacy_order_items',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'REVIEW' END,
    format('%s item rows on active orders have no canonical product_id', rows)
  FROM active_legacy_items_without_product_id

  UNION ALL
  SELECT
    70,
    'legacy_keyless_prepay_rows',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'REVIEW' END,
    format('%s legacy rows carry pop_/QRIS/Snap identity without a checkout key', rows)
  FROM legacy_keyless_prepay_payment_rows

  UNION ALL
  SELECT
    80,
    'public_order_write_policies',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'WILL_FIX' END,
    format('%s PUBLIC/anon write policies will be removed by migration 1600', rows)
  FROM public_write_policies

  UNION ALL
  SELECT
    90,
    'public_order_table_grants',
    CASE WHEN rows = 0 THEN 'PASS' ELSE 'WILL_FIX' END,
    format('%s PUBLIC/anon write grants will be revoked by migration 1600', rows)
  FROM public_write_grants

  UNION ALL
  SELECT
    100,
    'compatibility_columns',
    'PASS',
    format('%s missing compatibility columns will be added by migrations 1100/1200', rows)
  FROM missing_compatibility_columns
)
SELECT check_name, status, details
FROM checks
ORDER BY sort_order;

COMMIT;
