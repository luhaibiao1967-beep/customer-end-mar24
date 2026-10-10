-- Complete the shared customer-lock coverage for staff payment, payment
-- evidence, trip assignment, trip delivery, and voucher purchase settlement.
-- Every workflow acquires the same advisory lock before any customer/order row
-- lock. Browser writes that could split order and trip state are RPC-only.

BEGIN;

-- The older customer-portal schema predates these staff payment audit fields.
-- Add them idempotently so the same atomic RPC body works on both historical
-- database shapes and on the staging clone.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS evidence_amount_verified text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS evidence_detected_amount numeric,
  ADD COLUMN IF NOT EXISTS payment_confirmed_by text;

CREATE OR REPLACE FUNCTION public.__inject_customer_lock_for_migration(
  p_signature text,
  p_anchor text,
  p_injection text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $migration_helper$
DECLARE
  v_oid regprocedure;
  v_definition text;
  v_updated text;
  v_anchor_count integer;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_config text[];
BEGIN
  v_oid := pg_catalog.to_regprocedure(p_signature);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_LOCK_PATCH_FUNCTION_MISSING: %', p_signature;
  END IF;

  SELECT pg_catalog.pg_get_functiondef(p.oid), p.proowner, p.proacl, p.prosecdef, p.proconfig
    INTO v_definition, v_owner, v_acl, v_security_definer, v_config
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_oid;

  IF pg_catalog.strpos(v_definition, 'vividaqua:customer-order:') > 0 THEN
    IF pg_catalog.strpos(v_definition, 'vividaqua:customer-order:') >
       pg_catalog.strpos(pg_catalog.upper(v_definition), 'FOR UPDATE') THEN
      RAISE EXCEPTION 'CUSTOMER_LOCK_AFTER_ROW_LOCK: %', p_signature;
    END IF;
    RETURN;
  END IF;

  v_anchor_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, p_anchor, ''))
  ) / pg_catalog.length(p_anchor);
  IF v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'CUSTOMER_LOCK_PATCH_ANCHOR_COUNT: % got %', p_signature, v_anchor_count;
  END IF;

  v_updated := pg_catalog.replace(v_definition, p_anchor, p_injection || p_anchor);
  EXECUTE v_updated;

  v_oid := pg_catalog.to_regprocedure(p_signature);
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_oid
      AND p.proowner = v_owner
      AND p.proacl IS NOT DISTINCT FROM v_acl
      AND p.prosecdef = v_security_definer
      AND p.proconfig IS NOT DISTINCT FROM v_config
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid), 'vividaqua:customer-order:') > 0
      AND pg_catalog.strpos(pg_catalog.pg_get_functiondef(p.oid), 'vividaqua:customer-order:') <
          pg_catalog.strpos(pg_catalog.upper(pg_catalog.pg_get_functiondef(p.oid)), 'FOR UPDATE')
  ) THEN
    RAISE EXCEPTION 'CUSTOMER_LOCK_PATCH_VERIFICATION_FAILED: %', p_signature;
  END IF;
END;
$migration_helper$;

