-- Backfill missing settlement rows for paid pop_*/op_* orders.
-- Safe to run multiple times (only inserts when midtrans_order_id is absent in hq_midtrans_settlements).
-- Note: transaction_id/raw_notification are unknown for historical backfill, set to null/minimal metadata.

-- 1) Missing pop_* (pre_pay one-to-one)
INSERT INTO public.hq_midtrans_settlements (
  midtrans_order_id,
  midtrans_transaction_id,
  gross_amount,
  transaction_status,
  payment_type,
  source_type,
  customer_id,
  branch,
  order_id,
  voucher_purchase_request_id,
  metadata,
  raw_notification,
  settled_at
)
SELECT
  o.midtrans_order_id,
  NULL::text AS midtrans_transaction_id,
  COALESCE(o.qris_charged_idr, o.total_amount)::integer AS gross_amount,
  'settlement'::text AS transaction_status,
  'qris'::text AS payment_type,
  'prepay_order_qris'::text AS source_type,
  o.customer_id,
  o.branch,
  o.id AS order_id,
  NULL::uuid AS voucher_purchase_request_id,
  jsonb_build_object('source', 'manual_backfill_from_orders') AS metadata,
  jsonb_build_object('source', 'manual_backfill_from_orders') AS raw_notification,
  o.created_at AS settled_at
FROM public.orders o
LEFT JOIN public.hq_midtrans_settlements s
  ON s.midtrans_order_id = o.midtrans_order_id
WHERE o.midtrans_order_id LIKE 'pop_%'
  AND o.payment_status = 'paid'
  AND s.id IS NULL;

-- 2) Missing op_* (later_pay batch, allocate from tagged paid orders)
INSERT INTO public.hq_midtrans_settlements (
  midtrans_order_id,
  midtrans_transaction_id,
  gross_amount,
  transaction_status,
  payment_type,
  source_type,
  customer_id,
  branch,
  order_id,
  voucher_purchase_request_id,
  metadata,
  raw_notification,
  settled_at
)
SELECT
  x.midtrans_order_id,
  NULL::text AS midtrans_transaction_id,
  x.gross_amount,
  'settlement'::text AS transaction_status,
  'qris'::text AS payment_type,
  'later_pay_orders'::text AS source_type,
  x.customer_id,
  x.branch,
  NULL::uuid AS order_id,
  NULL::uuid AS voucher_purchase_request_id,
  jsonb_build_object(
    'source', 'manual_backfill_from_orders',
    'later_pay_batch', true,
    'order_allocations', x.order_allocations
  ) AS metadata,
  jsonb_build_object('source', 'manual_backfill_from_orders') AS raw_notification,
  x.settled_at
FROM (
  SELECT
    o.midtrans_order_id,
    COALESCE(SUM(o.total_amount), 0)::integer AS gross_amount,
    (array_agg(o.customer_id ORDER BY o.created_at))[1] AS customer_id,
    MIN(o.branch) AS branch,
    MIN(o.created_at) AS settled_at,
    jsonb_agg(
      jsonb_build_object(
        'order_id', o.id,
        'branch', o.branch,
        'customer_id', o.customer_id,
        'amount_idr', o.total_amount
      )
      ORDER BY o.created_at
    ) AS order_allocations
  FROM public.orders o
  LEFT JOIN public.hq_midtrans_settlements s
    ON s.midtrans_order_id = o.midtrans_order_id
  WHERE o.midtrans_order_id LIKE 'op_%'
    AND o.payment_status = 'paid'
    AND s.id IS NULL
  GROUP BY o.midtrans_order_id
) x;
