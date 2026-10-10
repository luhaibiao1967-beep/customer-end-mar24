-- Move staff order creation, correction, delivery, and cancellation behind
-- transaction-scoped SECURITY DEFINER RPCs.  Browser roles no longer receive
-- direct INSERT/DELETE access to orders or any mutation access to order_items.

BEGIN;

CREATE TABLE IF NOT EXISTS public.order_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  corrected_by uuid NOT NULL REFERENCES auth.users(id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  changes jsonb NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_corrections_order_id
  ON public.order_corrections(order_id);
CREATE INDEX IF NOT EXISTS idx_order_corrections_corrected_at
  ON public.order_corrections(corrected_at);
ALTER TABLE public.order_corrections ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.order_corrections TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.order_corrections TO service_role;

DROP POLICY IF EXISTS staff_read_order_corrections ON public.order_corrections;
CREATE POLICY staff_read_order_corrections
  ON public.order_corrections
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND public.current_staff_context()->>'status' = 'active'
    AND public.current_staff_context()->>'role' IN (
      'sales', 'operator', 'operator_manager', 'finance', 'admin', 'branch_admin'
    )
    AND EXISTS (
      SELECT 1
      FROM public.orders AS o
      WHERE o.id = order_corrections.order_id
        AND (
          public.current_staff_context()->>'role' = 'admin'
          OR (
            public.current_staff_context()->>'role' IN ('finance', 'operator_manager')
            AND public.current_staff_context()->>'branch' = 'All'
          )
          OR (
            public.current_staff_context()->>'branch' IS NOT NULL
            AND public.current_staff_context()->>'branch' <> 'All'
            AND o.branch = public.current_staff_context()->>'branch'
          )
        )
    )
  );

-- Some staff-side historical baselines never received the customer-app
-- cancellation migration.  Keep one canonical, service-only implementation in
-- this final boundary so the staff cancellation RPC has the same transactional
-- voucher-refund primitive on every supported baseline.
CREATE OR REPLACE FUNCTION public.cancel_customer_pending_order(
  p_customer_id uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_customer_type text;
  v_net_voucher_qty integer := 0;
  v_refunded_voucher_qty integer := 0;
BEGIN
  IF p_customer_id IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_IDENTITY_REQUIRED' USING ERRCODE = '22023';
  END IF;

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
  WHERE c.id = p_customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  -- A real cash settlement needs an external-provider refund and reconciliation.
  IF COALESCE(v_order.qris_charged_idr, 0) > 0
     OR v_order.midtrans_order_id IS NOT NULL
     OR (
       v_customer_type IS DISTINCT FROM 'pre_pay'
       AND v_order.payment_status = 'paid'
     ) THEN
    RAISE EXCEPTION 'PAYMENT_REFUND_REQUIRED';
  END IF;

  IF v_customer_type = 'pre_pay' THEN
    SELECT COALESCE(SUM(l.voucher_qty), 0)::integer
      INTO v_net_voucher_qty
    FROM public.voucher_usage_ledger AS l
    WHERE l.order_id = p_order_id
      AND l.customer_id = p_customer_id;
    IF v_net_voucher_qty <= 0 THEN
      RAISE EXCEPTION 'VOUCHER_USAGE_NOT_FOUND';
    END IF;

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
      customer_id,
      product_id,
      balance,
      gift_balance,
      updated_at
    )
    SELECT
      p_customer_id,
      net.product_id,
      net.total_qty,
      net.gift_qty,
      now()
    FROM net_by_product AS net
    ON CONFLICT (customer_id, product_id) DO UPDATE
    SET
      balance = cpv.balance + EXCLUDED.balance,
      gift_balance = cpv.gift_balance + EXCLUDED.gift_balance,
      updated_at = now();

    -- Append signed reversal rows; never delete financial history.
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
$$;

