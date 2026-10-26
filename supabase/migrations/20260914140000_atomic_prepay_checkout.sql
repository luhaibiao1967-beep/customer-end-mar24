-- Reserve, release, and settle a pre-pay QRIS checkout with database-level
-- transaction boundaries. Midtrans network calls remain in Edge Functions.
--
-- `midtrans_order_id` cannot be globally unique because later-pay `op_*`
-- batches intentionally share one id across multiple orders. Pre-pay `pop_*`
-- ids are one-per-order and receive a partial unique index below.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prepay_checkout_key uuid,
  ADD COLUMN IF NOT EXISTS prepay_request_hash text,
  ADD COLUMN IF NOT EXISTS prepay_snap_token text,
  ADD COLUMN IF NOT EXISTS prepay_snap_redirect_url text,
  ADD COLUMN IF NOT EXISTS prepay_snap_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepay_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepay_release_reason text;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_prepay_checkout_identity_check CHECK (
    (prepay_checkout_key IS NULL AND prepay_request_hash IS NULL)
    OR (
      prepay_checkout_key IS NOT NULL
      AND prepay_request_hash IS NOT NULL
      AND prepay_request_hash ~ '^[0-9a-f]{32}$'
      AND midtrans_order_id IS NOT NULL
      AND left(midtrans_order_id, 4) = 'pop_'
      AND qris_charged_idr IS NOT NULL
      AND qris_charged_idr > 0
    )
  ) NOT VALID,
  ADD CONSTRAINT orders_prepay_snap_session_check CHECK (
    (
      prepay_snap_token IS NULL
      AND prepay_snap_redirect_url IS NULL
      AND prepay_snap_created_at IS NULL
    )
    OR (
      prepay_snap_token IS NOT NULL
      AND btrim(prepay_snap_token) <> ''
      AND length(prepay_snap_token) <= 4096
      AND (
        prepay_snap_redirect_url IS NULL
        OR (
          btrim(prepay_snap_redirect_url) <> ''
          AND length(prepay_snap_redirect_url) <= 8192
        )
      )
      AND prepay_snap_created_at IS NOT NULL
      AND prepay_checkout_key IS NOT NULL
      AND midtrans_order_id IS NOT NULL
      AND left(midtrans_order_id, 4) = 'pop_'
    )
  ) NOT VALID,
  ADD CONSTRAINT orders_prepay_release_state_check CHECK (
    (prepay_released_at IS NULL AND prepay_release_reason IS NULL)
    OR (
      prepay_released_at IS NOT NULL
      AND prepay_release_reason IN (
        'snap_create_failed',
        'payment_expired',
        'payment_cancelled',
        'payment_denied',
        'payment_failed'
      )
      AND is_active = false
      AND payment_status = 'unpaid'
    )
  ) NOT VALID;

ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_prepay_checkout_identity_check;
ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_prepay_snap_session_check;
ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_prepay_release_state_check;

-- Keep an unpaid QRIS checkout quarantined from fulfilment. NOT VALID avoids
-- taking a long validation lock while the constraint is installed; the
-- separate validation still proves all existing rows satisfy it.
ALTER TABLE public.orders
  ADD CONSTRAINT orders_unpaid_prepay_lifecycle_check CHECK (
    prepay_checkout_key IS NULL
    OR payment_status = 'paid'
    OR (
      payment_status = 'unpaid'
      AND status = 'pending'
      AND (
        (prepay_released_at IS NULL AND is_active = true)
        OR (prepay_released_at IS NOT NULL AND is_active = false)
      )
    )
  ) NOT VALID;

ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_unpaid_prepay_lifecycle_check;

CREATE OR REPLACE FUNCTION public.guard_unpaid_prepay_order_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.prepay_checkout_key IS NOT NULL
     AND NEW.payment_status IS DISTINCT FROM 'paid' THEN
    IF NEW.payment_status IS DISTINCT FROM 'unpaid'
       OR NEW.status IS DISTINCT FROM 'pending'
       OR (
         NEW.prepay_released_at IS NULL
         AND NEW.is_active IS DISTINCT FROM true
       )
       OR (
         NEW.prepay_released_at IS NOT NULL
         AND NEW.is_active IS DISTINCT FROM false
       ) THEN
      RAISE EXCEPTION 'UNPAID_PREPAY_CHECKOUT_CANNOT_BE_FULFILLED';
    END IF;
  END IF;

  IF NEW.prepay_checkout_key IS NOT NULL
     AND NEW.payment_status = 'paid'
     AND (CASE
       WHEN TG_OP = 'INSERT' THEN true
       ELSE OLD.payment_status IS DISTINCT FROM 'paid'
     END) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.hq_midtrans_settlements AS h
      WHERE h.source_type = 'prepay_order_qris'
        AND h.order_id = NEW.id
        AND h.midtrans_order_id = NEW.midtrans_order_id
        AND h.gross_amount = NEW.qris_charged_idr
    ) THEN
      RAISE EXCEPTION 'PREPAY_PAYMENT_REQUIRES_VERIFIED_SETTLEMENT';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_unpaid_prepay_order_lifecycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_unpaid_prepay_order_lifecycle() FROM anon;
