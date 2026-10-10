-- Cancel a customer-owned pending order as one database transaction.
-- The order is retained as inactive so voucher and settlement audit rows keep
-- a stable reference to it.
--
-- Safe automatic cancellation is intentionally limited to:
--   * pre_pay orders paid entirely with vouchers; and
--   * unpaid later_pay orders.
-- Orders with a Midtrans/QRIS cash component require a separate financial
-- refund workflow and are rejected here.

CREATE OR REPLACE FUNCTION public.cancel_customer_pending_order(
  p_customer_id uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_customer_type text;
  v_net_voucher_qty integer := 0;
  v_refunded_voucher_qty integer := 0;
BEGIN
  SELECT *
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
    AND customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status <> 'pending' THEN
    RAISE EXCEPTION 'ONLY_PENDING_ORDERS_CAN_BE_CANCELLED';
  END IF;

  IF v_order.is_active IS FALSE THEN
    RAISE EXCEPTION 'ORDER_IS_INACTIVE';
  END IF;

  SELECT customer_type
  INTO v_customer_type
  FROM public.customers
  WHERE id = p_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  -- Never silently reverse a real cash settlement. That needs a Midtrans
  -- refund plus reconciliation, not only a database delete.
  IF COALESCE(v_order.qris_charged_idr, 0) > 0
     OR v_order.midtrans_order_id IS NOT NULL
     OR (v_customer_type <> 'pre_pay' AND v_order.payment_status = 'paid') THEN
    RAISE EXCEPTION 'PAYMENT_REFUND_REQUIRED';
  END IF;

  IF v_customer_type = 'pre_pay' THEN
    SELECT COALESCE(SUM(voucher_qty), 0)::integer
    INTO v_net_voucher_qty
    FROM public.voucher_usage_ledger
    WHERE order_id = p_order_id
      AND customer_id = p_customer_id;

    -- A paid pre-pay order without a positive voucher ledger cannot be
    -- reconstructed safely, so fail before changing any data.
    IF v_net_voucher_qty <= 0 THEN
      RAISE EXCEPTION 'VOUCHER_USAGE_NOT_FOUND';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (
        SELECT
          product_id,
          SUM(voucher_qty)::integer AS total_qty,
          COALESCE(SUM(voucher_qty) FILTER (WHERE pricing_basis = 'gift_zero'), 0)::integer AS gift_qty
        FROM public.voucher_usage_ledger
        WHERE order_id = p_order_id
          AND customer_id = p_customer_id
        GROUP BY product_id
      ) net
      WHERE net.total_qty <= 0
         OR net.gift_qty < 0
         OR net.gift_qty > net.total_qty
    ) THEN
      RAISE EXCEPTION 'INVALID_VOUCHER_LEDGER_STATE';
    END IF;

    WITH net_by_product AS (
      SELECT
        product_id,
        SUM(voucher_qty)::integer AS total_qty,
        COALESCE(SUM(voucher_qty) FILTER (WHERE pricing_basis = 'gift_zero'), 0)::integer AS gift_qty
      FROM public.voucher_usage_ledger
      WHERE order_id = p_order_id
        AND customer_id = p_customer_id
      GROUP BY product_id
      HAVING SUM(voucher_qty) > 0
    )
    INSERT INTO public.customer_product_vouchers (
      customer_id,
      product_id,
      balance,
      gift_balance
    )
    SELECT
      p_customer_id,
      product_id,
      total_qty,
      gift_qty
    FROM net_by_product
    ON CONFLICT (customer_id, product_id) DO UPDATE
    SET
      balance = public.customer_product_vouchers.balance + EXCLUDED.balance,
      gift_balance = public.customer_product_vouchers.gift_balance + EXCLUDED.gift_balance;

    -- Append signed reversal rows so finance reports keep an audit trail.
    -- The SELECT snapshot does not include rows inserted by this statement.
    INSERT INTO public.voucher_usage_ledger (
      order_id,
      customer_id,
      branch,
      product_id,
      voucher_qty,
      unit_amount,
      line_amount,
      pricing_basis
    )
    SELECT
      p_order_id,
      p_customer_id,
      branch,
      product_id,
      -SUM(voucher_qty)::integer,
      unit_amount,
      -SUM(line_amount)::integer,
      pricing_basis
    FROM public.voucher_usage_ledger
    WHERE order_id = p_order_id
      AND customer_id = p_customer_id
    GROUP BY branch, product_id, unit_amount, pricing_basis
    HAVING SUM(voucher_qty) > 0;

    v_refunded_voucher_qty := v_net_voucher_qty;
  END IF;

  -- Preserve the order and its related rows for audit/reconciliation. Some
  -- deployed databases also enforce an order_id foreign key from the voucher
  -- ledger, so hard deletion is both undesirable and not portable.
  UPDATE public.orders
  SET
    is_active = false,
    updated_at = now()
  WHERE id = p_order_id
    AND customer_id = p_customer_id
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_DEACTIVATION_FAILED';
  END IF;

  RETURN jsonb_build_object(
    'cancelled', true,
    'order_id', p_order_id,
    'refunded_voucher_qty', v_refunded_voucher_qty
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) IS
  'Atomically cancels a pending customer order by marking it inactive. Voucher-only pre_pay orders restore balances and append ledger reversals; cash-settled orders are rejected.';