ALTER FUNCTION public.cancel_customer_pending_order(uuid, uuid)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_customer_pending_order(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_customer_pending_order(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.cancel_customer_pending_order(uuid, uuid) IS
  'Atomically soft-cancels a pending customer order. Voucher-only pre-pay orders restore balances and append signed ledger reversals; cash-settled orders are rejected.';

CREATE OR REPLACE FUNCTION public.normalize_staff_order_items(p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_element jsonb;
  v_quantity numeric;
  v_normalized jsonb;
BEGIN
  IF p_items IS NULL
     OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'INVALID_ORDER_ITEMS' USING ERRCODE = '22023';
  END IF;

  FOR v_element IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_element) <> 'object'
       OR NOT (v_element ? 'product_id')
       OR NOT (v_element ? 'quantity')
       OR (v_element - ARRAY['product_id', 'quantity']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(v_element -> 'product_id') <> 'string'
       OR (v_element ->> 'product_id')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_element -> 'quantity') <> 'number' THEN
      RAISE EXCEPTION 'INVALID_ORDER_ITEM' USING ERRCODE = '22023';
    END IF;

    v_quantity := (v_element ->> 'quantity')::numeric;
    IF v_quantity <> trunc(v_quantity)
       OR v_quantity <= 0
       OR v_quantity > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_ORDER_QUANTITY' USING ERRCODE = '22023';
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
    INTO v_normalized
  FROM (
    SELECT
      (e.value ->> 'product_id')::uuid AS product_id,
      SUM((e.value ->> 'quantity')::numeric)::integer AS quantity
    FROM jsonb_array_elements(p_items) AS e(value)
    GROUP BY (e.value ->> 'product_id')::uuid
  ) AS normalized;

  RETURN v_normalized;
END;
$$;

ALTER FUNCTION public.normalize_staff_order_items(jsonb) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.normalize_staff_order_items(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_order_actor_label()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    (
      SELECT COALESCE(
        NULLIF(to_jsonb(p)->>'name', ''),
        NULLIF(to_jsonb(p)->>'username', ''),
        NULLIF(to_jsonb(p)->>'email', '')
      )
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
      LIMIT 1
    ),
    auth.uid()::text
  );
$$;

ALTER FUNCTION public.staff_order_actor_label() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.staff_order_actor_label()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_staff_order_atomic(
  p_customer_id uuid,
  p_order_key uuid,
  p_delivery_date date,
  p_note text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_customer public.customers%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_existing public.orders%ROWTYPE;
  v_existing_json jsonb;
  v_existing_items jsonb;
  v_items jsonb;
  v_note text := NULLIF(btrim(p_note), '');
  v_result jsonb;
  v_order_id uuid;
  v_total bigint;
  v_jakarta_now timestamp;
  v_min_delivery_date date;
  v_closed_weekdays integer[] := '{}'::integer[];
  v_guard integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor IS NULL OR p_customer_id IS NULL OR p_order_key IS NULL THEN
    RAISE EXCEPTION 'STAFF_ORDER_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_date IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'ORDER_NOTE_TOO_LONG' USING ERRCODE = '22023';
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN ('sales', 'admin'), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_CREATE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_items := public.normalize_staff_order_items(p_items);

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
  IF v_customer.name IS NULL
     OR v_customer.address IS NULL
     OR v_customer.whatsapp IS NULL
     OR v_customer.branch IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_PROFILE_INCOMPLETE';
  END IF;
  IF v_role <> 'admin'
     AND (
       v_staff_branch IS NULL
       OR v_staff_branch = 'All'
       OR v_customer.branch IS DISTINCT FROM v_staff_branch
     ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_customer.customer_type::text = 'pre_pay' THEN
    v_result := public.create_customer_voucher_only_order(
      p_customer_id,
      p_order_key,
      p_delivery_date,
      v_note,
      v_items,
      v_items
    );
    v_order_id := (v_result->>'order_id')::uuid;

    SELECT o.*
      INTO v_existing
    FROM public.orders AS o
    WHERE o.id = v_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'STAFF_VOUCHER_ORDER_NOT_FOUND';
    END IF;
    IF COALESCE((v_result->>'created')::boolean, false) IS DISTINCT FROM true
       AND v_existing.created_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'STAFF_ORDER_KEY_CONFLICT';
    END IF;

    UPDATE public.orders
    SET
      created_by = v_actor,
      created_by_display = 'Sales',
      paid_date = COALESCE(paid_date, (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date),
      payment_confirmation_type = 'pre_pay',
      updated_at = now()
    WHERE id = v_order_id;

    RETURN v_result || jsonb_build_object(
      'order_id', v_order_id,
      'customer_type', 'pre_pay'
    );
  END IF;

  IF v_customer.customer_type::text IS DISTINCT FROM 'later_pay' THEN
    RAISE EXCEPTION 'UNSUPPORTED_CUSTOMER_TYPE';
  END IF;

  -- Resolve an identical retry before re-validating a delivery date that may
  -- have become historical since the first successful request.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('staff-order:' || p_order_key::text, 0)
  );

  SELECT o.*
    INTO v_existing
  FROM public.orders AS o
  WHERE o.id = p_order_key
  FOR UPDATE;

  IF FOUND THEN
    v_existing_json := to_jsonb(v_existing);
    SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'product_id', x.product_id,
                 'quantity', x.quantity
               )
               ORDER BY x.product_id::text
             ),
             '[]'::jsonb
           )
      INTO v_existing_items
    FROM (
      SELECT oi.product_id, SUM(oi.quantity)::integer AS quantity
      FROM public.order_items AS oi
      WHERE oi.order_id = v_existing.id
      GROUP BY oi.product_id
    ) AS x;

    IF v_existing.created_by IS DISTINCT FROM v_actor
       OR v_existing.customer_id IS DISTINCT FROM p_customer_id
       OR v_existing.delivery_date IS DISTINCT FROM p_delivery_date
       OR NULLIF(btrim(v_existing.note), '') IS DISTINCT FROM v_note
       OR v_existing_items IS DISTINCT FROM v_items
       OR v_existing.payment_status IS DISTINCT FROM 'unpaid'
       OR v_existing.is_active IS DISTINCT FROM true
       OR NULLIF(v_existing_json->>'voucher_order_key', '') IS NOT NULL
       OR NULLIF(v_existing_json->>'prepay_checkout_key', '') IS NOT NULL
       OR NULLIF(v_existing_json->>'midtrans_order_id', '') IS NOT NULL THEN
      RAISE EXCEPTION 'STAFF_ORDER_KEY_CONFLICT';
    END IF;

    RETURN jsonb_build_object(
      'created', false,
      'already_created', true,
      'order_id', v_existing.id,
      'total_amount', v_existing.total_amount,
      'payment_status', v_existing.payment_status,
      'customer_type', 'later_pay'
    );
  END IF;

  SELECT b.*
    INTO v_branch
  FROM public.branches AS b
  WHERE b.name = v_customer.branch;
  IF NOT FOUND OR v_branch.status IS DISTINCT FROM 'active' THEN
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
       OR (
         COALESCE(p.is_refill, false)
         AND (
           COALESCE(v_customer.discount, 0) < 0
           OR COALESCE(v_customer.discount, 0) > p.price
         )
       )
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_INACTIVE_PRODUCT';
  END IF;

  INSERT INTO public.orders (
    id,
    customer_id,
    customer_name,
    customer_address,
    customer_whatsapp,
    customer_discount,
    branch,
    total_amount,
    status,
    payment_status,
    delivery_date,
    note,
    created_by,
    created_by_display,
    is_active
  ) VALUES (
    p_order_key,
    v_customer.id,
    v_customer.name,
    v_customer.address,
    v_customer.whatsapp,
    COALESCE(v_customer.discount, 0),
    v_customer.branch,
    0,
    'pending',
    'unpaid',
    p_delivery_date,
    v_note,
    v_actor,
    'Sales',
    true
  );

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
    p_order_key,
    p.id,
    p.name,
    COALESCE(p.is_refill, false),
    i.quantity,
    p.price,
    CASE
      WHEN COALESCE(p.is_refill, false) THEN COALESCE(v_customer.discount, 0)
      ELSE 0
    END
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  JOIN public.products AS p ON p.id = i.product_id
  ORDER BY p.id;

  SELECT o.total_amount::bigint
    INTO v_total
  FROM public.orders AS o
  WHERE o.id = p_order_key;

  RETURN jsonb_build_object(
    'created', true,
    'already_created', false,
    'order_id', p_order_key,
    'total_amount', v_total,
    'payment_status', 'unpaid',
    'customer_type', 'later_pay'
  );
END;
$$;

ALTER FUNCTION public.create_staff_order_atomic(uuid, uuid, date, text, jsonb)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.create_staff_order_atomic(
  uuid, uuid, date, text, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_order_atomic(
  uuid, uuid, date, text, jsonb
) TO authenticated;

COMMENT ON FUNCTION public.create_staff_order_atomic(
  uuid, uuid, date, text, jsonb
) IS
  'Idempotently creates a staff order from catalog product ids. Pre-pay orders consume vouchers and write the ledger in the same transaction; later-pay prices and discounts are server-authored.';

CREATE OR REPLACE FUNCTION public.correct_staff_order_atomic(
  p_order_id uuid,
  p_customer_id uuid,
  p_delivery_date date,
  p_note text,
  p_empty_gallons_returned integer,
  p_items jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_order public.orders%ROWTYPE;
  v_order_json jsonb;
  v_customer public.customers%ROWTYPE;
  v_branch public.branches%ROWTYPE;
  v_items jsonb;
  v_note text := NULLIF(btrim(p_note), '');
  v_reason text := NULLIF(btrim(p_reason), '');
  v_before jsonb;
  v_total bigint;
  v_borrowed integer;
  v_jakarta_now timestamp;
  v_min_delivery_date date;
  v_closed_weekdays integer[] := '{}'::integer[];
  v_guard integer := 0;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor IS NULL OR p_order_id IS NULL OR p_customer_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_ORDER_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_delivery_date IS NULL THEN
    RAISE EXCEPTION 'DELIVERY_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_empty_gallons_returned, 0) < 0 THEN
    RAISE EXCEPTION 'ORDER_GALLON_COUNT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'ORDER_NOTE_TOO_LONG' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'ORDER_CORRECTION_REASON_TOO_LONG' USING ERRCODE = '22023';
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN ('sales', 'admin', 'branch_admin'), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_CORRECTION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_items := public.normalize_staff_order_items(p_items);

  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  v_order_json := to_jsonb(v_order);

  IF v_order.is_active IS DISTINCT FROM true
     OR v_order.payment_status IS DISTINCT FROM 'unpaid'
     OR v_order.status NOT IN ('pending', 'delivered')
     OR (v_role = 'sales' AND NOT (
       v_order.status = 'pending'
       OR (v_order.status = 'delivered' AND v_order.payment_status = 'unpaid')
     )) THEN
    RAISE EXCEPTION 'ORDER_CORRECTION_STATE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_role <> 'admin'
     AND (
       v_staff_branch IS NULL
       OR v_staff_branch = 'All'
       OR v_order.branch IS DISTINCT FROM v_staff_branch
     ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'sales' AND v_order.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'ORDER_CREATOR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF NULLIF(v_order_json->>'midtrans_order_id', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_checkout_key', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_request_hash', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_snap_token', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_snap_redirect_url', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_snap_created_at', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_released_at', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_release_reason', '') IS NOT NULL
     OR NULLIF(v_order_json->>'voucher_order_key', '') IS NOT NULL
     OR NULLIF(v_order_json->>'voucher_order_request_hash', '') IS NOT NULL
     OR NULLIF(v_order_json->'prepay_breakdown', 'null'::jsonb) IS NOT NULL
     OR COALESCE((v_order_json->>'qris_charged_idr')::numeric, 0) <> 0
     OR COALESCE((v_order_json->>'voucher_used')::numeric, 0) <> 0
     OR COALESCE((v_order_json->>'voucher_deduction')::numeric, 0) <> 0
     OR COALESCE(lower(NULLIF(v_order_json->>'payment_confirmation_type', '')), '')
          IN ('pre_pay', 'prepaid', 'qris', 'midtrans')
     OR EXISTS (
       SELECT 1 FROM public.voucher_usage_ledger AS l WHERE l.order_id = p_order_id
     ) THEN
    RAISE EXCEPTION 'ORDER_BACKEND_STATE_IMMUTABLE' USING ERRCODE = '42501';
  END IF;

  SELECT c.*
    INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_customer.is_active IS DISTINCT FROM true
     OR v_customer.customer_type::text IS DISTINCT FROM 'later_pay'
     OR v_customer.name IS NULL
     OR v_customer.address IS NULL
     OR v_customer.whatsapp IS NULL
     OR v_customer.branch IS NULL THEN
    RAISE EXCEPTION 'INVALID_CORRECTION_CUSTOMER';
  END IF;
  IF v_role <> 'admin' AND v_customer.branch IS DISTINCT FROM v_staff_branch THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT b.*
    INTO v_branch
  FROM public.branches AS b
  WHERE b.name = v_customer.branch;
  IF NOT FOUND OR v_branch.status IS DISTINCT FROM 'active' THEN
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
  IF p_delivery_date < v_min_delivery_date AND v_order.status <> 'delivered' THEN
    RAISE EXCEPTION 'DELIVERY_DATE_TOO_SOON';
  END IF;
  IF EXTRACT(DOW FROM p_delivery_date)::integer = ANY (v_closed_weekdays) THEN
    RAISE EXCEPTION 'DELIVERY_DATE_BRANCH_CLOSED';
  END IF;

  SELECT COALESCE(
           jsonb_agg(to_jsonb(oi) ORDER BY oi.id),
           '[]'::jsonb
         )
    INTO v_before
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id;

  IF v_customer.id = v_order.customer_id AND EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(v_before) AS old(
      product_id uuid,
      product text,
      is_refill boolean,
      unit_price integer,
      discount integer
    )
    JOIN jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
      ON i.product_id = old.product_id
    WHERE old.product IS NULL
       OR old.unit_price < 0
       OR COALESCE(old.discount, 0) < 0
       OR COALESCE(old.discount, 0) > old.unit_price
  ) THEN
    RAISE EXCEPTION 'ORDER_ITEM_SNAPSHOT_INVALID';
  END IF;
  IF v_customer.id = v_order.customer_id AND EXISTS (
    SELECT old.product_id
    FROM jsonb_to_recordset(v_before) AS old(
      product_id uuid,
      product text,
      is_refill boolean,
      unit_price integer,
      discount integer
    )
    JOIN jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
      ON i.product_id = old.product_id
    GROUP BY old.product_id
    HAVING COUNT(DISTINCT (
      old.product,
      old.is_refill,
      old.unit_price,
      COALESCE(old.discount, 0)
    )) > 1
  ) THEN
    RAISE EXCEPTION 'ORDER_ITEM_SNAPSHOT_AMBIGUOUS';
  END IF;

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
       OR (
         NOT (
           v_customer.id = v_order.customer_id
           AND EXISTS (
             SELECT 1
             FROM jsonb_to_recordset(v_before) AS old(product_id uuid)
             WHERE old.product_id = i.product_id
           )
         )
         AND (
           p.status IS DISTINCT FROM 'active'
           OR p.price < 0
           OR p.name IS NULL
           OR (
             COALESCE(p.is_refill, false)
             AND (
               COALESCE(v_customer.discount, 0) < 0
               OR COALESCE(v_customer.discount, 0) > p.price
             )
           )
         )
       )
  ) THEN
    RAISE EXCEPTION 'INVALID_OR_INACTIVE_PRODUCT';
  END IF;

  SELECT COALESCE(SUM(i.quantity) FILTER (
           WHERE COALESCE(old.is_refill, p.is_refill, false)
         ), 0)::integer
         - COALESCE(p_empty_gallons_returned, 0)
    INTO v_borrowed
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  JOIN public.products AS p ON p.id = i.product_id
  LEFT JOIN LATERAL (
    SELECT snapshot.is_refill
    FROM jsonb_to_recordset(v_before) AS snapshot(
      product_id uuid,
      is_refill boolean
    )
    WHERE v_customer.id = v_order.customer_id
      AND snapshot.product_id = i.product_id
    LIMIT 1
  ) AS old ON true;

  DELETE FROM public.order_items WHERE order_id = p_order_id;
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
    p_order_id,
    p.id,
    COALESCE(old.product, p.name),
    COALESCE(old.is_refill, p.is_refill, false),
    i.quantity,
    COALESCE(old.unit_price, p.price),
    CASE
      WHEN old.product_id IS NOT NULL THEN COALESCE(old.discount, 0)
      WHEN COALESCE(p.is_refill, false) THEN COALESCE(v_customer.discount, 0)
      ELSE 0
    END
  FROM jsonb_to_recordset(v_items) AS i(product_id uuid, quantity integer)
  JOIN public.products AS p ON p.id = i.product_id
  LEFT JOIN LATERAL (
    SELECT
      snapshot.product_id,
      snapshot.product,
      snapshot.is_refill,
      snapshot.unit_price,
      snapshot.discount
    FROM jsonb_to_recordset(v_before) AS snapshot(
      product_id uuid,
      product text,
      is_refill boolean,
      unit_price integer,
      discount integer
    )
    WHERE v_customer.id = v_order.customer_id
      AND snapshot.product_id = i.product_id
    LIMIT 1
  ) AS old ON true
  ORDER BY p.id;

  UPDATE public.orders
  SET
    customer_id = v_customer.id,
    customer_name = v_customer.name,
    customer_address = v_customer.address,
    customer_whatsapp = v_customer.whatsapp,
    customer_discount = CASE
      WHEN v_customer.id = v_order.customer_id THEN v_order.customer_discount
      ELSE COALESCE(v_customer.discount, 0)
    END,
    branch = v_customer.branch,
    delivery_date = p_delivery_date,
    note = v_note,
    empty_gallons_returned = COALESCE(p_empty_gallons_returned, 0),
    borrowed_gallons = v_borrowed,
    updated_at = now()
  WHERE id = p_order_id;

  IF to_regclass('public.order_corrections') IS NOT NULL THEN
    EXECUTE
      'INSERT INTO public.order_corrections '
      '(order_id, corrected_by, changes, reason) VALUES ($1, $2, $3, $4)'
    USING
      p_order_id,
      v_actor,
      jsonb_build_object(
        'before_order', to_jsonb(v_order),
        'before_items', v_before,
        'after_customer_id', v_customer.id,
        'after_delivery_date', p_delivery_date,
        'after_note', v_note,
        'after_empty_gallons_returned', COALESCE(p_empty_gallons_returned, 0),
        'after_borrowed_gallons', v_borrowed,
        'after_items', v_items
      ),
      v_reason;
  END IF;

  SELECT o.total_amount::bigint
    INTO v_total
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  RETURN jsonb_build_object(
    'corrected', true,
    'order_id', p_order_id,
    'total_amount', v_total,
    'borrowed_gallons', v_borrowed
  );
END;
$$;

ALTER FUNCTION public.correct_staff_order_atomic(
  uuid, uuid, date, text, integer, jsonb, text
) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.correct_staff_order_atomic(
  uuid, uuid, date, text, integer, jsonb, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_staff_order_atomic(
  uuid, uuid, date, text, integer, jsonb, text
) TO authenticated;

COMMENT ON FUNCTION public.correct_staff_order_atomic(
  uuid, uuid, date, text, integer, jsonb, text
) IS
  'Atomically corrects an unpaid non-backend order. Same-customer items keep their frozen price and discount; customer reassignment deliberately reprices every item from the current active catalog.';

CREATE OR REPLACE FUNCTION public.finalize_staff_order_delivery(
  p_order_id uuid,
  p_delivered_date date,
  p_delivery_evidence text,
  p_note text,
  p_empty_gallons_returned integer,
  p_actual_items jsonb,
  p_payment_received boolean DEFAULT false,
  p_payment_method text DEFAULT NULL,
  p_payment_evidence text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_label text;
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_order public.orders%ROWTYPE;
  v_order_json jsonb;
  v_customer_type text;
  v_element jsonb;
  v_quantity numeric;
  v_payload_count integer;
  v_item_count integer;
  v_updated_count integer;
  v_total bigint;
  v_total_quantity bigint;
  v_delivered_gallon_quantity bigint;
  v_all_items_catalog_free boolean;
  v_collection_only boolean;
  v_borrowed integer;
  v_backend_managed boolean;
  v_quantities_changed boolean;
  v_payment text;
  v_paid_date date;
  v_confirmation text;
  v_payment_evidence text;
  v_newly_paid boolean := false;
  v_note text := NULLIF(btrim(p_note), '');
  v_method text := lower(NULLIF(btrim(p_payment_method), ''));
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_ORDER_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_delivered_date IS NULL
     OR p_delivered_date > (clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'INVALID_DELIVERED_DATE' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_empty_gallons_returned, 0) < 0 THEN
    RAISE EXCEPTION 'ORDER_GALLON_COUNT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'ORDER_NOTE_TOO_LONG' USING ERRCODE = '22023';
  END IF;
  IF p_actual_items IS NULL
     OR jsonb_typeof(p_actual_items) <> 'array'
     OR jsonb_array_length(p_actual_items) = 0
     OR jsonb_array_length(p_actual_items) > 100 THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_ITEMS' USING ERRCODE = '22023';
  END IF;

  FOR v_element IN SELECT value FROM jsonb_array_elements(p_actual_items)
  LOOP
    IF jsonb_typeof(v_element) <> 'object'
       OR NOT (v_element ? 'item_id')
       OR NOT (v_element ? 'quantity')
       OR (v_element - ARRAY['item_id', 'quantity']::text[]) <> '{}'::jsonb
       OR jsonb_typeof(v_element -> 'item_id') <> 'string'
       OR (v_element ->> 'item_id')
            !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR jsonb_typeof(v_element -> 'quantity') <> 'number' THEN
      RAISE EXCEPTION 'INVALID_ACTUAL_ITEM' USING ERRCODE = '22023';
    END IF;
    v_quantity := (v_element ->> 'quantity')::numeric;
    IF v_quantity <> trunc(v_quantity)
       OR v_quantity < 0
       OR v_quantity > 2147483647 THEN
      RAISE EXCEPTION 'INVALID_ACTUAL_QUANTITY' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COUNT(*), COUNT(DISTINCT (e.value ->> 'item_id')::uuid)
    INTO v_payload_count, v_updated_count
  FROM jsonb_array_elements(p_actual_items) AS e(value);
  IF v_payload_count <> v_updated_count THEN
    RAISE EXCEPTION 'DUPLICATE_ACTUAL_ITEM' USING ERRCODE = '22023';
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN (
       'operator', 'operator_manager', 'admin', 'branch_admin'
     ), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_DELIVERY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  v_order_json := to_jsonb(v_order);

  IF v_role <> 'admin'
     AND NOT (
       v_role = 'operator_manager' AND v_staff_branch = 'All'
     )
     AND (
       v_staff_branch IS NULL
       OR v_staff_branch = 'All'
       OR v_order.branch IS DISTINCT FROM v_staff_branch
     ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_order.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ORDER_IS_INACTIVE';
  END IF;

  PERFORM oi.id
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id
  ORDER BY oi.id
  FOR UPDATE OF oi;

  SELECT COUNT(*)
    INTO v_item_count
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id;
  IF v_item_count = 0 OR v_item_count <> v_payload_count THEN
    RAISE EXCEPTION 'ACTUAL_ITEMS_MUST_MATCH_ORDER' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_actual_items) AS x(item_id uuid, quantity integer)
    FULL JOIN (
      SELECT scoped.*
      FROM public.order_items AS scoped
      WHERE scoped.order_id = p_order_id
    ) AS oi
      ON oi.id = x.item_id
    WHERE x.item_id IS NULL
       OR oi.id IS NULL
  ) THEN
    RAISE EXCEPTION 'ACTUAL_ITEMS_MUST_MATCH_ORDER' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.order_items AS oi
    WHERE oi.order_id = p_order_id
      AND (
        oi.product_id IS NULL
        OR NULLIF(btrim(oi.product), '') IS NULL
        OR oi.unit_price < 0
        OR COALESCE(oi.discount, 0) < 0
        OR COALESCE(oi.discount, 0) > oi.unit_price
      )
  ) THEN
    RAISE EXCEPTION 'ORDER_ITEM_SNAPSHOT_INVALID';
  END IF;

  SELECT COALESCE(
           bool_and(
             oi.is_refill IS NOT TRUE
             AND oi.unit_price = 0
             AND COALESCE(oi.discount, 0) = 0
             AND (
               lower(oi.product) LIKE '%empty%'
               OR lower(oi.product) LIKE '%collection%'
             )
           ),
           false
         )
    INTO v_collection_only
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id;

  SELECT c.customer_type::text
    INTO v_customer_type
  FROM public.customers AS c
  WHERE c.id = v_order.customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;

  v_backend_managed :=
    NULLIF(v_order_json->>'midtrans_order_id', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_checkout_key', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_request_hash', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_snap_token', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_snap_redirect_url', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_snap_created_at', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_released_at', '') IS NOT NULL
    OR NULLIF(v_order_json->>'prepay_release_reason', '') IS NOT NULL
    OR NULLIF(v_order_json->>'voucher_order_key', '') IS NOT NULL
    OR NULLIF(v_order_json->>'voucher_order_request_hash', '') IS NOT NULL
    OR NULLIF(v_order_json->'prepay_breakdown', 'null'::jsonb) IS NOT NULL
    OR COALESCE((v_order_json->>'qris_charged_idr')::numeric, 0) <> 0
    OR COALESCE((v_order_json->>'voucher_used')::numeric, 0) <> 0
    OR COALESCE((v_order_json->>'voucher_deduction')::numeric, 0) <> 0
    OR COALESCE(lower(NULLIF(v_order_json->>'payment_confirmation_type', '')), '')
         IN ('pre_pay', 'prepaid', 'qris', 'midtrans')
    OR EXISTS (
      SELECT 1 FROM public.voucher_usage_ledger AS l WHERE l.order_id = p_order_id
    );

  SELECT EXISTS (
    SELECT 1
    FROM public.order_items AS oi
    JOIN jsonb_to_recordset(p_actual_items) AS x(item_id uuid, quantity integer)
      ON x.item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.quantity IS DISTINCT FROM x.quantity
  ) INTO v_quantities_changed;

  IF (v_backend_managed OR v_order.payment_status = 'paid')
     AND v_quantities_changed THEN
    RAISE EXCEPTION 'PAID_ORDER_QUANTITY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF NOT v_collection_only AND EXISTS (
    SELECT 1
    FROM public.order_items AS oi
    JOIN jsonb_to_recordset(p_actual_items) AS x(item_id uuid, quantity integer)
      ON x.item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.is_refill IS NOT TRUE
      AND oi.quantity IS DISTINCT FROM x.quantity
  ) THEN
    RAISE EXCEPTION 'NON_REFILL_DELIVERY_QUANTITY_IMMUTABLE' USING ERRCODE = '42501';
  END IF;
  IF v_collection_only AND (
    SELECT COALESCE(SUM(x.quantity::bigint), 0)
    FROM jsonb_to_recordset(p_actual_items) AS x(item_id uuid, quantity integer)
  ) <> COALESCE(p_empty_gallons_returned, 0)::bigint THEN
    RAISE EXCEPTION 'COLLECTION_COUNT_MISMATCH' USING ERRCODE = '22023';
  END IF;
  IF v_backend_managed
     AND (v_order.payment_status IS DISTINCT FROM 'paid' OR COALESCE(p_payment_received, false)) THEN
    RAISE EXCEPTION 'BACKEND_PAYMENT_STATE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_payment_received, false)
     AND v_role NOT IN ('operator', 'operator_manager', 'admin') THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_ROLE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_payment_received, false)
     AND (
       v_method NOT IN ('cash', 'transfer')
       OR (v_method = 'transfer' AND NULLIF(btrim(p_payment_evidence), '') IS NULL)
     ) THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_PAYMENT' USING ERRCODE = '22023';
  END IF;

  IF v_order.status = 'delivered' THEN
    IF v_quantities_changed THEN
      RAISE EXCEPTION 'ORDER_ALREADY_DELIVERED' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
      'delivered', true,
      'already_delivered', true,
      'order_id', p_order_id,
      'total_amount', v_order.total_amount,
      'payment_status', v_order.payment_status
    );
  END IF;
  IF v_order.status NOT IN ('pending', 'scheduled') THEN
    RAISE EXCEPTION 'ORDER_DELIVERY_STATE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.order_items AS oi
  SET quantity = x.quantity
  FROM jsonb_to_recordset(p_actual_items) AS x(item_id uuid, quantity integer)
  WHERE oi.id = x.item_id
    AND oi.order_id = p_order_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_item_count THEN
    RAISE EXCEPTION 'ACTUAL_ITEM_UPDATE_FAILED';
  END IF;

  SELECT
    COALESCE(SUM(
      (oi.unit_price::bigint - COALESCE(oi.discount, 0)::bigint)
      * oi.quantity::bigint
    ), 0),
    COALESCE(SUM(oi.quantity::bigint), 0),
    COALESCE(SUM(oi.quantity::bigint) FILTER (
      WHERE oi.is_refill IS TRUE
         OR (
           oi.is_refill IS NOT TRUE
           AND oi.unit_price = 0
           AND COALESCE(oi.discount, 0) = 0
           AND lower(oi.product) LIKE '%gallon%'
           AND lower(oi.product) NOT LIKE '%empty%'
           AND lower(oi.product) NOT LIKE '%collection%'
         )
    ), 0),
    COALESCE(bool_and(oi.unit_price = 0 AND COALESCE(oi.discount, 0) = 0), false)
  INTO v_total, v_total_quantity, v_delivered_gallon_quantity, v_all_items_catalog_free
  FROM public.order_items AS oi
  WHERE oi.order_id = p_order_id;

  IF v_total_quantity <= 0 THEN
    RAISE EXCEPTION 'DELIVERED_ORDER_REQUIRES_POSITIVE_QUANTITY';
  END IF;
  IF v_total < 0 OR v_total > 2147483647
     OR v_delivered_gallon_quantity - COALESCE(p_empty_gallons_returned, 0) < -2147483648
     OR v_delivered_gallon_quantity - COALESCE(p_empty_gallons_returned, 0) > 2147483647 THEN
    RAISE EXCEPTION 'DELIVERY_VALUE_OUT_OF_RANGE';
  END IF;
  v_borrowed := (
    v_delivered_gallon_quantity - COALESCE(p_empty_gallons_returned, 0)
  )::integer;

  v_payment := v_order.payment_status;
  v_paid_date := v_order.paid_date;
  v_confirmation := v_order.payment_confirmation_type;
  v_payment_evidence := v_order.payment_evidence;

  IF NOT v_backend_managed AND v_order.payment_status = 'unpaid' THEN
    IF v_customer_type IS DISTINCT FROM 'later_pay' THEN
      RAISE EXCEPTION 'UNPAID_PREPAY_ORDER_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
    IF v_total = 0 THEN
      IF v_all_items_catalog_free IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'ZERO_TOTAL_REQUIRES_FREE_CATALOG_ITEMS';
      END IF;
      v_payment := 'paid';
      v_paid_date := p_delivered_date;
      v_confirmation := NULL;
      v_payment_evidence := NULL;
      v_newly_paid := true;
    ELSIF COALESCE(p_payment_received, false) THEN
      v_payment := 'paid';
      v_paid_date := p_delivered_date;
      v_confirmation := v_method;
      v_payment_evidence := CASE
        WHEN v_method = 'transfer' THEN NULLIF(btrim(p_payment_evidence), '')
        ELSE NULL
      END;
      v_newly_paid := true;
    END IF;
  ELSIF COALESCE(p_payment_received, false) THEN
    RAISE EXCEPTION 'ORDER_PAYMENT_ALREADY_FINAL' USING ERRCODE = '42501';
  END IF;

  v_actor_label := public.staff_order_actor_label();
  UPDATE public.orders
  SET
    status = 'delivered',
    delivered_date = p_delivered_date,
    delivery_evidence = NULLIF(btrim(p_delivery_evidence), ''),
    note = v_note,
    empty_gallons_returned = COALESCE(p_empty_gallons_returned, 0),
    borrowed_gallons = v_borrowed,
    total_amount = v_total::integer,
    payment_status = v_payment,
    paid_date = v_paid_date,
    payment_confirmation_type = v_confirmation,
    payment_evidence = v_payment_evidence,
    updated_at = now()
  WHERE id = p_order_id;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.orders'::regclass
      AND attname = 'delivered_by'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    EXECUTE 'UPDATE public.orders SET delivered_by = $1 WHERE id = $2'
      USING v_actor_label, p_order_id;
  END IF;
  IF v_newly_paid AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.orders'::regclass
      AND attname = 'payment_confirmed_by'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    EXECUTE 'UPDATE public.orders SET payment_confirmed_by = $1 WHERE id = $2'
      USING v_actor_label, p_order_id;
  END IF;

  RETURN jsonb_build_object(
    'delivered', true,
    'already_delivered', false,
    'order_id', p_order_id,
    'total_amount', v_total,
    'payment_status', v_payment,
    'borrowed_gallons', v_borrowed
  );