ALTER FUNCTION public.__inject_customer_lock_for_migration(text, text, text) OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.__inject_customer_lock_for_migration(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Voucher confirmation previously locked the purchase request first. It now
-- participates in the same customer-first order as every other payment path.
SELECT public.__inject_customer_lock_for_migration(
  'public.confirm_paid_voucher_purchase(uuid,uuid,text,text,integer,text,text,text,jsonb,timestamp with time zone,jsonb)',
  $anchor$  SELECT r.*
    INTO v_request
  FROM public.voucher_purchase_requests AS r
  WHERE r.id = p_request_id
    AND r.customer_id = p_customer_id
  FOR UPDATE;$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

DROP FUNCTION public.__inject_customer_lock_for_migration(text, text, text);

CREATE OR REPLACE FUNCTION public.confirm_staff_order_payment_atomic(
  p_order_ids uuid[],
  p_payment_evidence text DEFAULT NULL,
  p_evidence_status text DEFAULT NULL,
  p_evidence_detected_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_actor_label text;
  v_customer_id uuid;
  v_order_count integer;
  v_valid_count integer;
  v_updated_count integer;
  v_confirmation_type text;
  v_evidence_status text := lower(NULLIF(btrim(p_evidence_status), ''));
  v_payment_evidence text := NULLIF(btrim(p_payment_evidence), '');
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(cardinality(p_order_ids), 0) < 1
     OR cardinality(p_order_ids) > 100
     OR array_position(p_order_ids, NULL::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_STAFF_PAYMENT_ORDER_IDS' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM unnest(p_order_ids) AS x(id)) <>
     (SELECT count(DISTINCT x.id) FROM unnest(p_order_ids) AS x(id)) THEN
    RAISE EXCEPTION 'DUPLICATE_STAFF_PAYMENT_ORDER_ID' USING ERRCODE = '22023';
  END IF;
  IF v_evidence_status IS NOT NULL
     AND v_evidence_status NOT IN ('pending', 'matched', 'mismatch', 'failed', 'manual') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_EVIDENCE_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_evidence_detected_amount IS NOT NULL AND p_evidence_detected_amount < 0 THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_EVIDENCE_AMOUNT' USING ERRCODE = '22023';
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN ('sales', 'finance', 'admin', 'adminFin', 'branch_admin'), false) THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Identity probe only. Acquire every customer lock in deterministic order
  -- before locking a customer or order row.
  FOR v_customer_id IN
    SELECT DISTINCT o.customer_id
    FROM public.orders AS o
    WHERE o.id = ANY(p_order_ids)
      AND o.customer_id IS NOT NULL
    ORDER BY o.customer_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('vividaqua:customer-order:' || v_customer_id::text, 0)
    );
  END LOOP;

  PERFORM c.id
  FROM public.customers AS c
  WHERE c.id IN (
    SELECT DISTINCT o.customer_id FROM public.orders AS o WHERE o.id = ANY(p_order_ids)
  )
  ORDER BY c.id::text
  FOR UPDATE;

  PERFORM o.id
  FROM public.orders AS o
  WHERE o.id = ANY(p_order_ids)
  ORDER BY o.customer_id::text, o.id::text
  FOR UPDATE;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE o.is_active IS TRUE
        AND o.status = 'delivered'
        AND o.payment_status = 'unpaid'
        AND o.total_amount > 0
        AND o.midtrans_order_id IS NULL
        AND COALESCE(o.qris_charged_idr, 0) = 0
        AND o.prepay_checkout_key IS NULL
        AND o.voucher_order_key IS NULL
        AND c.is_active IS TRUE
        AND c.customer_type::text = 'later_pay'
        AND NOT public.staff_order_has_voucher_ledger(o.id)
    )::integer
    INTO v_order_count, v_valid_count
  FROM public.orders AS o
  JOIN public.customers AS c ON c.id = o.customer_id
  WHERE o.id = ANY(p_order_ids);

  IF v_order_count <> cardinality(p_order_ids)
     OR v_valid_count <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_ORDER_SET_OR_STATE_INVALID' USING ERRCODE = '55000';
  END IF;

  IF v_role NOT IN ('admin', 'adminFin')
     AND NOT (v_role = 'finance' AND v_staff_branch = 'All')
     AND EXISTS (
       SELECT 1
       FROM public.orders AS o
       WHERE o.id = ANY(p_order_ids)
         AND (
           v_staff_branch IS NULL
           OR v_staff_branch = 'All'
           OR o.branch IS DISTINCT FROM v_staff_branch
         )
     ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_confirmation_type := CASE
    WHEN v_payment_evidence IS NOT NULL AND v_evidence_status = 'matched' THEN 'ocr'
    ELSE 'manual'
  END;
  v_actor_label := public.staff_order_actor_label();

  UPDATE public.orders AS o
  SET
    payment_status = 'paid',
    paid_date = (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date,
    payment_evidence = v_payment_evidence,
    payment_confirmation_type = v_confirmation_type,
    payment_confirmed_by = v_actor_label,
    evidence_amount_verified = CASE
      WHEN v_payment_evidence IS NULL THEN NULL
      ELSE COALESCE(v_evidence_status, 'pending')
    END,
    evidence_detected_amount = CASE
      WHEN v_payment_evidence IS NULL THEN NULL
      ELSE p_evidence_detected_amount
    END,
    updated_at = pg_catalog.now()
  WHERE o.id = ANY(p_order_ids)
    AND o.is_active IS TRUE
    AND o.status = 'delivered'
    AND o.payment_status = 'unpaid';
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_STATE_CHANGED_RETRY' USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'confirmed', true,
    'order_ids', to_jsonb((SELECT array_agg(x.id ORDER BY x.id::text) FROM unnest(p_order_ids) AS x(id))),
    'updated_count', v_updated_count,
    'payment_confirmation_type', v_confirmation_type,
    'paid_date', (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_staff_order_payment_atomic(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_customer_id uuid;
  v_order public.orders%ROWTYPE;
  v_order_json jsonb;
  v_confirmation text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN ('admin', 'branch_admin'), false) THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_UNDO_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT o.customer_id INTO v_customer_id FROM public.orders AS o WHERE o.id = p_order_id;
  IF NOT FOUND OR v_customer_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vividaqua:customer-order:' || v_customer_id::text, 0)
  );
  PERFORM c.id FROM public.customers AS c WHERE c.id = v_customer_id FOR UPDATE;
  SELECT o.* INTO v_order FROM public.orders AS o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF v_order.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'ORDER_CUSTOMER_CHANGED_RETRY' USING ERRCODE = '40001';
  END IF;

  IF v_role <> 'admin'
     AND (v_staff_branch IS NULL OR v_staff_branch = 'All' OR v_order.branch IS DISTINCT FROM v_staff_branch) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  v_order_json := pg_catalog.to_jsonb(v_order);
  v_confirmation := lower(NULLIF(v_order.payment_confirmation_type, ''));
  IF v_order.is_active IS DISTINCT FROM true
     OR v_order.payment_status IS DISTINCT FROM 'paid'
     OR NULLIF(v_order_json->>'midtrans_order_id', '') IS NOT NULL
     OR COALESCE((v_order_json->>'qris_charged_idr')::numeric, 0) <> 0
     OR NULLIF(v_order_json->>'prepay_checkout_key', '') IS NOT NULL
     OR NULLIF(v_order_json->>'voucher_order_key', '') IS NOT NULL
     OR public.staff_order_has_voucher_ledger(p_order_id)
     OR NOT COALESCE(
       v_confirmation IN ('manual', 'ocr', 'cash', 'transfer')
       OR (v_confirmation IS NULL AND v_order.total_amount = 0),
       false
     ) THEN
    RAISE EXCEPTION 'STAFF_PAYMENT_UNDO_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders
  SET
    payment_status = 'unpaid',
    paid_date = NULL,
    payment_evidence = NULL,
    payment_confirmation_type = NULL,
    payment_confirmed_by = NULL,
    evidence_amount_verified = NULL,
    evidence_detected_amount = NULL,
    updated_at = pg_catalog.now()
  WHERE id = p_order_id;

  RETURN pg_catalog.jsonb_build_object('undone', true, 'order_id', p_order_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_customer_payment_evidence_atomic(
  p_customer_id uuid,
  p_order_ids uuid[],
  p_payment_evidence text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_path text := NULLIF(btrim(p_payment_evidence), '');
  v_customer public.customers%ROWTYPE;
  v_order_count integer;
  v_valid_count integer;
  v_updated_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR v_path IS NULL OR length(v_path) > 2048 THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_EVIDENCE_REQUEST' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(cardinality(p_order_ids), 0) < 1
     OR cardinality(p_order_ids) > 100
     OR array_position(p_order_ids, NULL::uuid) IS NOT NULL
     OR (SELECT count(*) FROM unnest(p_order_ids) AS x(id)) <>
        (SELECT count(DISTINCT x.id) FROM unnest(p_order_ids) AS x(id)) THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_EVIDENCE_ORDER_IDS' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vividaqua:customer-order:' || p_customer_id::text, 0)
  );
  SELECT c.* INTO v_customer FROM public.customers AS c WHERE c.id = p_customer_id FOR UPDATE;
  IF NOT FOUND OR v_customer.is_active IS DISTINCT FROM true
     OR v_customer.customer_type::text IS DISTINCT FROM 'later_pay' THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_ELIGIBLE_FOR_PAYMENT_EVIDENCE';
  END IF;

  PERFORM o.id
  FROM public.orders AS o
  WHERE o.id = ANY(p_order_ids)
  ORDER BY o.id::text
  FOR UPDATE;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE o.customer_id = p_customer_id
        AND o.is_active IS TRUE
        AND o.status IN ('pending', 'scheduled', 'delivered')
        AND o.payment_status = 'unpaid'
        AND o.midtrans_order_id IS NULL
        AND COALESCE(o.qris_charged_idr, 0) = 0
        AND o.prepay_checkout_key IS NULL
        AND o.voucher_order_key IS NULL
        AND NOT public.staff_order_has_voucher_ledger(o.id)
    )::integer
    INTO v_order_count, v_valid_count
  FROM public.orders AS o
  WHERE o.id = ANY(p_order_ids);

  IF v_order_count <> cardinality(p_order_ids)
     OR v_valid_count <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'PAYMENT_EVIDENCE_ORDER_SET_OR_STATE_INVALID' USING ERRCODE = '55000';
  END IF;

  UPDATE public.orders AS o
  SET payment_evidence = v_path, updated_at = pg_catalog.now()
  WHERE o.id = ANY(p_order_ids)
    AND o.customer_id = p_customer_id
    AND o.is_active IS TRUE
    AND o.payment_status = 'unpaid'
    AND o.midtrans_order_id IS NULL;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'PAYMENT_EVIDENCE_STATE_CHANGED_RETRY' USING ERRCODE = '40001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'updated', true,
    'updated_count', v_updated_count,
    'order_ids', to_jsonb((SELECT array_agg(x.id ORDER BY x.id::text) FROM unnest(p_order_ids) AS x(id))),
    'payment_evidence', v_path
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_trip_order_membership_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF current_user IN ('postgres', 'service_role') OR auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND cardinality(COALESCE(NEW.order_ids, ARRAY[]::text[])) > 0 THEN
    RAISE EXCEPTION 'TRIP_ORDER_ASSIGNMENT_REQUIRES_ATOMIC_RPC' USING ERRCODE = '42501';
  ELSIF TG_OP = 'UPDATE' AND OLD.order_ids IS DISTINCT FROM NEW.order_ids THEN
    RAISE EXCEPTION 'TRIP_ORDER_ASSIGNMENT_REQUIRES_ATOMIC_RPC' USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' AND cardinality(COALESCE(OLD.order_ids, ARRAY[]::text[])) > 0 THEN
    RAISE EXCEPTION 'NONEMPTY_TRIP_DELETE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_order_trip_assignment_atomic(
  p_order_id uuid,
  p_trip_id uuid,
  p_assign boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_context jsonb;
  v_role text;
  v_staff_branch text;
  v_customer_id uuid;
  v_order public.orders%ROWTYPE;
  v_trip public.trips%ROWTYPE;
  v_order_id_text text := p_order_id::text;
  v_new_order_ids text[];
  v_schedule jsonb;
  v_changed boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL
     OR p_order_id IS NULL OR p_trip_id IS NULL OR p_assign IS NULL THEN
    RAISE EXCEPTION 'STAFF_TRIP_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN ('operator', 'operator_manager', 'admin', 'branch_admin', 'operations_admin'), false) THEN
    RAISE EXCEPTION 'STAFF_TRIP_ASSIGNMENT_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT o.customer_id INTO v_customer_id FROM public.orders AS o WHERE o.id = p_order_id;
  IF NOT FOUND OR v_customer_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vividaqua:customer-order:' || v_customer_id::text, 0)
  );
  PERFORM c.id FROM public.customers AS c WHERE c.id = v_customer_id FOR UPDATE;
  SELECT o.* INTO v_order FROM public.orders AS o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF v_order.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'ORDER_CUSTOMER_CHANGED_RETRY' USING ERRCODE = '40001';
  END IF;

  SELECT t.* INTO v_trip FROM public.trips AS t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRIP_NOT_FOUND'; END IF;

  IF v_role <> 'admin'
     AND NOT (v_role = 'operator_manager' AND v_staff_branch = 'All')
     AND (v_staff_branch IS NULL OR v_staff_branch = 'All' OR v_order.branch IS DISTINCT FROM v_staff_branch) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_assign THEN
    IF EXISTS (
      SELECT 1 FROM public.trips AS other
      WHERE other.id <> p_trip_id
        AND v_order_id_text = ANY(COALESCE(other.order_ids, ARRAY[]::text[]))
    ) THEN
      RAISE EXCEPTION 'ORDER_ALREADY_ASSIGNED_TO_ANOTHER_TRIP' USING ERRCODE = '55000';
    END IF;
    IF NOT (v_order_id_text = ANY(COALESCE(v_trip.order_ids, ARRAY[]::text[]))) THEN
      v_new_order_ids := array_append(COALESCE(v_trip.order_ids, ARRAY[]::text[]), v_order_id_text);
      v_changed := true;
    ELSE
      v_new_order_ids := COALESCE(v_trip.order_ids, ARRAY[]::text[]);
    END IF;
    v_schedule := public.set_staff_order_schedule_status(p_order_id, 'scheduled');
    UPDATE public.trips
    SET order_ids = v_new_order_ids, status = 'in-progress', updated_at = pg_catalog.now()
    WHERE id = p_trip_id;
  ELSE
    IF NOT (v_order_id_text = ANY(COALESCE(v_trip.order_ids, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'ORDER_NOT_ASSIGNED_TO_TRIP' USING ERRCODE = '55000';
    END IF;
    v_new_order_ids := array_remove(COALESCE(v_trip.order_ids, ARRAY[]::text[]), v_order_id_text);
    v_changed := true;
    v_schedule := public.set_staff_order_schedule_status(p_order_id, 'pending');
    UPDATE public.trips
    SET
      order_ids = v_new_order_ids,
      status = CASE WHEN cardinality(v_new_order_ids) = 0 THEN 'completed' ELSE 'in-progress' END,
      updated_at = pg_catalog.now()
    WHERE id = p_trip_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'assigned', p_assign,
    'changed', v_changed,
    'order_id', p_order_id,
    'trip_id', p_trip_id,
    'trip_order_ids', to_jsonb(v_new_order_ids),
    'schedule', v_schedule
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_staff_order_delivery_from_trip(
  p_order_id uuid,
  p_trip_id uuid,
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
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_customer_id uuid;
  v_trip public.trips%ROWTYPE;
  v_delivery jsonb;
  v_new_order_ids text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL
     OR p_order_id IS NULL OR p_trip_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_DELIVERY_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT o.customer_id INTO v_customer_id FROM public.orders AS o WHERE o.id = p_order_id;
  IF NOT FOUND OR v_customer_id IS NULL THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vividaqua:customer-order:' || v_customer_id::text, 0)
  );
  PERFORM c.id FROM public.customers AS c WHERE c.id = v_customer_id FOR UPDATE;
  PERFORM o.id FROM public.orders AS o WHERE o.id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;

  SELECT t.* INTO v_trip FROM public.trips AS t WHERE t.id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TRIP_NOT_FOUND'; END IF;
  IF NOT (p_order_id::text = ANY(COALESCE(v_trip.order_ids, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'ORDER_NOT_ASSIGNED_TO_TRIP' USING ERRCODE = '55000';
  END IF;

  v_delivery := public.finalize_staff_order_delivery(
    p_order_id,
    p_delivered_date,
    p_delivery_evidence,
    p_note,
    p_empty_gallons_returned,
    p_actual_items,
    p_payment_received,
    p_payment_method,
    p_payment_evidence
  );

  v_new_order_ids := array_remove(COALESCE(v_trip.order_ids, ARRAY[]::text[]), p_order_id::text);
  UPDATE public.trips
  SET
    order_ids = v_new_order_ids,
    status = CASE WHEN cardinality(v_new_order_ids) = 0 THEN 'completed' ELSE 'in-progress' END,
    updated_at = pg_catalog.now()
  WHERE id = p_trip_id;

  RETURN v_delivery || pg_catalog.jsonb_build_object(
    'trip_id', p_trip_id,
    'trip_order_ids', to_jsonb(v_new_order_ids)
  );
END;
$function$;

ALTER FUNCTION public.confirm_staff_order_payment_atomic(uuid[], text, text, numeric) OWNER TO postgres;
ALTER FUNCTION public.undo_staff_order_payment_atomic(uuid) OWNER TO postgres;
ALTER FUNCTION public.set_customer_payment_evidence_atomic(uuid, uuid[], text) OWNER TO postgres;
ALTER FUNCTION public.guard_trip_order_membership_write() OWNER TO postgres;
ALTER FUNCTION public.set_staff_order_trip_assignment_atomic(uuid, uuid, boolean) OWNER TO postgres;
ALTER FUNCTION public.finalize_staff_order_delivery_from_trip(uuid, uuid, date, text, text, integer, jsonb, boolean, text, text) OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.confirm_staff_order_payment_atomic(uuid[], text, text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.undo_staff_order_payment_atomic(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_customer_payment_evidence_atomic(uuid, uuid[], text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_trip_order_membership_write()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.set_staff_order_trip_assignment_atomic(uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.finalize_staff_order_delivery_from_trip(uuid, uuid, date, text, text, integer, jsonb, boolean, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.confirm_staff_order_payment_atomic(uuid[], text, text, numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_staff_order_payment_atomic(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_customer_payment_evidence_atomic(uuid, uuid[], text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.set_staff_order_trip_assignment_atomic(uuid, uuid, boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_staff_order_delivery_from_trip(uuid, uuid, date, text, text, integer, jsonb, boolean, text, text)
  TO authenticated;

DROP TRIGGER IF EXISTS guard_trip_order_membership_write ON public.trips;
CREATE TRIGGER guard_trip_order_membership_write
BEFORE INSERT OR UPDATE OR DELETE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.guard_trip_order_membership_write();

COMMENT ON FUNCTION public.confirm_staff_order_payment_atomic(uuid[], text, text, numeric) IS
  'Atomically confirms an exact set of ordinary delivered later-pay orders after acquiring all customer locks in deterministic order.';
COMMENT ON FUNCTION public.undo_staff_order_payment_atomic(uuid) IS
  'Atomically reverses a staff-managed payment only; Midtrans, prepay, voucher, and ledger-backed payments remain immutable.';
COMMENT ON FUNCTION public.set_customer_payment_evidence_atomic(uuid, uuid[], text) IS
  'Service-role-only exact-set evidence update for unreserved later-pay orders under the shared customer lock.';
COMMENT ON FUNCTION public.set_staff_order_trip_assignment_atomic(uuid, uuid, boolean) IS
  'Atomically changes trip membership and pending/scheduled order state under the shared customer lock.';
COMMENT ON FUNCTION public.finalize_staff_order_delivery_from_trip(uuid, uuid, date, text, text, integer, jsonb, boolean, text, text) IS
  'Atomically finalizes delivery and removes the order from its trip under the shared customer lock.';

COMMIT;
