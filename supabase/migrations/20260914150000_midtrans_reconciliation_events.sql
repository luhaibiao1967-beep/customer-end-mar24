-- Persist payment reversals and other cash events that require manual review.
-- These events are intentionally not applied to voucher/order balances here:
-- a refund can arrive after vouchers were partly consumed or goods delivered.

CREATE TABLE IF NOT EXISTS public.midtrans_reconciliation_events (
  event_key text PRIMARY KEY,
  midtrans_order_id text NOT NULL,
  midtrans_transaction_id text,
  transaction_status text NOT NULL,
  source_type text NOT NULL,
  gross_amount integer,
  local_reference_id uuid,
  review_status text NOT NULL DEFAULT 'requires_manual_review',
  raw_notification jsonb NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_note text,
  CONSTRAINT midtrans_reconciliation_event_key_check CHECK (
    event_key ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT midtrans_reconciliation_source_check CHECK (
    source_type IN ('voucher_purchase', 'prepay_order_qris', 'later_pay_orders')
  ),
  CONSTRAINT midtrans_reconciliation_status_check CHECK (
    transaction_status IN (
      'refund',
      'partial_refund',
      'chargeback',
      'partial_chargeback'
    )
  ),
  CONSTRAINT midtrans_reconciliation_review_check CHECK (
    review_status IN ('requires_manual_review', 'in_review', 'resolved', 'ignored')
  ),
  CONSTRAINT midtrans_reconciliation_amount_check CHECK (
    gross_amount IS NULL OR gross_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS midtrans_reconciliation_events_order_idx
  ON public.midtrans_reconciliation_events (midtrans_order_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS midtrans_reconciliation_events_open_idx
  ON public.midtrans_reconciliation_events (review_status, detected_at DESC)
  WHERE review_status IN ('requires_manual_review', 'in_review');

ALTER TABLE public.midtrans_reconciliation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.midtrans_reconciliation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.midtrans_reconciliation_events FROM anon;
REVOKE ALL ON TABLE public.midtrans_reconciliation_events FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.midtrans_reconciliation_events TO service_role;

COMMENT ON TABLE public.midtrans_reconciliation_events IS
  'Idempotent Midtrans refund/chargeback evidence awaiting explicit finance reconciliation.';
