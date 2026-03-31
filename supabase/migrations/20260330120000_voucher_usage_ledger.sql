-- Append-only ledger: each row records voucher usage (or reversal) tied to an order line concept.
-- Amounts are integer IDR (same convention as voucher_purchase_requests.amount_paid).
-- order_id is a logical reference to orders.id (no FK) so rows survive if an order row is hard-deleted.

CREATE TABLE IF NOT EXISTS public.voucher_usage_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL,
  customer_id     uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  branch          text NOT NULL,
  product_id      uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  voucher_qty     integer NOT NULL,
  unit_amount     integer NOT NULL CHECK (unit_amount >= 0),
  line_amount     integer NOT NULL,
  pricing_basis   text NOT NULL DEFAULT 'purchase_weighted_avg'
    CHECK (pricing_basis IN (
      'purchase_weighted_avg',
      'package_fallback',
      'zero_unknown'
    )),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_usage_ledger_qty_amount_sign CHECK (
    (voucher_qty > 0 AND line_amount > 0)
    OR (voucher_qty < 0 AND line_amount < 0)
    OR (voucher_qty = 0 AND line_amount = 0)
  )
);

COMMENT ON TABLE public.voucher_usage_ledger IS
  'Water-ticket usage ledger for settlement/reporting. Positive rows = tickets consumed on order; negative = reversal on cancel.';

COMMENT ON COLUMN public.voucher_usage_ledger.order_id IS
  'Logical reference to orders.id (no FK). Join for reporting when order still exists.';

COMMENT ON COLUMN public.voucher_usage_ledger.branch IS
  'Branch at time of write (snapshot for stable reporting).';

COMMENT ON COLUMN public.voucher_usage_ledger.unit_amount IS
  'IDR per ticket at write time (see pricing_basis).';

COMMENT ON COLUMN public.voucher_usage_ledger.line_amount IS
  'voucher_qty * unit_amount at write time (signed).';

CREATE INDEX IF NOT EXISTS idx_voucher_usage_ledger_branch_created
  ON public.voucher_usage_ledger (branch, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_usage_ledger_order
  ON public.voucher_usage_ledger (order_id);

CREATE INDEX IF NOT EXISTS idx_voucher_usage_ledger_customer_created
  ON public.voucher_usage_ledger (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_usage_ledger_product
  ON public.voucher_usage_ledger (product_id);

ALTER TABLE public.voucher_usage_ledger ENABLE ROW LEVEL SECURITY;

-- Inserts/reads from Edge Functions use service role (bypasses RLS).
-- Other apps: use service role or add explicit policies for staff roles.
