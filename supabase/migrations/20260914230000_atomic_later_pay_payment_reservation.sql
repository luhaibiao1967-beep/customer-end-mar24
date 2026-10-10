-- Atomically reserve, finalize, release, and settle later-pay Midtrans batches.
-- The network call remains in Edge Functions, but every local transition is a
-- service-role-only transaction over an immutable order/amount snapshot.

BEGIN;

CREATE TABLE IF NOT EXISTS public.later_pay_payment_reservations (
  payment_key uuid PRIMARY KEY,
  customer_id uuid NOT NULL
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  midtrans_order_id text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  payment_rail text NOT NULL,
  gross_amount integer NOT NULL,
  state text NOT NULL DEFAULT 'reserved',
  snap_token text,
  snap_redirect_url text,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  released_at timestamptz,
  release_reason text,
  settled_at timestamptz,
  provider_transaction_id text,
  provider_transaction_status text,
  provider_payment_type text,
  provider_gross_amount integer,
  provider_payload jsonb,
  late_payment_detected_at timestamptz,
  legacy_imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT later_pay_payment_request_hash_check CHECK (
    request_hash ~ '^[0-9a-f]{32}$'
  ),
  CONSTRAINT later_pay_payment_midtrans_id_check CHECK (
    left(midtrans_order_id, 3) = 'op_'
    AND (
      legacy_imported
      OR midtrans_order_id = 'op_' || replace(payment_key::text, '-', '')
    )
  ),
  CONSTRAINT later_pay_payment_rail_check CHECK (
    payment_rail = 'other_qris'
  ),
  CONSTRAINT later_pay_payment_gross_check CHECK (
    gross_amount > 0
    AND (provider_gross_amount IS NULL OR provider_gross_amount > 0)
  ),
  CONSTRAINT later_pay_payment_state_check CHECK (
    state IN ('reserved', 'ready', 'released', 'settled')
  ),
  CONSTRAINT later_pay_payment_snap_check CHECK (
    snap_token IS NULL
    OR (
      btrim(snap_token) <> ''
      AND length(snap_token) <= 4096
      AND finalized_at IS NOT NULL
      AND state IN ('ready', 'released', 'settled')
    )
  ),
  CONSTRAINT later_pay_payment_redirect_check CHECK (
    snap_redirect_url IS NULL
    OR (
      snap_token IS NOT NULL
      AND btrim(snap_redirect_url) <> ''
      AND length(snap_redirect_url) <= 8192
    )
  ),
  CONSTRAINT later_pay_payment_release_check CHECK (
    (state <> 'released' AND released_at IS NULL AND release_reason IS NULL)
    OR (
      state = 'released'
      AND released_at IS NOT NULL
      AND release_reason IN (
        'snap_create_failed',
        'payment_expired',
        'payment_cancelled',
        'payment_denied',
        'payment_failed'
      )
    )
  ),
  CONSTRAINT later_pay_payment_settlement_check CHECK (
    (state <> 'settled' AND settled_at IS NULL)
    OR (
      state = 'settled'
      AND settled_at IS NOT NULL
      AND provider_gross_amount = gross_amount
      AND provider_transaction_status IN ('settlement', 'capture')
    )
  ),
  CONSTRAINT later_pay_payment_provider_payload_check CHECK (
    provider_payload IS NULL OR jsonb_typeof(provider_payload) = 'object'
  )
);

CREATE TABLE IF NOT EXISTS public.later_pay_payment_reservation_orders (
  payment_key uuid NOT NULL
    REFERENCES public.later_pay_payment_reservations(payment_key)
    ON DELETE RESTRICT,
  order_id uuid NOT NULL
    REFERENCES public.orders(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL,
  amount_idr integer NOT NULL,
  branch text NOT NULL,
  is_open boolean NOT NULL DEFAULT true,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_key, order_id),
  UNIQUE (payment_key, ordinal),
  CONSTRAINT later_pay_payment_member_ordinal_check CHECK (ordinal > 0),
  CONSTRAINT later_pay_payment_member_amount_check CHECK (amount_idr > 0),
  CONSTRAINT later_pay_payment_member_open_check CHECK (
    (is_open AND closed_at IS NULL)
    OR (NOT is_open AND closed_at IS NOT NULL)
  )
);

-- One unresolved provider attempt may own an order at a time. Historical
-- released/settled memberships remain immutable for late-callback forensics.
CREATE UNIQUE INDEX IF NOT EXISTS later_pay_payment_one_open_attempt_per_order
  ON public.later_pay_payment_reservation_orders (order_id)
  WHERE is_open;

