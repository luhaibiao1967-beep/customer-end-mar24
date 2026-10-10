-- Atomically create or edit customer-portal later-pay orders.
--
-- The Edge Function authenticates the opaque customer token, then calls this
-- service-role-only function once.  All mutable commercial state is re-read
-- under database locks; client prices, discounts, totals and payment status
-- are deliberately not trusted, and later-pay voucher splits fail closed.

BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS later_pay_order_key uuid,
  ADD COLUMN IF NOT EXISTS later_pay_order_request_hash text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_later_pay_order_identity_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_later_pay_order_identity_check CHECK (
    (
      later_pay_order_key IS NULL
      AND later_pay_order_request_hash IS NULL
    )
    OR (
      later_pay_order_key IS NOT NULL
      AND later_pay_order_request_hash IS NOT NULL
      AND later_pay_order_request_hash ~ '^[0-9a-f]{32}$'
      AND prepay_checkout_key IS NULL
      AND voucher_order_key IS NULL
    )
  ) NOT VALID;
ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_later_pay_order_identity_check;

CREATE UNIQUE INDEX IF NOT EXISTS orders_later_pay_order_key_key
  ON public.orders (later_pay_order_key)
  WHERE later_pay_order_key IS NOT NULL;

-- The shared cancellation primitive previously restored vouchers only for
-- pre-pay customers. Later-pay orders may also consume product vouchers, so
-- refund any positive signed-ledger balance regardless of customer type.
CREATE OR REPLACE FUNCTION public.cancel_customer_pending_order(
  p_customer_id uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_customer_type text;
  v_net_voucher_qty integer := 0;
  v_total_order_qty integer := 0;
  v_refunded_voucher_qty integer := 0;
BEGIN
  IF p_customer_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_IDENTITY_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Existing-order workflows consistently lock order then customer. Creates
  -- lock only the customer before the order exists, so this ordering cannot
  -- form a cycle with a simultaneous portal create.
  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.customer_id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'ONLY_PENDING_ORDERS_CAN_BE_CANCELLED';
  END IF;
  IF v_order.is_active IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'cancelled', true,
      'already_cancelled', true,
      'order_id', p_order_id,
      'refunded_voucher_qty', 0
    );
  END IF;

  SELECT c.customer_type::text
    INTO v_customer_type
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  SELECT COALESCE(SUM(l.voucher_qty), 0)::integer
    INTO v_net_voucher_qty
  FROM public.voucher_usage_ledger AS l
  WHERE l.order_id = p_order_id
    AND l.customer_id = p_customer_id;

  SELECT COALESCE(SUM(oi.quantity), 0)::integer
    INTO v_total_order_qty
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id;

  IF EXISTS (
    SELECT 1
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
      AND oi.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'INVALID_ORDER_ITEM_STATE';
  END IF;

  -- A provider-tagged payment always needs external refund/reconciliation.
  -- A positive-value paid pending order is safe only when positive net
  -- voucher usage covers every ordered unit; a partially voucher-funded
  -- cash-paid order still needs a real money refund. A zero-value catalog
  -- order has no money to refund even though it is recorded as paid.
  IF COALESCE(v_order.qris_charged_idr, 0) > 0
     OR v_order.midtrans_order_id IS NOT NULL
     OR (
       v_order.payment_status = 'paid'
       AND COALESCE(v_order.total_amount, 0) > 0
       AND (
         v_net_voucher_qty <= 0
         OR v_total_order_qty <= 0
         OR v_net_voucher_qty <> v_total_order_qty
       )
     ) THEN
    RAISE EXCEPTION 'PAYMENT_REFUND_REQUIRED';
  END IF;
  IF v_customer_type = 'pre_pay' AND v_net_voucher_qty <= 0 THEN
    RAISE EXCEPTION 'VOUCHER_USAGE_NOT_FOUND';
  END IF;
  IF v_net_voucher_qty < 0 THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_LEDGER_STATE';
  END IF;

  IF v_net_voucher_qty > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM (
        SELECT
          l.product_id,
          SUM(l.voucher_qty)::integer AS total_qty,
          COALESCE(SUM(l.voucher_qty) FILTER (
            WHERE l.pricing_basis = 'gift_zero'
          ), 0)::integer AS gift_qty
        FROM public.voucher_usage_ledger AS l
        WHERE l.order_id = p_order_id
          AND l.customer_id = p_customer_id
        GROUP BY l.product_id
      ) AS net
      WHERE net.total_qty <= 0
         OR net.gift_qty < 0
         OR net.gift_qty > net.total_qty
    ) THEN
      RAISE EXCEPTION 'INVALID_VOUCHER_LEDGER_STATE';
    END IF;

    WITH net_by_product AS (
      SELECT
        l.product_id,
        SUM(l.voucher_qty)::integer AS total_qty,
        COALESCE(SUM(l.voucher_qty) FILTER (
          WHERE l.pricing_basis = 'gift_zero'
        ), 0)::integer AS gift_qty
      FROM public.voucher_usage_ledger AS l
      WHERE l.order_id = p_order_id
        AND l.customer_id = p_customer_id
      GROUP BY l.product_id
      HAVING SUM(l.voucher_qty) > 0
    )
    INSERT INTO public.customer_product_vouchers AS cpv (
      customer_id, product_id, balance, gift_balance, updated_at
    )
    SELECT
      p_customer_id, net.product_id, net.total_qty, net.gift_qty, now()
    FROM net_by_product AS net
    ON CONFLICT (customer_id, product_id) DO UPDATE
    SET
      balance = cpv.balance + EXCLUDED.balance,
      gift_balance = cpv.gift_balance + EXCLUDED.gift_balance,
      updated_at = now();

    -- Append signed reversal rows so the original valuation remains auditable.
    INSERT INTO public.voucher_usage_ledger (
      order_id, customer_id, branch, product_id,
      voucher_qty, unit_amount, line_amount, pricing_basis
    )
    SELECT
      p_order_id,
      p_customer_id,
      l.branch,
      l.product_id,
      -SUM(l.voucher_qty)::integer,
      l.unit_amount,
      -SUM(l.line_amount)::integer,
      l.pricing_basis
    FROM public.voucher_usage_ledger AS l
    WHERE l.order_id = p_order_id
      AND l.customer_id = p_customer_id
    GROUP BY l.branch, l.product_id, l.unit_amount, l.pricing_basis
    HAVING SUM(l.voucher_qty) > 0;

    v_refunded_voucher_qty := v_net_voucher_qty;
  END IF;

  UPDATE public.orders
  SET
    is_active = false,
    inactivated_at = now(),
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
$function$;

