-- Create a voucher-only pre-pay order as one transaction. The function owns
-- validation, row locking, order/item creation, voucher consumption, and the
-- immutable usage-ledger snapshot so Edge failures cannot leave partial state.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS voucher_order_key uuid,
  ADD COLUMN IF NOT EXISTS voucher_order_request_hash text;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_voucher_order_identity_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_voucher_order_identity_check CHECK (
    (voucher_order_key IS NULL AND voucher_order_request_hash IS NULL)
    OR (
      voucher_order_key IS NOT NULL
      AND voucher_order_request_hash IS NOT NULL
      AND prepay_checkout_key IS NULL
      AND midtrans_order_id IS NULL
      AND COALESCE(qris_charged_idr, 0) = 0
      AND payment_status = 'paid'
    )
  ) NOT VALID;
ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_voucher_order_identity_check;

CREATE UNIQUE INDEX IF NOT EXISTS orders_voucher_order_key_key
  ON public.orders (voucher_order_key)
  WHERE voucher_order_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_customer_voucher_only_order(
  p_customer_id uuid,
  p_order_key uuid,
  p_delivery_date date,
  p_note text,
  p_items jsonb,
  p_product_deductions jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_existing public.orders%ROWTYPE;
  v_order_id uuid;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_splits jsonb := '[]'::jsonb;
  v_element jsonb;
  v_quantity numeric;
  v_total_amount numeric := 0;
  v_min_delivery_date date;
  v_jakarta_now timestamp;
  v_closed_weekdays integer[] := '{}'::integer[];
  v_guard integer := 0;
  v_deduction record;
  v_unit_amount integer;
  v_line_amount numeric;
  v_pricing_basis text;
  v_updated_rows integer;
  v_request_hash text;
BEGIN
  IF p_customer_id IS NULL OR p_order_key IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_ORDER_IDENTITY_REQUIRED';
  END IF;
  IF p_delivery_date IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_DATE_REQUIRED';
  END IF;

  v_note := NULLIF(btrim(p_note), '');
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'ORDER_NOTE_TOO_LONG';
  END IF;

  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'INVALID_ORDER_ITEMS';
  END IF;
  IF p_product_deductions IS NULL
     OR jsonb_typeof(p_product_deductions) <> 'array'
     OR jsonb_array_length(p_product_deductions) = 0
     OR jsonb_array_length(p_product_deductions) > 100 THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTIONS';
  END IF;

  FOR v_element IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_element) <> 'object'
       OR NOT (v_element ? 'product_id')
       OR NOT (v_element ? 'quantity')
       OR (v_element - ARRAY['product_id', 'quantity']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(v_element -> 'product_id') <> 'string'
       OR (v_element ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_element -> 'quantity') <> 'number' THEN
      RAISE EXCEPTION 'INVALID_ORDER_ITEM';
    END IF;

    v_quantity := (v_element ->> 'quantity')::numeric;
    IF v_quantity <> trunc(v_quantity)
       OR v_quantity <= 0
       OR v_quantity > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_ORDER_QUANTITY';
    END IF;
  END LOOP;

  FOR v_element IN SELECT value FROM jsonb_array_elements(p_product_deductions)
  LOOP
    IF jsonb_typeof(v_element) <> 'object'
       OR NOT (v_element ? 'product_id')
       OR NOT (v_element ? 'quantity')
       OR (v_element - ARRAY['product_id', 'quantity']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(v_element -> 'product_id') <> 'string'
       OR (v_element ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_element -> 'quantity') <> 'number' THEN
      RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTION';
    END IF;

    v_quantity := (v_element ->> 'quantity')::numeric;
    IF v_quantity <> trunc(v_quantity)
       OR v_quantity <= 0
       OR v_quantity > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTION';
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
    RAISE EXCEPTION 'INVALID_ORDER_QUANTITY';
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
    RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTION';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'quantity', normalized.quantity
      )
      ORDER BY normalized.product_id::text
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT
      (e.value ->> 'product_id')::uuid AS product_id,
      SUM((e.value ->> 'quantity')::numeric)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY (e.value ->> 'product_id')::uuid
  ) AS normalized;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', normalized.product_id,
        'quantity', normalized.quantity
      )
      ORDER BY normalized.product_id::text
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

  -- Voucher-only means every ordered unit is covered by exactly one voucher.
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
    FULL JOIN jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
      ON d.product_id = i.product_id
    WHERE i.product_id IS NULL
       OR d.product_id IS NULL
       OR i.quantity IS DISTINCT FROM d.quantity
  ) THEN
    RAISE EXCEPTION 'VOUCHER_ONLY_ORDER_REQUIRES_FULL_DEDUCTION';
  END IF;

  v_request_hash := md5(
    jsonb_build_object(
      'customer_id', p_customer_id,
      'delivery_date', p_delivery_date,
      'note', v_note,
      'items', v_items,
      'product_deductions', v_deductions
    )::text
  );

  -- Serialize duplicate clicks and retries whose first response was lost.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('voucher-only:' || p_order_key::text, 0)
  );

  SELECT o.*
  INTO v_existing
  FROM public.orders AS o
  WHERE o.voucher_order_key = p_order_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.customer_id <> p_customer_id
       OR v_existing.voucher_order_request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'VOUCHER_ORDER_KEY_CONFLICT';
    END IF;
    IF v_existing.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'VOUCHER_ORDER_ALREADY_INACTIVE';
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

  -- Customer state and snapshot fields cannot change while the order is made.
  SELECT c.*
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  IF v_customer.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CUSTOMER_IS_INACTIVE';
  END IF;
  IF v_customer.customer_type IS DISTINCT FROM 'pre_pay' THEN
    RAISE EXCEPTION 'CUSTOMER_IS_NOT_PREPAY';
  END IF;
  IF v_customer.name IS NULL
     OR v_customer.address IS NULL
     OR v_customer.whatsapp IS NULL
     OR v_customer.branch IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_PROFILE_INCOMPLETE';
  END IF;

  SELECT b.*
  INTO v_branch
  FROM public.branches AS b
  WHERE b.name = v_customer.branch;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVICE_BRANCH_NOT_FOUND';
  END IF;
  IF v_branch.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'SERVICE_BRANCH_INACTIVE';
  END IF;

  v_closed_weekdays := COALESCE(v_branch.closed_weekdays, '{}'::integer[]);
  v_jakarta_now := clock_timestamp() AT TIME ZONE 'Asia/Jakarta';
  v_min_delivery_date := v_jakarta_now::date;
  IF EXTRACT(HOUR FROM v_jakarta_now)::integer >= COALESCE(v_branch.order_cutoff_hour, 16) THEN
    v_min_delivery_date := v_min_delivery_date + 1;
  END IF;

  WHILE EXTRACT(DOW FROM v_min_delivery_date)::integer = ANY (v_closed_weekdays)
  LOOP
    v_min_delivery_date := v_min_delivery_date + 1;
    v_guard := v_guard + 1;
    IF v_guard > 14 THEN
      RAISE EXCEPTION 'DELIVERY_SCHEDULE_INVALID';
    END IF;
  END LOOP;

  IF p_delivery_date < v_min_delivery_date THEN
    RAISE EXCEPTION 'DELIVERY_DATE_TOO_SOON';
  END IF;
  IF EXTRACT(DOW FROM p_delivery_date)::integer = ANY (v_closed_weekdays) THEN
    RAISE EXCEPTION 'DELIVERY_DATE_BRANCH_CLOSED';
  END IF;

  -- Freeze product identity, active state, name, and price in deterministic order.
  PERFORM p.id
  FROM public.products AS p
  JOIN jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
    ON i.product_id = p.id
  ORDER BY p.id
  FOR UPDATE OF p;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
    LEFT JOIN public.products AS p ON p.id = i.product_id
    WHERE p.id IS NULL
       OR p.status IS DISTINCT FROM 'active'
       OR p.price <= 0
       OR p.name IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_INACTIVE_PRODUCT';
  END IF;

  -- Serialize all voucher spending for this customer/product set.
  PERFORM 1
  FROM public.customer_product_vouchers AS cpv
  JOIN jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
    ON d.product_id = cpv.product_id
  WHERE cpv.customer_id = p_customer_id
  ORDER BY cpv.product_id
  FOR UPDATE OF cpv;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
    LEFT JOIN public.customer_product_vouchers AS cpv
      ON cpv.customer_id = p_customer_id
     AND cpv.product_id = d.product_id
    WHERE cpv.product_id IS NULL
       OR cpv.balance < d.quantity
       OR cpv.gift_balance < 0
       OR cpv.gift_balance > cpv.balance
  ) THEN
    RAISE EXCEPTION 'INSUFFICIENT_OR_INVALID_VOUCHER_BALANCE';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', d.product_id,
        'quantity', d.quantity,
        'from_gift', LEAST(cpv.gift_balance, d.quantity),
        'from_paid', d.quantity - LEAST(cpv.gift_balance, d.quantity)
      )
      ORDER BY d.product_id::text
    ),
    '[]'::jsonb
  )
  INTO v_splits
  FROM jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
  JOIN public.customer_product_vouchers AS cpv
    ON cpv.customer_id = p_customer_id
   AND cpv.product_id = d.product_id;

  SELECT COALESCE(SUM(p.price::numeric * (i.quantity - s.from_gift)), 0)
  INTO v_total_amount
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  JOIN public.products AS p ON p.id = i.product_id
  JOIN jsonb_to_recordset(v_splits) AS s(
    product_id uuid,
    quantity integer,
    from_gift integer,
    from_paid integer
  ) ON s.product_id = i.product_id;

  IF v_total_amount <> trunc(v_total_amount)
     OR v_total_amount < 0
     OR v_total_amount > 2147483647 THEN
    RAISE EXCEPTION 'INVALID_ORDER_TOTAL';
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
    voucher_order_key,
    voucher_order_request_hash
  )
  VALUES (
    v_customer.id,
    v_customer.name,
    v_customer.address,
    v_customer.whatsapp,
    COALESCE(v_customer.discount, 0),
    v_customer.branch,
    p_delivery_date,
    v_total_amount::integer,
    'pending',
    'paid',
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

  -- Preserve the existing reporting shape: gift units are free rows and paid
  -- voucher units retain the catalog price even though no QRIS remains due.
  INSERT INTO public.order_items (
    order_id,
    product_id,
    product,
    is_refill,
    quantity,
    unit_price,
    discount
  )
  SELECT
    v_order_id,
    p.id,
    p.name,
    COALESCE(p.is_refill, false),
    s.from_gift,
    0,
    0
  FROM jsonb_to_recordset(v_splits) AS s(
    product_id uuid,
    quantity integer,
    from_gift integer,
    from_paid integer
  )
  JOIN public.products AS p ON p.id = s.product_id
  WHERE s.from_gift > 0
  UNION ALL
  SELECT
    v_order_id,
    p.id,
    p.name,
    COALESCE(p.is_refill, false),
    s.from_paid,
    p.price,
    0
  FROM jsonb_to_recordset(v_splits) AS s(
    product_id uuid,
    quantity integer,
    from_gift integer,
    from_paid integer
  )
  JOIN public.products AS p ON p.id = s.product_id
  WHERE s.from_paid > 0;

  FOR v_deduction IN
    SELECT
      s.product_id,
      s.quantity,
      s.from_gift,
      s.from_paid
    FROM jsonb_to_recordset(v_splits) AS s(
      product_id uuid,
      quantity integer,
      from_gift integer,
      from_paid integer
    )
    ORDER BY s.product_id
  LOOP
    UPDATE public.customer_product_vouchers AS cpv
    SET
      balance = cpv.balance - v_deduction.quantity,
      gift_balance = cpv.gift_balance - v_deduction.from_gift
    WHERE cpv.customer_id = p_customer_id
      AND cpv.product_id = v_deduction.product_id
      AND cpv.balance >= v_deduction.quantity
      AND cpv.gift_balance >= v_deduction.from_gift;

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows <> 1 THEN
      RAISE EXCEPTION 'VOUCHER_BALANCE_CHANGED';
    END IF;

    IF v_deduction.from_gift > 0 THEN
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
      VALUES (
        v_order_id,
        p_customer_id,
        v_customer.branch,
        v_deduction.product_id,
        v_deduction.from_gift,
        0,
        0,
        'gift_zero'
      );
    END IF;

    IF v_deduction.from_paid > 0 THEN
      SELECT FLOOR(SUM(r.amount_paid)::numeric / NULLIF(SUM(r.qty), 0))::integer
      INTO v_unit_amount
      FROM public.voucher_purchase_requests AS r
      WHERE r.customer_id = p_customer_id
        AND r.product_id = v_deduction.product_id
        AND r.status = 'confirmed';

      IF v_unit_amount IS NOT NULL THEN
        IF v_unit_amount < 0 THEN
          RAISE EXCEPTION 'VOUCHER_UNIT_AMOUNT_INVALID';
        END IF;
        v_pricing_basis := 'purchase_weighted_avg';
      ELSE
        SELECT FLOOR(vp.price::numeric / vp.qty)::integer
        INTO v_unit_amount
        FROM public.voucher_packages AS vp
        WHERE vp.product_id = v_deduction.product_id
          AND vp.is_active = true
        ORDER BY vp.sort_order, vp.id
        LIMIT 1;

        IF v_unit_amount IS NULL OR v_unit_amount <= 0 THEN
          RAISE EXCEPTION 'PAID_VOUCHER_COST_BASIS_MISSING';
        END IF;
        v_pricing_basis := 'package_fallback';
      END IF;

      v_line_amount := v_deduction.from_paid::numeric * v_unit_amount;
      IF v_line_amount > 2147483647 THEN
        RAISE EXCEPTION 'VOUCHER_LEDGER_AMOUNT_OVERFLOW';
      END IF;

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
      VALUES (
        v_order_id,
        p_customer_id,
        v_customer.branch,
        v_deduction.product_id,
        v_deduction.from_paid,
        v_unit_amount,
        v_line_amount::integer,
        v_pricing_basis
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created', true,
    'order_id', v_order_id,
    'total_amount', v_total_amount::integer,
    'payment_status', 'paid',
    'is_active', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_voucher_only_order(
  uuid, uuid, date, text, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_customer_voucher_only_order(
  uuid, uuid, date, text, jsonb, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.create_customer_voucher_only_order(
  uuid, uuid, date, text, jsonb, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_voucher_only_order(
  uuid, uuid, date, text, jsonb, jsonb
) TO service_role;

COMMENT ON FUNCTION public.create_customer_voucher_only_order(
  uuid, uuid, date, text, jsonb, jsonb
) IS
  'Idempotently and atomically creates a fully voucher-funded pre-pay order, consumes gift vouchers first, and writes immutable usage-ledger rows.';