END;
$$;

ALTER FUNCTION public.finalize_staff_order_delivery(
  uuid, date, text, text, integer, jsonb, boolean, text, text
) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_staff_order_delivery(
  uuid, date, text, text, integer, jsonb, boolean, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_staff_order_delivery(
  uuid, date, text, text, integer, jsonb, boolean, text, text
) TO authenticated;

COMMENT ON FUNCTION public.finalize_staff_order_delivery(
  uuid, date, text, text, integer, jsonb, boolean, text, text
) IS
  'Atomically records exact delivered quantities, recomputes the trusted total, records an optional later-pay settlement, and finalizes delivery.';

CREATE OR REPLACE FUNCTION public.cancel_staff_order_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_order public.orders%ROWTYPE;
  v_order_json jsonb;
  v_has_ledger boolean;
  v_is_voucher_order boolean;
  v_result jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_ORDER_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN ('sales', 'admin', 'branch_admin'), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_CANCEL_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'cancelled', true,
      'already_absent', true,
      'order_id', p_order_id
    );
  END IF;
  v_order_json := to_jsonb(v_order);

  IF v_role <> 'admin'
     AND (
       v_staff_branch IS NULL
       OR v_staff_branch = 'All'
       OR v_order.branch IS DISTINCT FROM v_staff_branch
     ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  IF v_role = 'sales' AND v_order.created_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'ORDER_CREATOR_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.voucher_usage_ledger AS l WHERE l.order_id = p_order_id
  ) INTO v_has_ledger;
  v_is_voucher_order :=
    NULLIF(v_order_json->>'voucher_order_key', '') IS NOT NULL
    OR NULLIF(v_order_json->>'voucher_order_request_hash', '') IS NOT NULL
    OR v_has_ledger;

  IF v_order.is_active IS DISTINCT FROM true THEN
    IF v_is_voucher_order THEN
      RETURN jsonb_build_object(
        'cancelled', true,
        'already_cancelled', true,
        'order_id', p_order_id
      );
    END IF;
    RAISE EXCEPTION 'ORDER_IS_INACTIVE';
  END IF;

  IF v_is_voucher_order THEN
    IF v_order.status IS DISTINCT FROM 'pending' THEN
      RAISE EXCEPTION 'ONLY_PENDING_VOUCHER_ORDERS_CAN_BE_CANCELLED';
    END IF;
    v_result := public.cancel_customer_pending_order(
      v_order.customer_id,
      p_order_id
    );
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.orders'::regclass
        AND attname = 'inactivated_by'
        AND attnum > 0
        AND NOT attisdropped
    ) THEN
      EXECUTE 'UPDATE public.orders SET inactivated_by = $1 WHERE id = $2'
        USING v_actor, p_order_id;
    END IF;
    RETURN v_result || jsonb_build_object('mode', 'voucher_refund');
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending'
     OR v_order.payment_status IS DISTINCT FROM 'unpaid'
     OR NULLIF(v_order_json->>'midtrans_order_id', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_checkout_key', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_request_hash', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_snap_token', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_snap_redirect_url', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_snap_created_at', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_released_at', '') IS NOT NULL
     OR NULLIF(v_order_json->>'prepay_release_reason', '') IS NOT NULL
     OR NULLIF(v_order_json->'prepay_breakdown', 'null'::jsonb) IS NOT NULL
     OR COALESCE((v_order_json->>'qris_charged_idr')::numeric, 0) <> 0
     OR COALESCE((v_order_json->>'voucher_used')::numeric, 0) <> 0
     OR COALESCE((v_order_json->>'voucher_deduction')::numeric, 0) <> 0
     OR COALESCE(lower(NULLIF(v_order_json->>'payment_confirmation_type', '')), '')
          IN ('pre_pay', 'prepaid', 'qris', 'midtrans') THEN
    RAISE EXCEPTION 'ORDER_CANCEL_REQUIRES_FINANCIAL_REVERSAL' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders
  SET
    is_active = false,
    inactivated_at = now(),
    updated_at = now()
  WHERE id = p_order_id
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_DEACTIVATION_FAILED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.orders'::regclass
      AND attname = 'inactivated_by'
      AND attnum > 0
      AND NOT attisdropped
  ) THEN
    EXECUTE 'UPDATE public.orders SET inactivated_by = $1 WHERE id = $2'
      USING v_actor, p_order_id;
  END IF;
  RETURN jsonb_build_object(
    'cancelled', true,
    'deleted', false,
    'order_id', p_order_id,
    'mode', 'soft_cancel_unpaid'
  );
