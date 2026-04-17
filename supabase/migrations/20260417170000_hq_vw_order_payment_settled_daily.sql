-- HQ report view: one row per order-level cash settlement using Midtrans settled date (Asia/Jakarta).
-- This keeps Midtrans daily reconciliation aligned with dashboard "Settlement" counts.

CREATE OR REPLACE VIEW public.hq_vw_order_payment_settled_daily AS
WITH prepay_rows AS (
  SELECT
    (s.settled_at AT TIME ZONE 'Asia/Jakarta')::date AS settled_date_jkt,
    s.settled_at,
    s.created_at AS settlement_created_at,
    s.midtrans_order_id,
    s.source_type,
    o.id AS order_id,
    o.customer_id,
    o.branch,
    o.status AS order_status,
    o.payment_status,
    o.delivery_date,
    COALESCE(s.gross_amount, 0)::bigint AS qris_idr,
    COALESCE(o.total_amount, 0)::bigint AS order_total_idr
  FROM public.hq_midtrans_settlements s
  JOIN public.orders o
    ON (o.id = s.order_id OR o.midtrans_order_id = s.midtrans_order_id)
  WHERE s.source_type = 'prepay_order_qris'
),
later_pay_rows AS (
  SELECT
    (s.settled_at AT TIME ZONE 'Asia/Jakarta')::date AS settled_date_jkt,
    s.settled_at,
    s.created_at AS settlement_created_at,
    s.midtrans_order_id,
    s.source_type,
    o.id AS order_id,
    o.customer_id,
    o.branch,
    o.status AS order_status,
    o.payment_status,
    o.delivery_date,
    COALESCE(o.total_amount, 0)::bigint AS qris_idr,
    COALESCE(o.total_amount, 0)::bigint AS order_total_idr
  FROM public.hq_midtrans_settlements s
  JOIN public.orders o
    ON o.midtrans_order_id = s.midtrans_order_id
  WHERE s.source_type = 'later_pay_orders'
),
order_rows AS (
  SELECT * FROM prepay_rows
  UNION ALL
  SELECT * FROM later_pay_rows
)
SELECT
  r.settled_date_jkt,
  r.settled_at,
  r.settlement_created_at,
  r.midtrans_order_id,
  r.source_type,
  r.order_id,
  r.customer_id,
  c.name AS customer_name,
  r.branch,
  r.order_status,
  r.payment_status,
  r.delivery_date,
  COALESCE(v.voucher_qty, 0)::bigint AS voucher_qty,
  COALESCE(v.voucher_rp, 0)::bigint AS voucher_rp,
  r.qris_idr,
  r.order_total_idr
FROM order_rows r
LEFT JOIN public.customers c ON c.id = r.customer_id
LEFT JOIN (
  SELECT
    l.order_id,
    SUM(l.voucher_qty) FILTER (WHERE l.voucher_qty > 0) AS voucher_qty,
    SUM(l.line_amount) FILTER (WHERE l.voucher_qty > 0) AS voucher_rp
  FROM public.voucher_usage_ledger l
  GROUP BY l.order_id
) v ON v.order_id = r.order_id;

COMMENT ON VIEW public.hq_vw_order_payment_settled_daily IS
  'Order-level payment rows by Midtrans settled date (JKT). Includes pop_* and op_* so daily reconciliation follows Midtrans settlement day, not delivery day.';
