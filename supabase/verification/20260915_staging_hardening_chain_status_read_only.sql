-- STAGING ONLY: read-only artifact inventory for the 2026-09-14 payment/order
-- hardening chain. This script performs no INSERT/UPDATE/DELETE/DDL.

BEGIN;
SET TRANSACTION READ ONLY;

WITH checks(version, artifact, installed) AS (
  SELECT '20260914110000', 'orders.is_active', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'is_active'
  )
  UNION ALL
  SELECT '20260914120000', 'order_items.product_id', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'product_id'
  )
  UNION ALL
  SELECT '20260914130000', 'confirm_paid_voucher_purchase', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_paid_voucher_purchase'
  )
  UNION ALL
  SELECT '20260914140000', 'create_customer_prepay_checkout', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_customer_prepay_checkout'
  )
  UNION ALL
  SELECT '20260914150000', 'midtrans_reconciliation_events', to_regclass('public.midtrans_reconciliation_events') IS NOT NULL
  UNION ALL
  SELECT '20260914160000', 'guard_keyless_prepay_identity', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guard_keyless_prepay_identity'
  )
  UNION ALL
  SELECT '20260914170000', 'create_customer_voucher_only_order', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_customer_voucher_only_order'
  )
  UNION ALL
  SELECT '20260914180000', 'current_staff_context', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'current_staff_context'
  )
  UNION ALL
  SELECT '20260914190000', 'guard_staff_order_write', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guard_staff_order_write'
  )
  UNION ALL
  SELECT '20260914200000', 'create_staff_order_atomic', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'create_staff_order_atomic'
  )
  UNION ALL
  SELECT '20260914210000', 'guard_customer_commercial_write', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'guard_customer_commercial_write'
  )
  UNION ALL
  SELECT '20260914220000', 'submit_customer_later_pay_order', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'submit_customer_later_pay_order'
  )
  UNION ALL
  SELECT '20260914230000', 'later_pay_payment_reservations', to_regclass('public.later_pay_payment_reservations') IS NOT NULL
  UNION ALL
  SELECT '20260914240000', 'set_staff_order_schedule_status', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_staff_order_schedule_status'
  )
  UNION ALL
  SELECT '20260914250000', 'confirm_staff_order_payment_atomic', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_staff_order_payment_atomic'
  )
  UNION ALL
  SELECT '20260914260000', 'confirm_customer_order_delivery_atomic', EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'confirm_customer_order_delivery_atomic'
  )
)
SELECT
  version,
  artifact,
  CASE WHEN installed THEN 'INSTALLED' ELSE 'MISSING' END AS status
FROM checks
ORDER BY version;

COMMIT;