CREATE INDEX IF NOT EXISTS later_pay_payment_reservations_customer_idx
  ON public.later_pay_payment_reservations (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS later_pay_payment_members_customer_idx
  ON public.later_pay_payment_reservation_orders (customer_id, order_id);

ALTER TABLE public.later_pay_payment_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.later_pay_payment_reservation_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.later_pay_payment_reservations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON TABLE public.later_pay_payment_reservation_orders
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.later_pay_payment_reservations TO service_role;
GRANT SELECT ON TABLE public.later_pay_payment_reservation_orders TO service_role;

-- Refuse to guess at an unsafe pre-migration op_* group. Clean-up/reconcile it
-- explicitly before applying this migration instead of silently retagging it.
DO $legacy_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders AS o
    JOIN public.customers AS c ON c.id = o.customer_id
    WHERE left(COALESCE(o.midtrans_order_id, ''), 3) = 'op_'
    GROUP BY o.midtrans_order_id
    HAVING bool_or(o.payment_status = 'unpaid')
       AND NOT (
         count(DISTINCT o.customer_id) = 1
         AND bool_and(o.payment_status = 'unpaid')
         AND bool_and(o.is_active IS TRUE)
         AND bool_and(o.status IN ('pending', 'scheduled', 'delivered'))
         AND bool_and(o.total_amount > 0)
         AND bool_and(c.customer_type::text = 'later_pay')
         AND bool_and(COALESCE(o.qris_charged_idr, 0) = 0)
         AND bool_and(o.prepay_checkout_key IS NULL)
       )
  ) THEN
    RAISE EXCEPTION 'UNSAFE_LEGACY_LATER_PAY_PAYMENT_GROUP';
  END IF;
END;
$legacy_preflight$;

-- Preserve valid unresolved op_* groups created immediately before deployment.
-- The original Snap token was never stored locally, so these rows are marked
-- legacy and may settle/release but are never used to create another provider
-- transaction automatically.
WITH legacy_groups AS (
  SELECT
    o.midtrans_order_id,
    (array_agg(o.customer_id ORDER BY o.customer_id::text))[1] AS customer_id,
    sum(o.total_amount)::integer AS gross_amount,
    (md5('legacy-later-pay:' || o.midtrans_order_id))::uuid AS payment_key
  FROM public.orders AS o
  JOIN public.customers AS c ON c.id = o.customer_id
  WHERE left(COALESCE(o.midtrans_order_id, ''), 3) = 'op_'
  GROUP BY o.midtrans_order_id
  HAVING count(DISTINCT o.customer_id) = 1
     AND bool_and(o.payment_status = 'unpaid')
     AND bool_and(o.is_active IS TRUE)
     AND bool_and(o.status IN ('pending', 'scheduled', 'delivered'))
     AND bool_and(o.total_amount > 0)
     AND bool_and(c.customer_type::text = 'later_pay')
     AND bool_and(COALESCE(o.qris_charged_idr, 0) = 0)
     AND bool_and(o.prepay_checkout_key IS NULL)
), inserted_legacy AS (
  INSERT INTO public.later_pay_payment_reservations (
    payment_key,
    customer_id,
    midtrans_order_id,
    request_hash,
    payment_rail,
    gross_amount,
    state,
    finalized_at,
    legacy_imported
  )
  SELECT
    g.payment_key,
    g.customer_id,
    g.midtrans_order_id,
    md5(jsonb_build_object(
      'customer_id', g.customer_id,
      'midtrans_order_id', g.midtrans_order_id,
      'gross_amount', g.gross_amount,
      'legacy_imported', true
    )::text),
    'other_qris',
    g.gross_amount,
    'ready',
    now(),
    true
  FROM legacy_groups AS g
  ON CONFLICT DO NOTHING
  RETURNING payment_key, midtrans_order_id, customer_id
)
INSERT INTO public.later_pay_payment_reservation_orders (
  payment_key,
  order_id,
  customer_id,
  ordinal,
  amount_idr,
  branch,
  is_open
)
SELECT
  i.payment_key,
  o.id,
  o.customer_id,
  row_number() OVER (
    PARTITION BY i.payment_key ORDER BY o.id::text
  )::integer,
  o.total_amount,
  o.branch,
  true
FROM inserted_legacy AS i
JOIN public.orders AS o
  ON o.midtrans_order_id = i.midtrans_order_id;