END;
$$;

ALTER FUNCTION public.cancel_staff_order_atomic(uuid) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_staff_order_atomic(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_staff_order_atomic(uuid)
  TO authenticated;

COMMENT ON FUNCTION public.cancel_staff_order_atomic(uuid) IS
  'Atomically soft-cancels a staff-owned order. Voucher orders are refunded through signed ledger reversals; ordinary unpaid orders are retained for audit.';

-- Direct browser mutation is now deliberately narrow: SELECT plus the guarded
-- order UPDATE paths used for scheduling, post-delivery receivables, and
-- explicit soft inactivation.  All financial/item/order creation mutations go
-- through the RPCs above.
DO $lockdown$
DECLARE
  v_order_columns text;
  v_item_columns text;
  v_correction_columns text;
BEGIN
  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_order_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.orders'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped;

  SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_item_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.order_items'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped;

  REVOKE INSERT, DELETE ON TABLE public.orders FROM PUBLIC, anon, authenticated;
  REVOKE INSERT, UPDATE, DELETE ON TABLE public.order_items
    FROM PUBLIC, anon, authenticated;

  IF v_order_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%s) ON TABLE public.orders FROM PUBLIC, anon, authenticated',
      v_order_columns
    );
  END IF;
  IF v_item_columns IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT, UPDATE (%s) ON TABLE public.order_items FROM PUBLIC, anon, authenticated',
      v_item_columns
    );
  END IF;

  IF to_regclass('public.order_corrections') IS NOT NULL THEN
    EXECUTE 'REVOKE INSERT ON TABLE public.order_corrections FROM PUBLIC, anon, authenticated';
    SELECT string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY a.attnum)
      INTO v_correction_columns
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.order_corrections'::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF v_correction_columns IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT (%s) ON TABLE public.order_corrections FROM PUBLIC, anon, authenticated',
        v_correction_columns
      );
    END IF;
  END IF;
END;
$lockdown$;

DROP POLICY IF EXISTS staff_insert_orders ON public.orders;
DROP POLICY IF EXISTS staff_delete_orders ON public.orders;
DROP POLICY IF EXISTS staff_insert_order_items ON public.order_items;
DROP POLICY IF EXISTS staff_update_order_items ON public.order_items;
DROP POLICY IF EXISTS staff_delete_order_items ON public.order_items;

DO $drop_correction_insert_policy$
BEGIN
  IF to_regclass('public.order_corrections') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS staff_insert_order_corrections ON public.order_corrections';
  END IF;
END;
$drop_correction_insert_policy$;

COMMIT;
