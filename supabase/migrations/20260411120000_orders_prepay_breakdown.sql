-- pre_pay Snap orders: persist catalog total vs QRIS charge vs voucher split for HQ/reporting.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS qris_charged_idr integer
    CHECK (qris_charged_idr IS NULL OR qris_charged_idr >= 0);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prepay_breakdown jsonb;

COMMENT ON COLUMN public.orders.qris_charged_idr IS
  'pre_pay only: Midtrans QRIS amount charged (shortfall after water tickets). Aligns with hq_midtrans_settlements.gross_amount when paid.';

COMMENT ON COLUMN public.orders.prepay_breakdown IS
  'pre_pay only: snapshot at checkout — catalog_total_idr, qris_idr, voucher_splits[], item_cash_units[].';

-- HQ: one row per pop_* order with optional settlement + ledger aggregates
CREATE OR REPLACE VIEW public.hq_vw_prepay_order_payment AS
SELECT
  o.id AS order_id,
  o.customer_id,
  o.branch,
  o.total_amount AS catalog_total_idr,
  o.qris_charged_idr,
  o.prepay_breakdown,
  o.midtrans_order_id,
  o.payment_status,
  o.created_at AS order_created_at,
  h.id AS hq_settlement_id,
  h.gross_amount AS hq_settlement_gross_idr,
  h.midtrans_transaction_id,
  (SELECT COALESCE(SUM(l.line_amount), 0)::bigint
   FROM public.voucher_usage_ledger l WHERE l.order_id = o.id) AS voucher_ledger_line_amount_sum,
  (SELECT COALESCE(SUM(l.voucher_qty) FILTER (WHERE l.pricing_basis = 'gift_zero'), 0)::bigint
   FROM public.voucher_usage_ledger l WHERE l.order_id = o.id) AS voucher_gift_qty_sum,
  (SELECT COALESCE(SUM(l.voucher_qty) FILTER (WHERE l.pricing_basis <> 'gift_zero'), 0)::bigint
   FROM public.voucher_usage_ledger l WHERE l.order_id = o.id) AS voucher_paid_qty_sum
FROM public.orders o
LEFT JOIN public.hq_midtrans_settlements h ON h.midtrans_order_id = o.midtrans_order_id
WHERE o.midtrans_order_id ~ '^pop_';

COMMENT ON VIEW public.hq_vw_prepay_order_payment IS
  'HQ: pre_pay pop_* orders — catalog vs qris_charged_idr vs Midtrans settlement vs voucher_usage_ledger aggregates.';
