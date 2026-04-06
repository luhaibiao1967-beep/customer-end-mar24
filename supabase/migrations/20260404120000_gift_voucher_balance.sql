-- Per-product gift (welcome) voucher balance: subset of balance, cost basis IDR 0.
ALTER TABLE public.customer_product_vouchers
  ADD COLUMN IF NOT EXISTS gift_balance integer NOT NULL DEFAULT 0;

ALTER TABLE public.customer_product_vouchers DROP CONSTRAINT IF EXISTS customer_product_vouchers_gift_lte_balance;
ALTER TABLE public.customer_product_vouchers
  ADD CONSTRAINT customer_product_vouchers_gift_lte_balance
  CHECK (gift_balance >= 0 AND gift_balance <= balance);

COMMENT ON COLUMN public.customer_product_vouchers.gift_balance IS
  'Tickets granted as gifts (e.g. welcome); consumed first when ordering. Cost basis 0.';

-- Backfill: historical rows keep gift_balance = 0 (unknown).

-- Ledger: allow zero line_amount when unit_amount = 0 (gift tickets).
ALTER TABLE public.voucher_usage_ledger DROP CONSTRAINT IF EXISTS voucher_usage_ledger_qty_amount_sign;
ALTER TABLE public.voucher_usage_ledger
  ADD CONSTRAINT voucher_usage_ledger_qty_amount_sign CHECK (line_amount = voucher_qty * unit_amount);

-- Extend pricing_basis for gift rows
ALTER TABLE public.voucher_usage_ledger DROP CONSTRAINT IF EXISTS voucher_usage_ledger_pricing_basis_check;
ALTER TABLE public.voucher_usage_ledger
  ADD CONSTRAINT voucher_usage_ledger_pricing_basis_check CHECK (
    pricing_basis IN (
      'purchase_weighted_avg',
      'package_fallback',
      'zero_unknown',
      'gift_zero'
    )
  );
