-- HQ: explode one Midtrans op_* batch payment into one row per order (same midtrans_order_id on each order).
-- Use for allocating cash to branches: SUM(order_amount_idr) per branch should reconcile to settlement midtrans_gross_idr.

CREATE OR REPLACE VIEW public.hq_vw_later_pay_midtrans_per_order AS
SELECT
  h.id                    AS settlement_id,
  h.midtrans_order_id,
  h.midtrans_transaction_id,
  h.gross_amount          AS midtrans_gross_idr,
  h.settled_at,
  h.created_at            AS settlement_created_at,
  h.customer_id         AS settlement_customer_id,
  o.id                    AS order_id,
  o.branch                AS order_branch,
  o.total_amount          AS order_amount_idr,
  o.payment_status,
  o.delivery_date,
  o.status                AS order_status
FROM public.hq_midtrans_settlements h
INNER JOIN public.orders o
  ON o.midtrans_order_id = h.midtrans_order_id
  AND h.source_type = 'later_pay_orders'
WHERE o.payment_status = 'paid';

COMMENT ON VIEW public.hq_vw_later_pay_midtrans_per_order IS
  'One row per order in a later_pay batch QRIS (op_*). Joins settlement to orders via orders.midtrans_order_id for HQ → branch allocation.';
