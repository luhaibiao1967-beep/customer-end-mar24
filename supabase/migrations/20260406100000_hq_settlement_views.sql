-- Read-only views for HQ apps: branch settlement from voucher ledger + Midtrans cash-in.
-- Data is populated by Edge Functions (submit-order, submit-prepay-order, midtrans-webhook); views do not duplicate writes.

CREATE OR REPLACE VIEW public.hq_vw_order_voucher_settlement AS
SELECT
  l.id                    AS ledger_id,
  l.order_id,
  o.branch,
  o.status                AS order_status,
  o.delivery_date,
  o.customer_id,
  l.product_id,
  p.name                  AS product_name,
  l.voucher_qty,
  l.unit_amount,
  l.line_amount,
  l.pricing_basis,
  l.created_at            AS ledger_created_at,
  o.total_amount          AS order_total_amount,
  o.payment_status        AS order_payment_status,
  o.midtrans_order_id     AS order_midtrans_order_id
FROM public.voucher_usage_ledger l
INNER JOIN public.orders o ON o.id = l.order_id
LEFT JOIN public.products p ON p.id = l.product_id;

COMMENT ON VIEW public.hq_vw_order_voucher_settlement IS
  'HQ: per-ledger-line voucher consumption tied to orders. Negative voucher_qty = cancel reversal. line_amount = voucher_qty * unit_amount (IDR).';

CREATE OR REPLACE VIEW public.hq_vw_order_midtrans_cash AS
SELECT
  h.id,
  h.midtrans_order_id,
  h.midtrans_transaction_id,
  h.gross_amount,
  h.source_type,
  h.customer_id,
  h.branch,
  h.order_id,
  h.voucher_purchase_request_id,
  h.metadata,
  h.settled_at,
  h.created_at,
  o.status       AS order_status,
  o.delivery_date,
  o.payment_status
FROM public.hq_midtrans_settlements h
LEFT JOIN public.orders o ON o.id = h.order_id
  OR (h.order_id IS NULL AND o.midtrans_order_id = h.midtrans_order_id);

COMMENT ON VIEW public.hq_vw_order_midtrans_cash IS
  'HQ: Midtrans cash-in rows; join orders when order_id or midtrans_order_id matches. vpc_ rows may have order_id null.';