REVOKE ALL ON FUNCTION public.guard_unpaid_prepay_order_lifecycle() FROM authenticated;

DROP TRIGGER IF EXISTS guard_unpaid_prepay_order_lifecycle
  ON public.orders;
CREATE TRIGGER guard_unpaid_prepay_order_lifecycle
BEFORE INSERT OR UPDATE OF
  status,
  payment_status,
  is_active,
  prepay_released_at,
  prepay_checkout_key
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_unpaid_prepay_order_lifecycle();

CREATE UNIQUE INDEX IF NOT EXISTS orders_prepay_checkout_key_key
  ON public.orders (prepay_checkout_key)
  WHERE prepay_checkout_key IS NOT NULL;

-- This deliberately excludes `op_*`, whose batch-payment design uses the same
-- Midtrans id on more than one order row.
CREATE UNIQUE INDEX IF NOT EXISTS orders_pop_midtrans_order_id_key
  ON public.orders (midtrans_order_id)
  WHERE left(midtrans_order_id, 4) = 'pop_';

CREATE OR REPLACE FUNCTION public.create_customer_prepay_checkout(
  p_customer_id uuid,
  p_checkout_key uuid,
  p_delivery_date date,
  p_note text,
  p_items jsonb,
  p_product_deductions jsonb DEFAULT '[]'::jsonb
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
  v_midtrans_order_id text;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_splits jsonb := '[]'::jsonb;
  v_item_cash_units jsonb := '[]'::jsonb;
  v_breakdown jsonb;
  v_request_hash text;
  v_element jsonb;
  v_quantity numeric;
  v_total_amount numeric := 0;
  v_qris_amount numeric := 0;
  v_min_delivery_date date;
  v_jakarta_now timestamp;
  v_closed_weekdays integer[] := '{}'::integer[];
  v_guard integer := 0;
  v_deduction record;
  v_unit_amount integer;
  v_line_amount numeric;
  v_pricing_basis text;
  v_updated_rows integer;
BEGIN
  IF p_customer_id IS NULL OR p_checkout_key IS NULL THEN
    RAISE EXCEPTION 'PREPAY_CHECKOUT_IDENTITY_REQUIRED';
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
     OR jsonb_array_length(p_product_deductions) > 100 THEN
    RAISE EXCEPTION 'INVALID_PRODUCT_DEDUCTIONS';
  END IF;

  -- Validate primitive JSON values before casting them to SQL types.
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

  v_request_hash := md5(
    jsonb_build_object(
      'customer_id', p_customer_id,
      'delivery_date', p_delivery_date,
      'note', v_note,
      'items', v_items,
      'product_deductions', v_deductions
    )::text
  );

  -- Serialize retries with the same idempotency key before checking/inserting.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkout_key::text, 0));

  SELECT o.*
  INTO v_existing
  FROM public.orders AS o
  WHERE o.prepay_checkout_key = p_checkout_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.customer_id <> p_customer_id
       OR v_existing.prepay_request_hash IS DISTINCT FROM v_request_hash THEN
      RAISE EXCEPTION 'PREPAY_CHECKOUT_KEY_CONFLICT';
    END IF;

    RETURN jsonb_build_object(
      'created', false,
      'already_created', true,
      'order_id', v_existing.id,
      'midtrans_order_id', v_existing.midtrans_order_id,
      'total_amount', v_existing.total_amount,
      'qris_charged_idr', v_existing.qris_charged_idr,
      'prepay_breakdown', v_existing.prepay_breakdown,
      'payment_status', v_existing.payment_status,
      'is_active', v_existing.is_active,
      'snap_token', v_existing.prepay_snap_token,
      'snap_redirect_url', v_existing.prepay_snap_redirect_url,
      'snap_created_at', v_existing.prepay_snap_created_at,
      'released_at', v_existing.prepay_released_at
    );
  END IF;

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

  -- Freeze the product rows used for both validation and pricing so a catalog
  -- edit cannot change names, prices, or active state midway through checkout.
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
       OR p.price < 0
       OR p.name IS NULL
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_INACTIVE_PRODUCT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
    LEFT JOIN jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
      ON i.product_id = d.product_id
    LEFT JOIN public.products AS p ON p.id = d.product_id
    WHERE i.product_id IS NULL
       OR d.quantity > i.quantity
       OR p.id IS NULL
       OR p.status IS DISTINCT FROM 'active'
       OR p.price <= 0
  ) THEN
    RAISE EXCEPTION 'VOUCHER_ITEM_SPLIT_INVALID';
  END IF;

  -- Lock all voucher rows in a deterministic order. This prevents two
  -- concurrent checkouts from both spending the same balance.
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

  SELECT
    COALESCE(SUM(p.price::numeric * (i.quantity - COALESCE(s.from_gift, 0))), 0),
    COALESCE(SUM(p.price::numeric * (i.quantity - COALESCE(d.quantity, 0))), 0)
  INTO v_total_amount, v_qris_amount
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  JOIN public.products AS p ON p.id = i.product_id
  LEFT JOIN jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
    ON d.product_id = i.product_id
  LEFT JOIN jsonb_to_recordset(v_splits) AS s(
    product_id uuid,
    quantity integer,
    from_gift integer,
    from_paid integer
  ) ON s.product_id = i.product_id;

  IF v_total_amount <> trunc(v_total_amount)
     OR v_qris_amount <> trunc(v_qris_amount)
     OR v_total_amount > 2147483647
     OR v_qris_amount > 2147483647
     OR v_qris_amount <= 0
     OR v_qris_amount > v_total_amount THEN
    RAISE EXCEPTION 'INVALID_PREPAY_AMOUNT';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', i.product_id,
        'quantity', i.quantity,
        'by_voucher', COALESCE(d.quantity, 0),
        'by_qris', i.quantity - COALESCE(d.quantity, 0)
      )
      ORDER BY i.product_id::text
    ),
    '[]'::jsonb
  )
  INTO v_item_cash_units
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  LEFT JOIN jsonb_to_recordset(v_deductions) AS d(product_id uuid, quantity integer)
    ON d.product_id = i.product_id;

  v_breakdown := jsonb_build_object(
    'catalog_total_idr', v_total_amount::integer,
    'qris_idr', v_qris_amount::integer,
    'voucher_splits', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'product_id', s.product_id,
            'from_gift', s.from_gift,
            'from_paid', s.from_paid
          )
          ORDER BY s.product_id::text
        ),
        '[]'::jsonb
      )
      FROM jsonb_to_recordset(v_splits) AS s(
        product_id uuid,
        quantity integer,
        from_gift integer,
        from_paid integer
      )
    ),
    'item_cash_units', v_item_cash_units
  );

  v_midtrans_order_id := 'pop_' || replace(p_checkout_key::text, '-', '');

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
    midtrans_order_id,
    note,
    empty_gallons_returned,
    borrowed_gallons,
    created_by,
    created_by_display,
    is_active,
    qris_charged_idr,
    prepay_breakdown,
    prepay_checkout_key,
    prepay_request_hash
  )
  VALUES (
    v_customer.id,
    v_customer.name,
    v_customer.address,
    v_customer.whatsapp,
    0,
    v_customer.branch,
    p_delivery_date,
    v_total_amount::integer,
    'pending',
    'unpaid',
    v_midtrans_order_id,
    v_note,
    0,
    0,
    NULL,
    v_customer.name,
    true,
    v_qris_amount::integer,
    v_breakdown,
    p_checkout_key,
    v_request_hash
  )
  RETURNING id INTO v_order_id;

  -- Gift units remain distinct zero-price rows; all other units use the
  -- server-side catalog price. This preserves the existing reporting shape.
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
    i.quantity - COALESCE(s.from_gift, 0),
    p.price,
    0
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  JOIN public.products AS p ON p.id = i.product_id
  LEFT JOIN jsonb_to_recordset(v_splits) AS s(
    product_id uuid,
    quantity integer,
    from_gift integer,
    from_paid integer
  ) ON s.product_id = i.product_id
  WHERE i.quantity - COALESCE(s.from_gift, 0) > 0;

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
    'already_created', false,
    'order_id', v_order_id,
    'midtrans_order_id', v_midtrans_order_id,
    'total_amount', v_total_amount::integer,
    'qris_charged_idr', v_qris_amount::integer,
    'prepay_breakdown', v_breakdown,
    'payment_status', 'unpaid',
    'is_active', true,
    'snap_token', NULL,
    'snap_redirect_url', NULL,
    'snap_created_at', NULL,
    'released_at', NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.store_customer_prepay_snap_session(
  p_customer_id uuid,
  p_checkout_key uuid,
  p_snap_token text,
  p_redirect_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_snap_token text;
  v_redirect_url text;
  v_already_stored boolean := false;
BEGIN
  IF p_customer_id IS NULL OR p_checkout_key IS NULL THEN
    RAISE EXCEPTION 'PREPAY_CHECKOUT_IDENTITY_REQUIRED';
  END IF;

  v_snap_token := NULLIF(btrim(p_snap_token), '');
  v_redirect_url := NULLIF(btrim(p_redirect_url), '');

  IF v_snap_token IS NULL OR length(v_snap_token) > 4096 THEN
    RAISE EXCEPTION 'INVALID_PREPAY_SNAP_TOKEN';
  END IF;
  IF v_redirect_url IS NOT NULL AND length(v_redirect_url) > 8192 THEN
    RAISE EXCEPTION 'INVALID_PREPAY_SNAP_REDIRECT_URL';
  END IF;

  -- Serialize with checkout retries, then lock the concrete order so settlement
  -- and release cannot change its state while the Snap session is persisted.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkout_key::text, 0));

  SELECT o.*
  INTO v_order
  FROM public.orders AS o
  WHERE o.prepay_checkout_key = p_checkout_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREPAY_CHECKOUT_NOT_FOUND';
  END IF;
  IF v_order.customer_id <> p_customer_id THEN
    RAISE EXCEPTION 'PREPAY_CHECKOUT_CUSTOMER_MISMATCH';
  END IF;
  IF v_order.midtrans_order_id IS NULL
     OR left(v_order.midtrans_order_id, 4) <> 'pop_' THEN
    RAISE EXCEPTION 'PREPAY_CHECKOUT_MIDTRANS_ID_INVALID';
  END IF;

  IF v_order.prepay_snap_token IS NOT NULL THEN
    IF v_order.prepay_snap_token IS DISTINCT FROM v_snap_token
       OR (
         v_order.prepay_snap_redirect_url IS NOT NULL
         AND v_redirect_url IS NOT NULL
         AND v_order.prepay_snap_redirect_url IS DISTINCT FROM v_redirect_url
       ) THEN
      RAISE EXCEPTION 'PREPAY_SNAP_SESSION_CONFLICT';
    END IF;

    -- A retry may supply the redirect URL after the token was first stored.
    IF v_order.prepay_snap_redirect_url IS NULL AND v_redirect_url IS NOT NULL THEN
      UPDATE public.orders AS o
      SET
        prepay_snap_redirect_url = v_redirect_url,
        updated_at = now()
      WHERE o.id = v_order.id
      RETURNING o.* INTO v_order;
    END IF;

    v_already_stored := true;
  ELSE
    IF v_order.is_active IS DISTINCT FROM true
       OR v_order.prepay_released_at IS NOT NULL
       OR v_order.payment_status NOT IN ('unpaid', 'paid') THEN
      RAISE EXCEPTION 'PREPAY_CHECKOUT_NOT_STORABLE';
    END IF;

    UPDATE public.orders AS o
    SET
      prepay_snap_token = v_snap_token,
      prepay_snap_redirect_url = v_redirect_url,
      prepay_snap_created_at = now(),
      updated_at = now()
    WHERE o.id = v_order.id
      AND o.prepay_snap_token IS NULL
    RETURNING o.* INTO v_order;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'PREPAY_SNAP_SESSION_STATE_CHANGED';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'stored', true,
    'already_stored', v_already_stored,
    'order_id', v_order.id,
    'checkout_key', v_order.prepay_checkout_key,
    'midtrans_order_id', v_order.midtrans_order_id,
    'snap_token', v_order.prepay_snap_token,
    'snap_redirect_url', v_order.prepay_snap_redirect_url,
    'snap_created_at', v_order.prepay_snap_created_at,
    'payment_status', v_order.payment_status,
    'is_active', v_order.is_active
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.release_customer_prepay_checkout(
  p_customer_id uuid,
  p_order_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_refund record;
  v_expected_voucher_qty bigint := 0;
  v_expected_gift_qty bigint := 0;
  v_net_voucher_qty bigint := 0;
  v_net_gift_qty bigint := 0;
  v_refunded_voucher_qty bigint := 0;
  v_refunded_gift_qty bigint := 0;
BEGIN
  IF p_reason IS NULL OR p_reason <> ALL (ARRAY[
    'snap_create_failed',
    'payment_expired',
    'payment_cancelled',
    'payment_denied',
    'payment_failed'
  ]::text[]) THEN
    RAISE EXCEPTION 'INVALID_PREPAY_RELEASE_REASON';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.customer_id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREPAY_ORDER_NOT_FOUND';
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending'
     OR left(v_order.midtrans_order_id, 4) IS DISTINCT FROM 'pop_'
     OR COALESCE(v_order.qris_charged_idr, 0) <= 0 THEN
    RAISE EXCEPTION 'ORDER_IS_NOT_RELEASABLE_PREPAY';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voucher_usage_ledger AS l
    WHERE l.order_id = v_order.id
      AND l.customer_id <> p_customer_id
  ) THEN
    RAISE EXCEPTION 'PREPAY_LEDGER_CUSTOMER_MISMATCH';
  END IF;

  SELECT
    COALESCE(SUM(l.voucher_qty), 0)::bigint,
    COALESCE(SUM(l.voucher_qty) FILTER (
      WHERE l.pricing_basis = 'gift_zero'
    ), 0)::bigint
  INTO v_net_voucher_qty, v_net_gift_qty
  FROM public.voucher_usage_ledger AS l
  WHERE l.order_id = v_order.id
    AND l.customer_id = p_customer_id;

  IF v_order.is_active IS FALSE THEN
    IF v_order.prepay_released_at IS NOT NULL
       AND v_order.payment_status = 'unpaid'
       AND v_net_voucher_qty = 0 THEN
      RETURN jsonb_build_object(
        'released', true,
        'already_released', true,
        'order_id', v_order.id,
        'refunded_voucher_qty', 0,
        'refunded_gift_qty', 0,
        'released_at', v_order.prepay_released_at,
        'release_reason', v_order.prepay_release_reason
      );
    END IF;
    RAISE EXCEPTION 'INACTIVE_PREPAY_RELEASE_STATE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hq_midtrans_settlements AS h
    WHERE h.midtrans_order_id = v_order.midtrans_order_id
       OR h.order_id = v_order.id
  ) THEN
    RAISE EXCEPTION 'PREPAY_PAYMENT_ALREADY_SETTLED';
  END IF;

  IF v_order.payment_status IS DISTINCT FROM 'unpaid' THEN
    RAISE EXCEPTION 'PREPAY_PAYMENT_ALREADY_SETTLED';
  END IF;

  SELECT
    COALESCE(SUM(
      COALESCE((s.value ->> 'from_gift')::bigint, 0)
      + COALESCE((s.value ->> 'from_paid')::bigint, 0)
    ), 0)::bigint,
    COALESCE(SUM(
      COALESCE((s.value ->> 'from_gift')::bigint, 0)
    ), 0)::bigint
  INTO v_expected_voucher_qty, v_expected_gift_qty
  FROM jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(v_order.prepay_breakdown -> 'voucher_splits') = 'array'
      THEN v_order.prepay_breakdown -> 'voucher_splits'
      ELSE '[]'::jsonb
    END
  ) AS s(value);

  IF v_net_voucher_qty < 0
     OR v_net_gift_qty < 0
     OR v_net_voucher_qty <> v_expected_voucher_qty
     OR v_net_gift_qty <> v_expected_gift_qty THEN
    RAISE EXCEPTION 'PREPAY_LEDGER_MISMATCH';
  END IF;

  -- Validate the immutable checkout snapshot against the ledger per product,
  -- not only in aggregate. This prevents restoring vouchers to the wrong SKU.
  IF EXISTS (
    WITH expected AS (
      SELECT
        (s.value ->> 'product_id')::uuid AS product_id,
        COALESCE((s.value ->> 'from_gift')::bigint, 0)
          + COALESCE((s.value ->> 'from_paid')::bigint, 0) AS total_qty,
        COALESCE((s.value ->> 'from_gift')::bigint, 0) AS gift_qty
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(v_order.prepay_breakdown -> 'voucher_splits') = 'array'
          THEN v_order.prepay_breakdown -> 'voucher_splits'
          ELSE '[]'::jsonb
        END
      ) AS s(value)
    ),
    actual AS (
      SELECT
        l.product_id,
        SUM(l.voucher_qty)::bigint AS total_qty,
        COALESCE(SUM(l.voucher_qty) FILTER (
          WHERE l.pricing_basis = 'gift_zero'
        ), 0)::bigint AS gift_qty
      FROM public.voucher_usage_ledger AS l
      WHERE l.order_id = v_order.id
        AND l.customer_id = p_customer_id
      GROUP BY l.product_id
    )
    SELECT 1
    FROM expected AS e
    FULL JOIN actual AS a USING (product_id)
    WHERE COALESCE(e.total_qty, 0) <> COALESCE(a.total_qty, 0)
       OR COALESCE(e.gift_qty, 0) <> COALESCE(a.gift_qty, 0)
  ) THEN
    RAISE EXCEPTION 'PREPAY_LEDGER_PRODUCT_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        l.product_id,
        SUM(l.voucher_qty)::bigint AS total_qty,
        COALESCE(SUM(l.voucher_qty) FILTER (
          WHERE l.pricing_basis = 'gift_zero'
        ), 0)::bigint AS gift_qty
      FROM public.voucher_usage_ledger AS l
      WHERE l.order_id = v_order.id
        AND l.customer_id = p_customer_id
      GROUP BY l.product_id
    ) AS net
    WHERE net.total_qty < 0
       OR net.gift_qty < 0
       OR net.gift_qty > net.total_qty
  ) THEN
    RAISE EXCEPTION 'INVALID_PREPAY_LEDGER_STATE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.voucher_usage_ledger AS l
    WHERE l.order_id = v_order.id
      AND l.customer_id = p_customer_id
    GROUP BY l.branch, l.product_id, l.unit_amount, l.pricing_basis
    HAVING SUM(l.voucher_qty) < 0
  ) THEN
    RAISE EXCEPTION 'INVALID_PREPAY_LEDGER_GROUP_STATE';
  END IF;

  -- Restore each SKU in a deterministic order so concurrent multi-SKU
  -- releases cannot deadlock by acquiring voucher rows in opposite orders.
  FOR v_refund IN
    SELECT
      l.product_id,
      SUM(l.voucher_qty)::integer AS total_qty,
      COALESCE(SUM(l.voucher_qty) FILTER (
        WHERE l.pricing_basis = 'gift_zero'
      ), 0)::integer AS gift_qty
    FROM public.voucher_usage_ledger AS l
    WHERE l.order_id = v_order.id
      AND l.customer_id = p_customer_id
    GROUP BY l.product_id
    HAVING SUM(l.voucher_qty) > 0
    ORDER BY l.product_id
  LOOP
    INSERT INTO public.customer_product_vouchers AS cpv (
      customer_id,
      product_id,
      balance,
      gift_balance
    )
    VALUES (
      p_customer_id,
      v_refund.product_id,
      v_refund.total_qty,
      v_refund.gift_qty
    )
    ON CONFLICT (customer_id, product_id)
    DO UPDATE SET
      balance = cpv.balance + EXCLUDED.balance,
      gift_balance = cpv.gift_balance + EXCLUDED.gift_balance;
  END LOOP;

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
    v_order.id,
    p_customer_id,
    l.branch,
    l.product_id,
    -SUM(l.voucher_qty)::integer,
    l.unit_amount,
    -SUM(l.line_amount)::integer,
    l.pricing_basis
  FROM public.voucher_usage_ledger AS l
  WHERE l.order_id = v_order.id
    AND l.customer_id = p_customer_id
  GROUP BY l.branch, l.product_id, l.unit_amount, l.pricing_basis
  HAVING SUM(l.voucher_qty) > 0;

  v_refunded_voucher_qty := v_net_voucher_qty;
  v_refunded_gift_qty := v_net_gift_qty;

  UPDATE public.orders AS o
  SET
    is_active = false,
    inactivated_at = COALESCE(o.inactivated_at, now()),
    updated_at = now(),
    prepay_released_at = now(),
    prepay_release_reason = p_reason
  WHERE o.id = v_order.id
    AND o.customer_id = p_customer_id
    AND o.is_active = true
    AND o.payment_status = 'unpaid';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREPAY_RELEASE_STATE_CHANGED';
  END IF;

  RETURN jsonb_build_object(
    'released', true,
    'already_released', false,
    'order_id', v_order.id,
    'refunded_voucher_qty', v_refunded_voucher_qty,
    'refunded_gift_qty', v_refunded_gift_qty,
    'released_at', now(),
    'release_reason', p_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_customer_prepay_checkout(
  p_midtrans_order_id text,
  p_gross_amount integer,
  p_midtrans_transaction_id text,
  p_transaction_status text,
  p_payment_type text,
  p_raw_notification jsonb DEFAULT NULL,
  p_settled_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_existing_settlement public.hq_midtrans_settlements%ROWTYPE;
  v_was_paid boolean;
  v_had_settlement boolean := false;
  v_is_late_payment boolean := false;
  v_settled_at timestamptz := COALESCE(p_settled_at, now());
BEGIN
  IF p_midtrans_order_id IS NULL
     OR left(p_midtrans_order_id, 4) <> 'pop_'
     OR p_gross_amount IS NULL
     OR p_gross_amount <= 0
     OR NULLIF(btrim(p_midtrans_transaction_id), '') IS NULL
     OR p_transaction_status IS NULL
     OR p_transaction_status NOT IN ('capture', 'settlement')
     OR NULLIF(btrim(p_payment_type), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_PREPAY_SETTLEMENT_INPUT';
  END IF;

  SELECT o.*
  INTO v_order
  FROM public.orders AS o
  WHERE o.midtrans_order_id = p_midtrans_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREPAY_ORDER_NOT_FOUND';
  END IF;

  IF v_order.prepay_checkout_key IS NULL
     OR COALESCE(v_order.qris_charged_idr, 0) <= 0
     OR v_order.qris_charged_idr <> p_gross_amount THEN
    RAISE EXCEPTION 'PREPAY_SETTLEMENT_MISMATCH';
  END IF;

  IF v_order.payment_status IS NULL
     OR v_order.payment_status NOT IN ('unpaid', 'paid') THEN
    RAISE EXCEPTION 'PREPAY_PAYMENT_STATE_INVALID';
  END IF;

  IF v_order.payment_status = 'unpaid'
     AND v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'PREPAY_SETTLEMENT_STATE_INVALID';
  END IF;

  v_was_paid := v_order.payment_status = 'paid';
  v_is_late_payment := v_order.payment_status = 'unpaid'
    AND v_order.prepay_released_at IS NOT NULL
    AND v_order.is_active IS FALSE;

  -- The order row lock serializes this function with release. If release won
  -- the race, record the verified cash event below and flag it for refund;
  -- never reactivate the order or silently consume the restored vouchers.
  IF NOT v_was_paid
     AND NOT v_is_late_payment
     AND (
       v_order.is_active IS DISTINCT FROM true
       OR v_order.prepay_released_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'PREPAY_SETTLEMENT_STATE_INVALID';
  END IF;

  IF v_was_paid AND v_order.prepay_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'PREPAY_PAID_RELEASE_STATE_INVALID';
  END IF;

  SELECT h.*
  INTO v_existing_settlement
  FROM public.hq_midtrans_settlements AS h
  WHERE h.midtrans_order_id = p_midtrans_order_id
  FOR UPDATE;

  IF FOUND THEN
    v_had_settlement := true;
    IF v_existing_settlement.source_type IS DISTINCT FROM 'prepay_order_qris'
       OR v_existing_settlement.gross_amount IS DISTINCT FROM p_gross_amount
       OR v_existing_settlement.order_id IS DISTINCT FROM v_order.id
       OR (
         v_existing_settlement.midtrans_transaction_id IS NOT NULL
         AND v_existing_settlement.midtrans_transaction_id <> p_midtrans_transaction_id
       ) THEN
      RAISE EXCEPTION 'PREPAY_SETTLEMENT_CONFLICT';
    END IF;

    UPDATE public.hq_midtrans_settlements AS h
    SET
      midtrans_transaction_id = COALESCE(h.midtrans_transaction_id, p_midtrans_transaction_id),
      transaction_status = COALESCE(h.transaction_status, p_transaction_status),
      payment_type = COALESCE(h.payment_type, p_payment_type),
      metadata = CASE
        WHEN v_is_late_payment THEN
          COALESCE(h.metadata, '{}'::jsonb) || jsonb_build_object(
            'late_payment_after_release', true,
            'requires_refund', true,
            'prepay_release_reason', v_order.prepay_release_reason,
            'prepay_released_at', v_order.prepay_released_at
          )
        ELSE h.metadata
      END,
      raw_notification = COALESCE(h.raw_notification, p_raw_notification),
      settled_at = COALESCE(h.settled_at, v_settled_at)
    WHERE h.id = v_existing_settlement.id;
  ELSE
    INSERT INTO public.hq_midtrans_settlements (
      midtrans_order_id,
      midtrans_transaction_id,
      gross_amount,
      currency,
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
    VALUES (
      p_midtrans_order_id,
      p_midtrans_transaction_id,
      p_gross_amount,
      'IDR',
      p_transaction_status,
      p_payment_type,
      'prepay_order_qris',
      v_order.customer_id,
      v_order.branch,
      v_order.id,
      NULL,
      jsonb_build_object(
        'prepay_checkout_key', v_order.prepay_checkout_key,
        'late_payment_after_release', v_is_late_payment,
        'requires_refund', v_is_late_payment,
        'prepay_release_reason', CASE
          WHEN v_is_late_payment THEN v_order.prepay_release_reason
          ELSE NULL
        END,
        'prepay_released_at', CASE
          WHEN v_is_late_payment THEN v_order.prepay_released_at
          ELSE NULL
        END
      ),
      p_raw_notification,
      v_settled_at
    );
  END IF;

  IF v_is_late_payment THEN
    RETURN jsonb_build_object(
      'settled', false,
      'late_payment', true,
      'requires_refund', true,
      'settlement_recorded', true,
      'order_id', v_order.id,
      'midtrans_order_id', p_midtrans_order_id,
      'gross_amount', p_gross_amount,
      'payment_status', v_order.payment_status,
      'release_reason', v_order.prepay_release_reason,
      'released_at', v_order.prepay_released_at
    );
  END IF;

  -- An already-paid order may later be made inactive by a legitimate customer
  -- cancellation. Repeated verified notifications remain idempotent and can
  -- also repair a missing HQ settlement row without reactivating the order.
  IF v_was_paid THEN
    RETURN jsonb_build_object(
      'settled', true,
      'already_settled', true,
      'hq_settlement_repaired', NOT v_had_settlement,
      'order_id', v_order.id,
      'midtrans_order_id', p_midtrans_order_id,
      'gross_amount', p_gross_amount,
      'payment_status', 'paid'
    );
  END IF;

  UPDATE public.orders AS o
  SET
    payment_status = 'paid',
    paid_date = COALESCE(o.paid_date, (v_settled_at AT TIME ZONE 'Asia/Jakarta')::date),
    payment_confirmation_type = COALESCE(o.payment_confirmation_type, 'qris'),
    updated_at = now()
  WHERE o.id = v_order.id
    AND o.is_active = true
    AND o.prepay_released_at IS NULL
    AND o.payment_status IN ('unpaid', 'paid');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREPAY_SETTLEMENT_STATE_CHANGED';
  END IF;

  RETURN jsonb_build_object(
    'settled', true,
    'already_settled', v_was_paid AND v_had_settlement,
    'order_id', v_order.id,
    'midtrans_order_id', p_midtrans_order_id,
    'gross_amount', p_gross_amount,
    'payment_status', 'paid'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_customer_prepay_checkout(
  uuid, uuid, date, text, jsonb, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_customer_prepay_checkout(
  uuid, uuid, date, text, jsonb, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.create_customer_prepay_checkout(
  uuid, uuid, date, text, jsonb, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_prepay_checkout(
  uuid, uuid, date, text, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.store_customer_prepay_snap_session(
  uuid, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_customer_prepay_snap_session(
  uuid, uuid, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.store_customer_prepay_snap_session(
  uuid, uuid, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.store_customer_prepay_snap_session(
  uuid, uuid, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.release_customer_prepay_checkout(
  uuid, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_customer_prepay_checkout(
  uuid, uuid, text
) FROM anon;
REVOKE ALL ON FUNCTION public.release_customer_prepay_checkout(
  uuid, uuid, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_customer_prepay_checkout(
  uuid, uuid, text
) TO service_role;

REVOKE ALL ON FUNCTION public.settle_customer_prepay_checkout(
  text, integer, text, text, text, jsonb, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_customer_prepay_checkout(
  text, integer, text, text, text, jsonb, timestamptz
) FROM anon;
REVOKE ALL ON FUNCTION public.settle_customer_prepay_checkout(
  text, integer, text, text, text, jsonb, timestamptz
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_customer_prepay_checkout(
  text, integer, text, text, text, jsonb, timestamptz
) TO service_role;

COMMENT ON FUNCTION public.create_customer_prepay_checkout(
  uuid, uuid, date, text, jsonb, jsonb
) IS
  'Atomically creates one idempotent pre-pay QRIS reservation, persists canonical order rows, deducts vouchers, and appends usage ledger rows.';

COMMENT ON FUNCTION public.store_customer_prepay_snap_session(
  uuid, uuid, text, text
) IS
  'Idempotently persists the Midtrans Snap token and optional redirect URL for a pre-pay checkout so response retries can recover the same session.';

COMMENT ON FUNCTION public.release_customer_prepay_checkout(
  uuid, uuid, text
) IS
  'Idempotently releases a verified unpaid pre-pay QRIS checkout, restores voucher balances, appends ledger reversals, and preserves the inactive order for audit.';

COMMENT ON FUNCTION public.settle_customer_prepay_checkout(
  text, integer, text, text, text, jsonb, timestamptz
) IS
  'Atomically settles a Midtrans-verified pre-pay QRIS checkout and writes its HQ settlement record; serializes with checkout release.';