ALTER FUNCTION public.cancel_customer_pending_order(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_customer_pending_order(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_customer_pending_order(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) IS
  'Atomically soft-cancels a pending customer order, restores any positive net product-voucher ledger balance with signed reversals, and rejects provider/cash-settled orders.';

CREATE OR REPLACE FUNCTION public.submit_customer_later_pay_order(
  p_customer_id uuid,
  p_order_key uuid,
  p_edit_order_id uuid,
  p_delivery_date date,
  p_note text,
  p_items jsonb,
  p_product_deductions jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_existing public.orders%ROWTYPE;
  v_order_id uuid;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_item_totals jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_element jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_total_amount numeric := 0;
  v_unpaid_total numeric := 0;
  v_request_hash text;
  v_min_delivery_date date;
  v_jakarta_now timestamp;
  v_closed_weekdays integer[] := '{}'::integer[];
  v_guard integer := 0;
  v_has_voucher_usage boolean;
  v_service_branch_name text;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_ORDER_IDENTITY_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF (p_order_key IS NULL) = (p_edit_order_id IS NULL) THEN
    RAISE EXCEPTION 'LATER_PAY_CREATE_OR_EDIT_IDENTITY_REQUIRED'
      USING ERRCODE = '22023';
  END IF;
  IF p_delivery_date IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT isfinite(p_delivery_date) THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_DATE' USING ERRCODE = '22023';
  END IF;

  v_note := NULLIF(btrim(p_note), '');
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'ORDER_NOTE_TOO_LONG' USING ERRCODE = '22023';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'INVALID_ORDER_ITEMS' USING ERRCODE = '22023';
  END IF;
  IF p_product_deductions IS NULL
     OR jsonb_typeof(p_product_deductions) <> 'array'
     OR jsonb_array_length(p_product_deductions) > 100 THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTIONS' USING ERRCODE = '22023';
  END IF;

  -- Reject malformed primitives before any cast can expose implementation
  -- errors or accept lossy numeric conversions.
  FOR v_element IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_element) <> 'object'
       OR (v_element - ARRAY[
         'product_id', 'product', 'is_refill', 'quantity',
         'unit_price', 'discount'
       ]::text[]) <> '{}'::jsonb
       OR NOT (v_element ?& ARRAY[
         'product_id', 'product', 'is_refill', 'quantity',
         'unit_price', 'discount'
       ]::text[])
       OR jsonb_typeof(v_element -> 'product_id') <> 'string'
       OR (v_element ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_element -> 'product') <> 'string'
       OR btrim(v_element ->> 'product') = ''
       OR jsonb_typeof(v_element -> 'is_refill') <> 'boolean'
       OR jsonb_typeof(v_element -> 'quantity') <> 'number'
       OR jsonb_typeof(v_element -> 'unit_price') <> 'number'
       OR jsonb_typeof(v_element -> 'discount') <> 'number' THEN
      RAISE EXCEPTION 'INVALID_ORDER_ITEM' USING ERRCODE = '22023';
    END IF;

    v_quantity := (v_element ->> 'quantity')::numeric;
    v_unit_price := (v_element ->> 'unit_price')::numeric;
    v_discount := (v_element ->> 'discount')::numeric;
    IF v_quantity <> trunc(v_quantity)
       OR v_quantity <= 0
       OR v_quantity > 2147483647
       OR v_unit_price <> trunc(v_unit_price)
       OR v_unit_price < 0
       OR v_unit_price > 2147483647
       OR v_discount <> trunc(v_discount)
       OR v_discount < 0
       OR v_discount > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_ORDER_ITEM' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  FOR v_element IN SELECT value FROM jsonb_array_elements(p_product_deductions)
  LOOP
    IF jsonb_typeof(v_element) <> 'object'
       OR (v_element - ARRAY['product_id', 'quantity']::text[]) <> '{}'::jsonb
       OR NOT (v_element ?& ARRAY['product_id', 'quantity']::text[])
       OR jsonb_typeof(v_element -> 'product_id') <> 'string'
       OR (v_element ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_element -> 'quantity') <> 'number' THEN
      RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTION' USING ERRCODE = '22023';
    END IF;

    v_quantity := (v_element ->> 'quantity')::numeric;
    IF v_quantity <> trunc(v_quantity)
       OR v_quantity <= 0
       OR v_quantity > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTION' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT SUM((e.value ->> 'quantity')::numeric) AS quantity
      FROM jsonb_array_elements(p_items) AS e(value)
      GROUP BY (e.value ->> 'product_id')::uuid
    ) AS totals
    WHERE totals.quantity > 2147483647
  ) THEN
    RAISE EXCEPTION 'INVALID_ORDER_QUANTITY' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT SUM((e.value ->> 'quantity')::numeric) AS quantity
      FROM jsonb_array_elements(p_product_deductions) AS e(value)
      GROUP BY (e.value ->> 'product_id')::uuid
    ) AS totals
    WHERE totals.quantity > 2147483647
  ) THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTION' USING ERRCODE = '22023';
  END IF;

  -- Canonical forms make retries independent of JSON array order and merge
  -- duplicate client rows without trusting client-computed totals.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'product', normalized.product,
        'is_refill', normalized.is_refill,
        'quantity', normalized.quantity,
        'unit_price', normalized.unit_price,
        'discount', normalized.discount
      )
      ORDER BY normalized.product_id::text, normalized.unit_price,
               normalized.discount, normalized.product, normalized.is_refill
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT
      (e.value ->> 'product_id')::uuid AS product_id,
      e.value ->> 'product' AS product,
      (e.value ->> 'is_refill')::boolean AS is_refill,
      SUM((e.value ->> 'quantity')::numeric)::integer AS quantity,
      (e.value ->> 'unit_price')::integer AS unit_price,
      (e.value ->> 'discount')::integer AS discount
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY
      (e.value ->> 'product_id')::uuid,
      e.value ->> 'product',
      (e.value ->> 'is_refill')::boolean,
      (e.value ->> 'unit_price')::integer,
      (e.value ->> 'discount')::integer
  ) AS normalized;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'quantity', normalized.quantity
      ) ORDER BY normalized.product_id::text
    ),
    '[]'::jsonb
  )
  INTO v_item_totals
  FROM (
    SELECT
      i.product_id,
      SUM(i.quantity)::integer AS quantity
    FROM jsonb_to_recordset(v_items) AS i(
      product_id uuid, product text, is_refill boolean,
      quantity integer, unit_price integer, discount integer
    )
    GROUP BY i.product_id
  ) AS normalized;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'quantity', normalized.quantity
      ) ORDER BY normalized.product_id::text
    ),
    '[]'::jsonb
  )
  INTO v_deductions
  FROM (
    SELECT
      (e.value ->> 'product_id')::uuid AS product_id,
      SUM((e.value ->> 'quantity')::numeric)::integer AS quantity
    FROM jsonb_array_elements(p_product_deductions) AS e(value)
    GROUP BY (e.value ->> 'product_id')::uuid
  ) AS normalized;

  v_request_hash := md5(
    jsonb_build_object(
      'customer_id', p_customer_id,
      'delivery_date', p_delivery_date,
      'note', v_note,
      'items', v_items,
      'product_deductions', v_deductions
    )::text
  );

  IF p_order_key IS NOT NULL THEN
    -- Serialize same-key retries before probing the unique identity row.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('customer-later-pay:' || p_order_key::text, 0)
    );

    SELECT o.*
      INTO v_existing
    FROM public.orders AS o
    WHERE o.later_pay_order_key = p_order_key
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing.customer_id <> p_customer_id
         OR v_existing.later_pay_order_request_hash
              IS DISTINCT FROM v_request_hash THEN
        RAISE EXCEPTION 'LATER_PAY_ORDER_KEY_CONFLICT'
          USING ERRCODE = '23505';
      END IF;
      IF v_existing.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'LATER_PAY_ORDER_ALREADY_INACTIVE'
          USING ERRCODE = '55000';
      END IF;

      RETURN jsonb_build_object(
        'created', false,
        'already_created', true,
        'order_id', v_existing.id,
        'total_amount', v_existing.total_amount,
        'payment_status', v_existing.payment_status,
        'is_active', v_existing.is_active
      );
    END IF;
  END IF;

  -- Staff order workflows lock the order before touching customer-derived
  -- balances. Keep the same order here so a simultaneous delivery/correction
  -- cannot form a customer/order lock inversion.
  IF p_edit_order_id IS NOT NULL THEN
    SELECT o.*
      INTO v_existing
    FROM public.orders AS o
    WHERE o.id = p_edit_order_id
      AND o.customer_id = p_customer_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_existing.status IS DISTINCT FROM 'pending'
       OR v_existing.is_active IS DISTINCT FROM true
       OR v_existing.payment_status IS DISTINCT FROM 'unpaid'
       OR v_existing.prepay_checkout_key IS NOT NULL
       OR v_existing.midtrans_order_id IS NOT NULL
       OR COALESCE(v_existing.qris_charged_idr, 0) > 0 THEN
      RAISE EXCEPTION 'ORDER_NOT_EDITABLE' USING ERRCODE = '55000';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.voucher_usage_ledger AS l
      WHERE l.order_id = p_edit_order_id
        AND l.voucher_qty > 0
    ) INTO v_has_voucher_usage;

    IF jsonb_array_length(v_deductions) > 0 OR v_has_voucher_usage THEN
      RAISE EXCEPTION 'VOUCHER_ORDER_EDIT_NOT_SUPPORTED'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- One customer-row lock serializes all portal creates/edits for credit,
  -- overdue, snapshot and voucher decisions.
  SELECT c.*
    INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_customer.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CUSTOMER_IS_INACTIVE' USING ERRCODE = '42501';
  END IF;
  IF v_customer.customer_type::text IS DISTINCT FROM 'later_pay' THEN
    RAISE EXCEPTION 'CUSTOMER_IS_NOT_LATER_PAY' USING ERRCODE = '42501';
  END IF;
  IF v_customer.name IS NULL
     OR v_customer.address IS NULL
     OR v_customer.whatsapp IS NULL
     OR (
       p_edit_order_id IS NULL
       AND (v_customer.branch IS NULL OR btrim(v_customer.branch) = '')
     ) THEN
    RAISE EXCEPTION 'CUSTOMER_PROFILE_INCOMPLETE' USING ERRCODE = '22023';
  END IF;
  IF v_customer.discount IS NULL
     OR v_customer.discount < 0
     OR v_customer.discount > 15000 THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_DISCOUNT' USING ERRCODE = '22023';
  END IF;

  -- An edit keeps the order's original fulfilment branch. A later customer
  -- profile move must not silently validate one branch's calendar while
  -- leaving another branch on the order snapshot.
  v_service_branch_name := CASE
    WHEN p_edit_order_id IS NOT NULL THEN v_existing.branch
    ELSE v_customer.branch
  END;
  IF v_service_branch_name IS NULL OR btrim(v_service_branch_name) = '' THEN
    RAISE EXCEPTION 'CUSTOMER_PROFILE_INCOMPLETE' USING ERRCODE = '22023';
  END IF;

  SELECT b.*
    INTO v_branch
  FROM public.branches AS b
  WHERE b.name = v_service_branch_name
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_BRANCH_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_branch.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'SERVICE_BRANCH_INACTIVE' USING ERRCODE = '42501';
  END IF;

  v_closed_weekdays := COALESCE(v_branch.closed_weekdays, '{}'::integer[]);
  v_jakarta_now := clock_timestamp() AT TIME ZONE 'Asia/Jakarta';
  v_min_delivery_date := v_jakarta_now::date;
  IF EXTRACT(HOUR FROM v_jakarta_now)::integer
       >= COALESCE(v_branch.order_cutoff_hour, 16) THEN
    v_min_delivery_date := v_min_delivery_date + 1;
  END IF;

  WHILE EXTRACT(DOW FROM v_min_delivery_date)::integer
          = ANY (v_closed_weekdays)
  LOOP
    v_min_delivery_date := v_min_delivery_date + 1;
    v_guard := v_guard + 1;
    IF v_guard > 14 THEN
      RAISE EXCEPTION 'DELIVERY_SCHEDULE_INVALID' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF p_delivery_date < v_min_delivery_date THEN
    RAISE EXCEPTION 'DELIVERY_DATE_TOO_SOON' USING ERRCODE = '22023';
  END IF;
  IF EXTRACT(DOW FROM p_delivery_date)::integer
       = ANY (v_closed_weekdays) THEN
    RAISE EXCEPTION 'DELIVERY_DATE_BRANCH_CLOSED' USING ERRCODE = '22023';
  END IF;

  -- Later-pay QRIS settlement currently charges orders.total_amount. Until a
  -- distinct cash-due amount is propagated through both payment functions,
  -- accepting voucher-covered units here would charge them a second time.
  IF jsonb_array_length(v_deductions) > 0 THEN
    IF p_edit_order_id IS NOT NULL THEN
      RAISE EXCEPTION 'VOUCHER_ORDER_EDIT_NOT_SUPPORTED'
        USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'LATER_PAY_VOUCHERS_NOT_SUPPORTED'
      USING ERRCODE = '55000';
  END IF;

  -- Freeze all catalog values involved in validation and insertion.
  PERFORM p.id
  FROM public.products AS p
  JOIN jsonb_to_recordset(v_item_totals) AS i(
    product_id uuid, quantity integer
  ) ON i.product_id = p.id
  ORDER BY p.id
  FOR UPDATE OF p;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_item_totals) AS i(
      product_id uuid, quantity integer
    )
    LEFT JOIN public.products AS p ON p.id = i.product_id
    WHERE p.id IS NULL
       OR p.status IS DISTINCT FROM 'active'
       OR p.price IS NULL
       OR p.price < 0
       OR p.name IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_INACTIVE_PRODUCT' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_items) AS i(
      product_id uuid, product text, is_refill boolean,
      quantity integer, unit_price integer, discount integer
    )
    JOIN public.products AS p ON p.id = i.product_id
    WHERE i.product IS DISTINCT FROM p.name
       OR i.is_refill IS DISTINCT FROM COALESCE(p.is_refill, false)
       OR i.unit_price IS DISTINCT FROM CASE
         WHEN p.is_refill IS TRUE THEN 15000
         ELSE p.price
       END
       OR i.discount IS DISTINCT FROM CASE
         WHEN p.is_refill IS TRUE THEN v_customer.discount
         ELSE 0
       END
  ) THEN
    RAISE EXCEPTION 'ORDER_PRICE_CHANGED' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(
    i.quantity::numeric * (i.unit_price::numeric - i.discount::numeric)
  ), 0)
    INTO v_total_amount
  FROM jsonb_to_recordset(v_items) AS i(
    product_id uuid, product text, is_refill boolean,
    quantity integer, unit_price integer, discount integer
  );

  IF v_total_amount <> trunc(v_total_amount)
     OR v_total_amount < 0
     OR v_total_amount > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_ORDER_TOTAL' USING ERRCODE = '22023';
  END IF;

  -- Only active receivables consume credit. A cancelled order is retained for
  -- audit, but must not permanently strand the customer's available credit.
  IF v_customer.credit_limit IS NOT NULL THEN
    SELECT COALESCE(SUM(o.total_amount::numeric), 0)
      INTO v_unpaid_total
    FROM public.orders AS o
    WHERE o.customer_id = p_customer_id
      AND o.payment_status = 'unpaid'
      AND o.is_active IS TRUE
      AND (p_edit_order_id IS NULL OR o.id <> p_edit_order_id);

    IF v_customer.credit_limit < 0
       OR v_unpaid_total + v_total_amount > v_customer.credit_limit THEN
      RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_edit_order_id IS NULL AND EXISTS (
    SELECT 1
    FROM public.orders AS o
    WHERE o.customer_id = p_customer_id
      AND o.payment_status = 'unpaid'
      AND o.status = 'delivered'
      AND o.is_active IS TRUE
      AND o.delivery_date IS NOT NULL
      AND (v_jakarta_now::date) > CASE lower(COALESCE(v_customer.payment_term, ''))
        WHEN 'daily' THEN o.delivery_date
        WHEN 'weekly' THEN o.delivery_date
          + (7 - EXTRACT(ISODOW FROM o.delivery_date)::integer)
        WHEN 'monthly' THEN make_date(
          EXTRACT(YEAR FROM o.delivery_date)::integer,
          EXTRACT(MONTH FROM o.delivery_date)::integer,
          20
        )
        WHEN 'quarterly' THEN (
          date_trunc('month', o.delivery_date)::date
          + INTERVAL '1 month 19 days'
        )::date
        ELSE o.delivery_date
      END
  ) THEN
    RAISE EXCEPTION 'OUTSTANDING_PAYMENT_BLOCKED' USING ERRCODE = 'P0001';
  END IF;

  IF p_edit_order_id IS NOT NULL THEN
    UPDATE public.orders
    SET
      delivery_date = p_delivery_date,
      total_amount = v_total_amount::integer,
      customer_discount = v_customer.discount,
      note = v_note,
      updated_at = now()
    WHERE id = p_edit_order_id
      AND customer_id = p_customer_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ORDER_UPDATE_FAILED';
    END IF;

    DELETE FROM public.order_items WHERE order_id = p_edit_order_id;

    INSERT INTO public.order_items (
      order_id, product_id, product, is_refill,
      quantity, unit_price, discount
    )
    SELECT
      p_edit_order_id, i.product_id, p.name, COALESCE(p.is_refill, false),
      i.quantity, i.unit_price, i.discount
    FROM jsonb_to_recordset(v_items) AS i(
      product_id uuid, product text, is_refill boolean,
      quantity integer, unit_price integer, discount integer
    )
    JOIN public.products AS p ON p.id = i.product_id;

    RETURN jsonb_build_object(
      'created', false,
      'edited', true,
      'order_id', p_edit_order_id,
      'total_amount', v_total_amount::integer,
      'payment_status', v_existing.payment_status,
      'is_active', true
    );
  END IF;

  INSERT INTO public.orders (
    customer_id,
    customer_name,
    customer_address,
    customer_whatsapp,
    customer_discount,
    branch,
    delivery_date,
    total_amount,
    status,
    payment_status,
    note,
    empty_gallons_returned,
    borrowed_gallons,
    created_by,
    created_by_display,
    is_active,
    later_pay_order_key,
    later_pay_order_request_hash
  )
  VALUES (
    v_customer.id,
    v_customer.name,
    v_customer.address,
    v_customer.whatsapp,
    v_customer.discount,
    v_customer.branch,
    p_delivery_date,
    v_total_amount::integer,
    'pending',
    CASE WHEN v_total_amount = 0 THEN 'paid' ELSE 'unpaid' END,
    v_note,
    0,
    0,
    NULL,
    v_customer.name,
    true,
    p_order_key,
    v_request_hash
  )
  RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (
    order_id, product_id, product, is_refill,
    quantity, unit_price, discount
  )
  SELECT
    v_order_id, i.product_id, p.name, COALESCE(p.is_refill, false),
    i.quantity, i.unit_price, i.discount
  FROM jsonb_to_recordset(v_items) AS i(
    product_id uuid, product text, is_refill boolean,
    quantity integer, unit_price integer, discount integer
  )
  JOIN public.products AS p ON p.id = i.product_id;

  RETURN jsonb_build_object(
    'created', true,
    'already_created', false,
    'order_id', v_order_id,
    'total_amount', v_total_amount::integer,
    'payment_status', CASE WHEN v_total_amount = 0 THEN 'paid' ELSE 'unpaid' END,
    'is_active', true
  );
END;
$function$;

ALTER FUNCTION public.submit_customer_later_pay_order(
  uuid, uuid, uuid, date, text, jsonb, jsonb
) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.submit_customer_later_pay_order(
  uuid, uuid, uuid, date, text, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_customer_later_pay_order(
  uuid, uuid, uuid, date, text, jsonb, jsonb
) TO service_role;

COMMENT ON FUNCTION public.submit_customer_later_pay_order(
  uuid, uuid, uuid, date, text, jsonb, jsonb
) IS
  'Service-role-only atomic customer-portal later-pay create/edit with keyed idempotency, locked credit/overdue validation, authoritative pricing, and fail-closed voucher rejection until cash-due settlement is modeled.';

COMMIT;