-- Internal assertion used only by the four service RPCs below. Its caller must
-- already hold the common customer advisory lock and the reservation row lock.
CREATE OR REPLACE FUNCTION public.assert_later_pay_payment_orders(
  p_payment_key uuid,
  p_customer_id uuid,
  p_midtrans_order_id text,
  p_required_payment_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_order_ids uuid[];
  v_allocations jsonb;
  v_member_count integer;
  v_order_count integer;
  v_gross bigint;
BEGIN
  IF p_required_payment_status NOT IN ('unpaid', 'paid') THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_ASSERTION';
  END IF;

  PERFORM m.order_id
  FROM public.later_pay_payment_reservation_orders AS m
  WHERE m.payment_key = p_payment_key
  ORDER BY m.ordinal
  FOR UPDATE;

  SELECT
    count(*)::integer,
    array_agg(m.order_id ORDER BY m.ordinal),
    COALESCE(sum(m.amount_idr), 0)::bigint,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'order_id', m.order_id,
        'customer_id', m.customer_id,
        'branch', m.branch,
        'amount_idr', m.amount_idr
      ) ORDER BY m.ordinal
    ), '[]'::jsonb)
  INTO v_member_count, v_order_ids, v_gross, v_allocations
  FROM public.later_pay_payment_reservation_orders AS m
  WHERE m.payment_key = p_payment_key;

  IF v_member_count < 1 OR v_member_count > 100 THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_MEMBERSHIP_INVALID';
  END IF;

  PERFORM o.id
  FROM public.orders AS o
  WHERE o.id = ANY(v_order_ids)
  ORDER BY o.id::text
  FOR UPDATE;

  SELECT count(*)::integer
  INTO v_order_count
  FROM public.orders AS o
  JOIN public.later_pay_payment_reservation_orders AS m
    ON m.order_id = o.id
   AND m.payment_key = p_payment_key
  WHERE o.id = ANY(v_order_ids)
    AND o.customer_id = p_customer_id
    AND m.customer_id = p_customer_id
    AND o.is_active IS TRUE
    AND o.status IN ('pending', 'scheduled', 'delivered')
    AND o.payment_status = p_required_payment_status
    AND o.midtrans_order_id = p_midtrans_order_id
    AND o.total_amount = m.amount_idr
    AND o.branch IS NOT DISTINCT FROM m.branch
    AND COALESCE(o.qris_charged_idr, 0) = 0
    AND o.prepay_checkout_key IS NULL;

  IF v_order_count <> v_member_count THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_ORDER_STATE_CHANGED'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'order_ids', to_jsonb(v_order_ids),
    'order_allocations', v_allocations,
    'gross_amount', v_gross
  );
END;
$function$;

