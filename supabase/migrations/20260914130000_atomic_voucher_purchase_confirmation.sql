-- Confirm a paid voucher purchase, credit its balance, and record HQ settlement
-- in one database transaction. Only the service role may call this after
-- verifying the payment with Midtrans.

-- Both confirmation paths resolve a purchase by one Midtrans id and require
-- at most one row. If legacy duplicates exist this migration fails closed so
-- they can be reconciled explicitly instead of crediting an arbitrary row.
CREATE UNIQUE INDEX IF NOT EXISTS voucher_purchase_requests_midtrans_order_id_key
  ON public.voucher_purchase_requests (midtrans_order_id)
  WHERE midtrans_order_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.confirm_paid_voucher_purchase(uuid, uuid);

CREATE OR REPLACE FUNCTION public.confirm_paid_voucher_purchase(
  p_request_id uuid,
  p_customer_id uuid,
  p_midtrans_order_id text,
  p_midtrans_transaction_id text,
  p_gross_amount integer,
  p_transaction_status text,
  p_fraud_status text,
  p_payment_type text,
  p_raw_notification jsonb,
  p_settled_at timestamptz,
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.voucher_purchase_requests%ROWTYPE;
  v_already_confirmed boolean;
BEGIN
  SELECT r.*
    INTO v_request
  FROM public.voucher_purchase_requests AS r
  WHERE r.id = p_request_id
    AND r.customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PURCHASE_REQUEST_NOT_FOUND';
  END IF;

  IF v_request.midtrans_order_id IS NULL
     OR left(v_request.midtrans_order_id, 4) <> 'vpc_'
     OR v_request.midtrans_order_id <> p_midtrans_order_id THEN
    RAISE EXCEPTION 'PURCHASE_PAYMENT_REFERENCE_INVALID';
  END IF;

  IF v_request.amount_paid IS NULL
     OR v_request.amount_paid <= 0
     OR v_request.amount_paid <> p_gross_amount THEN
    RAISE EXCEPTION 'PURCHASE_AMOUNT_INVALID';
  END IF;

  IF NOT (
    p_transaction_status = 'settlement'
    OR (p_transaction_status = 'capture' AND p_fraud_status = 'accept')
  ) THEN
    RAISE EXCEPTION 'PURCHASE_PAYMENT_NOT_SETTLED';
  END IF;

  v_already_confirmed := v_request.status = 'confirmed';

  IF NOT v_already_confirmed THEN
    IF v_request.status <> 'pending' THEN
      RAISE EXCEPTION 'PURCHASE_REQUEST_NOT_PAYABLE';
    END IF;

    IF v_request.qty IS NULL OR v_request.qty <= 0 THEN
      RAISE EXCEPTION 'PURCHASE_QUANTITY_INVALID';
    END IF;

    INSERT INTO public.customer_product_vouchers AS cpv (
      customer_id,
      product_id,
      balance,
      gift_balance
    )
    VALUES (
      v_request.customer_id,
      v_request.product_id,
      v_request.qty,
      0
    )
    ON CONFLICT (customer_id, product_id)
    DO UPDATE SET
      balance = cpv.balance + EXCLUDED.balance;

    UPDATE public.voucher_purchase_requests AS r
    SET
      status = 'confirmed',
      updated_at = now()
    WHERE r.id = v_request.id;
  END IF;

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
    p_midtrans_order_id,
    p_midtrans_transaction_id,
    p_gross_amount,
    p_transaction_status,
    p_payment_type,
    'voucher_purchase',
    v_request.customer_id,
    c.branch,
    NULL,
    v_request.id,
    COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_raw_notification, '{}'::jsonb),
    COALESCE(p_settled_at, now())
  FROM public.customers AS c
  WHERE c.id = v_request.customer_id
  ON CONFLICT (midtrans_order_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.hq_midtrans_settlements AS h
    WHERE h.midtrans_order_id = p_midtrans_order_id
      AND h.voucher_purchase_request_id = v_request.id
      AND h.customer_id = v_request.customer_id
      AND h.gross_amount = p_gross_amount
      AND h.source_type = 'voucher_purchase'
  ) THEN
    RAISE EXCEPTION 'HQ_SETTLEMENT_CONFLICT';
  END IF;

  RETURN jsonb_build_object(
    'confirmed', true,
    'already_confirmed', v_already_confirmed,
    'request_id', v_request.id,
    'credited_quantity', CASE WHEN v_already_confirmed THEN 0 ELSE v_request.qty END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_paid_voucher_purchase(uuid, uuid, text, text, integer, text, text, text, jsonb, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.confirm_paid_voucher_purchase(uuid, uuid, text, text, integer, text, text, text, jsonb, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.confirm_paid_voucher_purchase(uuid, uuid, text, text, integer, text, text, text, jsonb, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_voucher_purchase(uuid, uuid, text, text, integer, text, text, text, jsonb, timestamptz, jsonb) TO service_role;

COMMENT ON FUNCTION public.confirm_paid_voucher_purchase(uuid, uuid, text, text, integer, text, text, text, jsonb, timestamptz, jsonb) IS
  'Atomically confirms a Midtrans-verified voucher purchase, credits its paid voucher balance exactly once, and records HQ settlement.';
