-- HQ: join voucher purchase requests with Midtrans settlement row (vpc_*).
-- Requires hq_midtrans_settlements row (webhook or confirm-voucher-payment Status API backfill).

CREATE OR REPLACE VIEW public.hq_vw_voucher_purchase_detail AS
SELECT
  r.id                    AS purchase_request_id,
  r.customer_id,
  r.product_id,
  r.qty                   AS voucher_qty_purchased,
  r.amount_paid           AS request_amount_paid_idr,
  r.status                AS request_status,
  r.midtrans_order_id,
  r.created_at            AS request_created_at,
  h.id                    AS settlement_id,
  h.midtrans_transaction_id,
  h.gross_amount          AS midtrans_gross_idr,
  h.payment_type,
  h.transaction_status,
  h.settled_at            AS midtrans_settled_at,
  h.created_at            AS settlement_recorded_at,
  (h.raw_notification IS NOT NULL) AS has_settlement_payload,
  c.branch                AS customer_branch_at_purchase
FROM public.voucher_purchase_requests r
LEFT JOIN public.hq_midtrans_settlements h
  ON h.midtrans_order_id = r.midtrans_order_id
  AND h.source_type = 'voucher_purchase'
LEFT JOIN public.customers c ON c.id = r.customer_id;

COMMENT ON VIEW public.hq_vw_voucher_purchase_detail IS
  'HQ: water-ticket purchase (vpc_*) with optional Midtrans row from hq_midtrans_settlements. settlement_id null if payment not yet recorded.';