ALTER FUNCTION public.assert_later_pay_payment_orders(uuid, uuid, text, text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.assert_later_pay_payment_orders(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_customer_later_pay_payment(
  p_customer_id uuid,
  p_payment_key uuid,
  p_order_ids uuid[],
  p_expected_amount integer,
  p_payment_rail text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_reservation public.later_pay_payment_reservations%ROWTYPE;
  v_order_ids uuid[];
  v_midtrans_order_id text;
  v_request_hash text;
  v_order_count integer;
  v_valid_count integer;
  v_updated_count integer;
  v_gross bigint;
  v_allocations jsonb;
  v_snapshot jsonb;
  v_created boolean := false;
  v_payment_status text;
BEGIN
  IF p_customer_id IS NULL OR p_payment_key IS NULL THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_IDENTITY_REQUIRED';
  END IF;
  IF COALESCE(cardinality(p_order_ids), 0) < 1
     OR cardinality(p_order_ids) > 100
     OR array_position(p_order_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_ORDER_IDS';
  END IF;
  IF (SELECT count(*) FROM unnest(p_order_ids) AS x(id))
     <> (SELECT count(DISTINCT x.id) FROM unnest(p_order_ids) AS x(id)) THEN
    RAISE EXCEPTION 'DUPLICATE_LATER_PAY_PAYMENT_ORDER_ID';
  END IF;
  IF p_expected_amount IS NULL OR p_expected_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_EXPECTED_AMOUNT';
  END IF;
  IF p_payment_rail IS DISTINCT FROM 'other_qris' THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_RAIL';
  END IF;

  SELECT array_agg(x.id ORDER BY x.id::text)
  INTO v_order_ids
  FROM unnest(p_order_ids) AS x(id);

  v_midtrans_order_id := 'op_' || replace(p_payment_key::text, '-', '');
  v_request_hash := md5(jsonb_build_object(
    'customer_id', p_customer_id,
    'order_ids', to_jsonb(v_order_ids),
    'expected_amount', p_expected_amount,
    'payment_rail', p_payment_rail
  )::text);

  -- This exact namespace/order is shared by every customer-order workflow.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

  SELECT c.*
  INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  IF v_customer.is_active IS DISTINCT FROM true
     OR v_customer.customer_type::text IS DISTINCT FROM 'later_pay' THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_ELIGIBLE_FOR_LATER_PAY_PAYMENT';
  END IF;

  SELECT r.*
  INTO v_reservation
  FROM public.later_pay_payment_reservations AS r
  WHERE r.payment_key = p_payment_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_reservation.customer_id <> p_customer_id
       OR v_reservation.midtrans_order_id <> v_midtrans_order_id
       OR v_reservation.request_hash <> v_request_hash
       OR v_reservation.gross_amount <> p_expected_amount
       OR v_reservation.payment_rail <> p_payment_rail THEN
      RAISE EXCEPTION 'LATER_PAY_PAYMENT_KEY_REUSE_MISMATCH'
        USING ERRCODE = '22023';
    END IF;

    IF v_reservation.state = 'released' THEN
      RETURN jsonb_build_object(
        'reserved', false,
        'released', true,
        'payment_disposition', 'discard_key',
        'payment_key', v_reservation.payment_key,
        'midtrans_order_id', v_reservation.midtrans_order_id,
        'gross_amount', v_reservation.gross_amount,
        'release_reason', v_reservation.release_reason,
        'released_at', v_reservation.released_at
      );
    END IF;

    v_payment_status := CASE
      WHEN v_reservation.state = 'settled' THEN 'paid'
      ELSE 'unpaid'
    END;
    v_snapshot := public.assert_later_pay_payment_orders(
      p_payment_key,
      p_customer_id,
      v_midtrans_order_id,
      v_payment_status
    );
    IF (v_snapshot ->> 'gross_amount')::bigint <> v_reservation.gross_amount THEN
      RAISE EXCEPTION 'LATER_PAY_PAYMENT_SNAPSHOT_AMOUNT_MISMATCH';
    END IF;

    RETURN jsonb_build_object(
      'reserved', true,
      'created', false,
      'should_create', false,
      'paid', v_reservation.state = 'settled',
      'legacy_imported', v_reservation.legacy_imported,
      'payment_disposition', CASE
        WHEN v_reservation.state = 'settled' THEN 'discard_key'
        WHEN v_reservation.snap_token IS NOT NULL THEN 'retry_same_key'
        WHEN v_reservation.legacy_imported THEN 'manual_reconcile'
        ELSE 'retry_same_key'
      END,
      'state', v_reservation.state,
      'payment_key', v_reservation.payment_key,
      'midtrans_order_id', v_reservation.midtrans_order_id,
      'gross_amount', v_reservation.gross_amount,
      'order_ids', v_snapshot -> 'order_ids',
      'order_allocations', v_snapshot -> 'order_allocations',
      'snap_token', v_reservation.snap_token,
      'snap_redirect_url', v_reservation.snap_redirect_url,
      'customer_name', v_customer.name,
      'customer_whatsapp', v_customer.whatsapp
    );
  END IF;

  PERFORM o.id
  FROM public.orders AS o
  WHERE o.id = ANY(v_order_ids)
  ORDER BY o.id::text
  FOR UPDATE;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE o.customer_id = p_customer_id
        AND o.is_active IS TRUE
        AND o.status IN ('pending', 'scheduled', 'delivered')
        AND o.payment_status = 'unpaid'
        AND o.total_amount > 0
        AND o.midtrans_order_id IS NULL
        AND COALESCE(o.qris_charged_idr, 0) = 0
        AND o.prepay_checkout_key IS NULL
    )::integer,
    COALESCE(sum(o.total_amount), 0)::bigint,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'order_id', o.id,
        'customer_id', o.customer_id,
        'branch', o.branch,
        'amount_idr', o.total_amount
      ) ORDER BY o.id::text
    ), '[]'::jsonb)
  INTO v_order_count, v_valid_count, v_gross, v_allocations
  FROM public.orders AS o
  WHERE o.id = ANY(v_order_ids);

  IF v_order_count <> cardinality(v_order_ids)
     OR v_valid_count <> cardinality(v_order_ids) THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_ORDER_SET_OR_STATE_INVALID'
      USING ERRCODE = '55000';
  END IF;
  IF v_gross <> p_expected_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_AMOUNT_MISMATCH'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.later_pay_payment_reservations (
    payment_key,
    customer_id,
    midtrans_order_id,
    request_hash,
    payment_rail,
    gross_amount,
    state
  ) VALUES (
    p_payment_key,
    p_customer_id,
    v_midtrans_order_id,
    v_request_hash,
    p_payment_rail,
    p_expected_amount,
    'reserved'
  )
  RETURNING * INTO v_reservation;

  INSERT INTO public.later_pay_payment_reservation_orders (
    payment_key,
    order_id,
    customer_id,
    ordinal,
    amount_idr,
    branch,
    is_open
  )
  SELECT
    p_payment_key,
    o.id,
    o.customer_id,
    row_number() OVER (ORDER BY o.id::text)::integer,
    o.total_amount,
    o.branch,
    true
  FROM public.orders AS o
  WHERE o.id = ANY(v_order_ids)
  ORDER BY o.id::text;

  UPDATE public.orders AS o
  SET
    midtrans_order_id = v_midtrans_order_id,
    updated_at = now()
  WHERE o.id = ANY(v_order_ids)
    AND o.customer_id = p_customer_id
    AND o.is_active IS TRUE
    AND o.payment_status = 'unpaid'
    AND o.midtrans_order_id IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> cardinality(v_order_ids) THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_RESERVATION_STATE_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  v_created := true;
  RETURN jsonb_build_object(
    'reserved', true,
    'created', v_created,
    'should_create', true,
    'paid', false,
    'legacy_imported', false,
    'payment_disposition', 'create',
    'state', v_reservation.state,
    'payment_key', v_reservation.payment_key,
    'midtrans_order_id', v_reservation.midtrans_order_id,
    'gross_amount', v_reservation.gross_amount,
    'order_ids', to_jsonb(v_order_ids),
    'order_allocations', v_allocations,
    'snap_token', NULL,
    'snap_redirect_url', NULL,
    'customer_name', v_customer.name,
    'customer_whatsapp', v_customer.whatsapp
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_customer_later_pay_payment(
  p_customer_id uuid,
  p_payment_key uuid,
  p_midtrans_order_id text,
  p_gross_amount integer,
  p_snap_token text,
  p_snap_redirect_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_reservation public.later_pay_payment_reservations%ROWTYPE;
  v_snapshot jsonb;
  v_snap_token text;
  v_redirect_url text;
  v_already_finalized boolean := false;
BEGIN
  IF p_customer_id IS NULL OR p_payment_key IS NULL THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_IDENTITY_REQUIRED';
  END IF;
  v_snap_token := NULLIF(btrim(p_snap_token), '');
  v_redirect_url := NULLIF(btrim(p_snap_redirect_url), '');
  IF v_snap_token IS NULL OR length(v_snap_token) > 4096 THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_SNAP_TOKEN';
  END IF;
  IF v_redirect_url IS NOT NULL AND length(v_redirect_url) > 8192 THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_REDIRECT_URL';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

  SELECT c.* INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;

  SELECT r.* INTO v_reservation
  FROM public.later_pay_payment_reservations AS r
  WHERE r.payment_key = p_payment_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LATER_PAY_PAYMENT_RESERVATION_NOT_FOUND'; END IF;
  IF v_reservation.customer_id <> p_customer_id
     OR v_reservation.midtrans_order_id IS DISTINCT FROM p_midtrans_order_id
     OR v_reservation.gross_amount IS DISTINCT FROM p_gross_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_FINALIZE_IDENTITY_MISMATCH';
  END IF;
  IF v_reservation.state = 'released' THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_ALREADY_RELEASED';
  END IF;
  IF v_reservation.legacy_imported THEN
    RAISE EXCEPTION 'LEGACY_LATER_PAY_PAYMENT_NOT_FINALIZABLE';
  END IF;

  v_snapshot := public.assert_later_pay_payment_orders(
    p_payment_key,
    p_customer_id,
    p_midtrans_order_id,
    CASE WHEN v_reservation.state = 'settled' THEN 'paid' ELSE 'unpaid' END
  );
  IF (v_snapshot ->> 'gross_amount')::bigint <> p_gross_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_SNAPSHOT_AMOUNT_MISMATCH';
  END IF;

  IF v_reservation.snap_token IS NOT NULL THEN
    IF v_reservation.snap_token IS DISTINCT FROM v_snap_token
       OR (
         v_reservation.snap_redirect_url IS NOT NULL
         AND v_redirect_url IS NOT NULL
         AND v_reservation.snap_redirect_url IS DISTINCT FROM v_redirect_url
       ) THEN
      RAISE EXCEPTION 'LATER_PAY_PAYMENT_SNAP_SESSION_CONFLICT';
    END IF;
    v_already_finalized := true;
  END IF;

  UPDATE public.later_pay_payment_reservations AS r
  SET
    state = CASE WHEN r.state = 'settled' THEN 'settled' ELSE 'ready' END,
    snap_token = COALESCE(r.snap_token, v_snap_token),
    snap_redirect_url = COALESCE(r.snap_redirect_url, v_redirect_url),
    finalized_at = COALESCE(r.finalized_at, now()),
    updated_at = now()
  WHERE r.payment_key = p_payment_key
  RETURNING * INTO v_reservation;

  RETURN jsonb_build_object(
    'finalized', true,
    'already_finalized', v_already_finalized,
    'paid', v_reservation.state = 'settled',
    'payment_key', v_reservation.payment_key,
    'midtrans_order_id', v_reservation.midtrans_order_id,
    'gross_amount', v_reservation.gross_amount,
    'order_ids', v_snapshot -> 'order_ids',
    'order_allocations', v_snapshot -> 'order_allocations',
    'snap_token', v_reservation.snap_token,
    'snap_redirect_url', v_reservation.snap_redirect_url,
    'state', v_reservation.state
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_customer_later_pay_payment(
  p_customer_id uuid,
  p_payment_key uuid,
  p_midtrans_order_id text,
  p_gross_amount integer,
  p_reason text,
  p_midtrans_transaction_id text,
  p_transaction_status text,
  p_payment_type text,
  p_raw_notification jsonb,
  p_released_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_reservation public.later_pay_payment_reservations%ROWTYPE;
  v_snapshot jsonb;
  v_updated_count integer;
  v_status text := lower(NULLIF(btrim(p_transaction_status), ''));
  v_expected_status text;
BEGIN
  IF p_customer_id IS NULL OR p_payment_key IS NULL THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_IDENTITY_REQUIRED';
  END IF;
  IF p_reason IS NULL OR p_reason <> ALL (ARRAY[
    'snap_create_failed',
    'payment_expired',
    'payment_cancelled',
    'payment_denied',
    'payment_failed'
  ]::text[]) THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_RELEASE_REASON';
  END IF;
  v_expected_status := CASE p_reason
    WHEN 'payment_expired' THEN 'expire'
    WHEN 'payment_cancelled' THEN 'cancel'
    WHEN 'payment_denied' THEN 'deny'
    WHEN 'payment_failed' THEN 'failure'
    ELSE NULL
  END;
  IF (p_reason = 'snap_create_failed' AND v_status IS NOT NULL)
     OR (p_reason <> 'snap_create_failed' AND v_status IS DISTINCT FROM v_expected_status) THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_RELEASE_STATUS_MISMATCH';
  END IF;
  IF p_raw_notification IS NOT NULL
     AND jsonb_typeof(p_raw_notification) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_PROVIDER_PAYLOAD';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

  SELECT c.* INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;

  SELECT r.* INTO v_reservation
  FROM public.later_pay_payment_reservations AS r
  WHERE r.payment_key = p_payment_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LATER_PAY_PAYMENT_RESERVATION_NOT_FOUND'; END IF;
  IF v_reservation.customer_id <> p_customer_id
     OR v_reservation.midtrans_order_id IS DISTINCT FROM p_midtrans_order_id
     OR v_reservation.gross_amount IS DISTINCT FROM p_gross_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_RELEASE_IDENTITY_MISMATCH';
  END IF;
  IF v_reservation.state = 'settled' THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_ALREADY_SETTLED';
  END IF;
  IF v_reservation.state = 'released' THEN
    RETURN jsonb_build_object(
      'released', true,
      'already_released', true,
      'payment_disposition', 'discard_key',
      'payment_key', v_reservation.payment_key,
      'midtrans_order_id', v_reservation.midtrans_order_id,
      'gross_amount', v_reservation.gross_amount,
      'release_reason', v_reservation.release_reason,
      'released_at', v_reservation.released_at
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hq_midtrans_settlements AS h
    WHERE h.midtrans_order_id = p_midtrans_order_id
  ) THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_ALREADY_SETTLED';
  END IF;

  v_snapshot := public.assert_later_pay_payment_orders(
    p_payment_key,
    p_customer_id,
    p_midtrans_order_id,
    'unpaid'
  );
  IF (v_snapshot ->> 'gross_amount')::bigint <> p_gross_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_SNAPSHOT_AMOUNT_MISMATCH';
  END IF;

  UPDATE public.orders AS o
  SET
    midtrans_order_id = NULL,
    updated_at = now()
  WHERE o.id IN (
    SELECT m.order_id
    FROM public.later_pay_payment_reservation_orders AS m
    WHERE m.payment_key = p_payment_key
  )
    AND o.customer_id = p_customer_id
    AND o.payment_status = 'unpaid'
    AND o.midtrans_order_id = p_midtrans_order_id;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> jsonb_array_length(v_snapshot -> 'order_ids') THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_RELEASE_STATE_CHANGED'
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.later_pay_payment_reservation_orders AS m
  SET
    is_open = false,
    closed_at = COALESCE(p_released_at, now())
  WHERE m.payment_key = p_payment_key
    AND m.is_open;

  UPDATE public.later_pay_payment_reservations AS r
  SET
    state = 'released',
    released_at = COALESCE(p_released_at, now()),
    release_reason = p_reason,
    provider_transaction_id = NULLIF(btrim(p_midtrans_transaction_id), ''),
    provider_transaction_status = v_status,
    provider_payment_type = NULLIF(btrim(p_payment_type), ''),
    provider_gross_amount = p_gross_amount,
    provider_payload = p_raw_notification,
    updated_at = now()
  WHERE r.payment_key = p_payment_key
  RETURNING * INTO v_reservation;

  RETURN jsonb_build_object(
    'released', true,
    'already_released', false,
    'payment_disposition', 'discard_key',
    'payment_key', v_reservation.payment_key,
    'midtrans_order_id', v_reservation.midtrans_order_id,
    'gross_amount', v_reservation.gross_amount,
    'order_ids', v_snapshot -> 'order_ids',
    'order_allocations', v_snapshot -> 'order_allocations',
    'release_reason', v_reservation.release_reason,
    'released_at', v_reservation.released_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_customer_later_pay_payment(
  p_customer_id uuid,
  p_payment_key uuid,
  p_midtrans_order_id text,
  p_gross_amount integer,
  p_midtrans_transaction_id text,
  p_transaction_status text,
  p_fraud_status text,
  p_payment_type text,
  p_raw_notification jsonb,
  p_settled_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_reservation public.later_pay_payment_reservations%ROWTYPE;
  v_hq public.hq_midtrans_settlements%ROWTYPE;
  v_snapshot jsonb;
  v_allocations jsonb;
  v_status text := lower(NULLIF(btrim(p_transaction_status), ''));
  v_fraud text := lower(NULLIF(btrim(p_fraud_status), ''));
  v_transaction_id text := NULLIF(btrim(p_midtrans_transaction_id), '');
  v_payment_type text := NULLIF(btrim(p_payment_type), '');
  v_effective_settled_at timestamptz := COALESCE(p_settled_at, now());
  v_updated_count integer;
  v_already_settled boolean := false;
BEGIN
  IF p_customer_id IS NULL OR p_payment_key IS NULL THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_IDENTITY_REQUIRED';
  END IF;
  IF v_status NOT IN ('settlement', 'capture')
     OR (v_status = 'capture' AND v_fraud IS DISTINCT FROM 'accept') THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_NOT_VERIFIED_SETTLED';
  END IF;
  IF p_raw_notification IS NULL
     OR jsonb_typeof(p_raw_notification) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_LATER_PAY_PAYMENT_PROVIDER_PAYLOAD';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

  SELECT c.* INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND'; END IF;

  SELECT r.* INTO v_reservation
  FROM public.later_pay_payment_reservations AS r
  WHERE r.payment_key = p_payment_key
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'LATER_PAY_PAYMENT_RESERVATION_NOT_FOUND'; END IF;
  IF v_reservation.customer_id <> p_customer_id
     OR v_reservation.midtrans_order_id IS DISTINCT FROM p_midtrans_order_id
     OR v_reservation.gross_amount IS DISTINCT FROM p_gross_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_SETTLEMENT_IDENTITY_MISMATCH';
  END IF;

  IF v_reservation.state = 'released' THEN
    UPDATE public.later_pay_payment_reservations AS r
    SET
      provider_transaction_id = COALESCE(r.provider_transaction_id, v_transaction_id),
      provider_transaction_status = v_status,
      provider_payment_type = COALESCE(r.provider_payment_type, v_payment_type),
      provider_gross_amount = p_gross_amount,
      provider_payload = p_raw_notification,
      late_payment_detected_at = COALESCE(r.late_payment_detected_at, now()),
      updated_at = now()
    WHERE r.payment_key = p_payment_key;

    RETURN jsonb_build_object(
      'settled', false,
      'late_payment', true,
      'requires_reconciliation', true,
      'payment_disposition', 'manual_reconcile',
      'payment_key', v_reservation.payment_key,
      'midtrans_order_id', v_reservation.midtrans_order_id,
      'gross_amount', v_reservation.gross_amount
    );
  END IF;

  v_snapshot := public.assert_later_pay_payment_orders(
    p_payment_key,
    p_customer_id,
    p_midtrans_order_id,
    CASE WHEN v_reservation.state = 'settled' THEN 'paid' ELSE 'unpaid' END
  );
  IF (v_snapshot ->> 'gross_amount')::bigint <> p_gross_amount THEN
    RAISE EXCEPTION 'LATER_PAY_PAYMENT_SNAPSHOT_AMOUNT_MISMATCH';
  END IF;
  v_allocations := v_snapshot -> 'order_allocations';

  IF v_reservation.state = 'settled' THEN
    IF v_reservation.provider_gross_amount IS DISTINCT FROM p_gross_amount
       OR v_reservation.provider_transaction_status IS DISTINCT FROM v_status
       OR (
         v_reservation.provider_transaction_id IS NOT NULL
         AND v_transaction_id IS NOT NULL
         AND v_reservation.provider_transaction_id IS DISTINCT FROM v_transaction_id
       ) THEN
      RAISE EXCEPTION 'LATER_PAY_PAYMENT_SETTLEMENT_REPLAY_MISMATCH';
    END IF;
    v_already_settled := true;
  ELSE
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
    ) VALUES (
      p_midtrans_order_id,
      v_transaction_id,
      p_gross_amount,
      v_status,
      v_payment_type,
      'later_pay_orders',
      p_customer_id,
      v_allocations -> 0 ->> 'branch',
      NULL,
      NULL,
      jsonb_build_object(
        'later_pay_batch', true,
        'payment_key', p_payment_key,
        'order_allocations', v_allocations,
        'source', 'settle_customer_later_pay_payment'
      ),
      p_raw_notification,
      v_effective_settled_at
    )
    ON CONFLICT (midtrans_order_id) DO NOTHING;

    SELECT h.* INTO v_hq
    FROM public.hq_midtrans_settlements AS h
    WHERE h.midtrans_order_id = p_midtrans_order_id
    FOR UPDATE;

    IF NOT FOUND
       OR v_hq.gross_amount IS DISTINCT FROM p_gross_amount
       OR v_hq.source_type IS DISTINCT FROM 'later_pay_orders'
       OR v_hq.customer_id IS DISTINCT FROM p_customer_id
       OR (
         v_hq.midtrans_transaction_id IS NOT NULL
         AND v_transaction_id IS NOT NULL
         AND v_hq.midtrans_transaction_id IS DISTINCT FROM v_transaction_id
       ) THEN
      RAISE EXCEPTION 'LATER_PAY_PAYMENT_HQ_SETTLEMENT_CONFLICT';
    END IF;

    UPDATE public.orders AS o
    SET
      payment_status = 'paid',
      paid_date = (v_effective_settled_at AT TIME ZONE 'Asia/Jakarta')::date,
      payment_confirmation_type = 'qris',
      updated_at = now()
    WHERE o.id IN (
      SELECT m.order_id
      FROM public.later_pay_payment_reservation_orders AS m
      WHERE m.payment_key = p_payment_key
    )
      AND o.customer_id = p_customer_id
      AND o.is_active IS TRUE
      AND o.payment_status = 'unpaid'
      AND o.midtrans_order_id = p_midtrans_order_id;
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> jsonb_array_length(v_snapshot -> 'order_ids') THEN
      RAISE EXCEPTION 'LATER_PAY_PAYMENT_SETTLEMENT_STATE_CHANGED'
        USING ERRCODE = '40001';
    END IF;

    UPDATE public.later_pay_payment_reservation_orders AS m
    SET
      is_open = false,
      closed_at = v_effective_settled_at
    WHERE m.payment_key = p_payment_key
      AND m.is_open;

    UPDATE public.later_pay_payment_reservations AS r
    SET
      state = 'settled',
      settled_at = v_effective_settled_at,
      provider_transaction_id = v_transaction_id,
      provider_transaction_status = v_status,
      provider_payment_type = v_payment_type,
      provider_gross_amount = p_gross_amount,
      provider_payload = p_raw_notification,
      updated_at = now()
    WHERE r.payment_key = p_payment_key
    RETURNING * INTO v_reservation;
  END IF;

  RETURN jsonb_build_object(
    'settled', true,
    'already_settled', v_already_settled,
    'late_payment', false,
    'requires_reconciliation', false,
    'payment_disposition', 'discard_key',
    'payment_key', v_reservation.payment_key,
    'customer_id', v_reservation.customer_id,
    'midtrans_order_id', v_reservation.midtrans_order_id,
    'gross_amount', v_reservation.gross_amount,
    'order_ids', v_snapshot -> 'order_ids',
    'order_allocations', v_allocations,
    'settled_at', v_reservation.settled_at
  );
END;
$function$;

ALTER FUNCTION public.reserve_customer_later_pay_payment(
  uuid, uuid, uuid[], integer, text
) OWNER TO postgres;
ALTER FUNCTION public.finalize_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text
) OWNER TO postgres;
ALTER FUNCTION public.release_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) OWNER TO postgres;
ALTER FUNCTION public.settle_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.reserve_customer_later_pay_payment(
  uuid, uuid, uuid[], integer, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.release_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.settle_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_customer_later_pay_payment(
  uuid, uuid, uuid[], integer, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) TO service_role;

COMMENT ON TABLE public.later_pay_payment_reservations IS
  'Immutable later-pay Midtrans batch identity and lifecycle; no customer/staff direct access.';
COMMENT ON TABLE public.later_pay_payment_reservation_orders IS
  'Per-order amount/branch snapshot for a later-pay Midtrans batch. Open rows uniquely reserve an order.';
COMMENT ON FUNCTION public.reserve_customer_later_pay_payment(
  uuid, uuid, uuid[], integer, text
) IS
  'Service-role-only exact-set reservation before Midtrans. Uses the common customer order lock and deterministic payment-key identity.';
COMMENT ON FUNCTION public.finalize_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text
) IS
  'Service-role-only idempotent persistence of the canonical Midtrans Snap session.';
COMMENT ON FUNCTION public.release_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) IS
  'Service-role-only release after deterministic Snap rejection or verified terminal provider failure.';
COMMENT ON FUNCTION public.settle_customer_later_pay_payment(
  uuid, uuid, text, integer, text, text, text, text, jsonb, timestamptz
) IS
  'Service-role-only atomic later-pay settlement: validates the immutable batch, records HQ cash-in, marks every order paid, and closes the reservation.';

COMMIT;
