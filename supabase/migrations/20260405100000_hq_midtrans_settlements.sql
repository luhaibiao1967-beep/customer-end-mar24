-- HQ reconciliation: persist Midtrans success amount + branch snapshot when webhook fires.
-- Service role (Edge Functions) inserts; RLS enabled with no broad policies — use service role in HQ backend.

CREATE TABLE IF NOT EXISTS public.hq_midtrans_settlements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  midtrans_order_id           text NOT NULL,
  midtrans_transaction_id     text,
  gross_amount                integer NOT NULL CHECK (gross_amount >= 0),
  currency                    text NOT NULL DEFAULT 'IDR',
  transaction_status          text,
  payment_type                text,
  source_type                 text NOT NULL
    CHECK (source_type IN ('prepay_order_qris', 'voucher_purchase', 'later_pay_orders')),
  customer_id                 uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  branch                      text,
  order_id                    uuid,
  voucher_purchase_request_id uuid REFERENCES public.voucher_purchase_requests(id) ON DELETE SET NULL,
  metadata                    jsonb,
  raw_notification            jsonb,
  settled_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hq_midtrans_settlements_midtrans_order_id_key UNIQUE (midtrans_order_id)
);

COMMENT ON TABLE public.hq_midtrans_settlements IS
  'One row per successful Midtrans payment (merchant order_id). Used by HQ to reconcile QRIS cash-in and allocate to branches.';

COMMENT ON COLUMN public.hq_midtrans_settlements.source_type IS
  'prepay_order_qris: pop_* Snap payment for pre_pay order shortfall; voucher_purchase: vpc_*; later_pay_orders: op_* batch.';

COMMENT ON COLUMN public.hq_midtrans_settlements.metadata IS
  'Extra context, e.g. later_pay_orders: list of order ids and per-order amounts for multi-order payments.';

CREATE INDEX IF NOT EXISTS idx_hq_midtrans_settlements_branch_created
  ON public.hq_midtrans_settlements (branch, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hq_midtrans_settlements_customer_created
  ON public.hq_midtrans_settlements (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hq_midtrans_settlements_order_id
  ON public.hq_midtrans_settlements (order_id)
  WHERE order_id IS NOT NULL;

ALTER TABLE public.hq_midtrans_settlements ENABLE ROW LEVEL SECURITY;
