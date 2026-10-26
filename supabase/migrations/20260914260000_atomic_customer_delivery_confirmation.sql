-- Customer self-service delivery confirmation must participate in the same
-- per-customer transaction lock as create/edit/pay/cancel/schedule/deliver.

BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_customer_order_delivery_atomic(
  p_customer_id uuid,
  p_order_id uuid,
  p_delivered_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_customer public.customers%ROWTYPE;
  v_order public.orders%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL OR p_order_id IS NULL OR p_delivered_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_DELIVERY_CONFIRMATION' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('vividaqua:customer-order:' || p_customer_id::text, 0)
  );

  SELECT c.*
    INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_customer.is_active IS DISTINCT FROM true
     OR v_customer.customer_type::text NOT IN ('pre_pay', 'later_pay') THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_ELIGIBLE_FOR_DELIVERY_CONFIRMATION'
      USING ERRCODE = '42501';
  END IF;

  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_order.customer_id IS DISTINCT FROM p_customer_id
     OR v_order.is_active IS DISTINCT FROM true
     OR v_order.status NOT IN ('scheduled', 'on_delivery')
     OR (
       v_customer.customer_type::text = 'pre_pay'
       AND v_order.payment_status IS DISTINCT FROM 'paid'
     ) THEN
    RAISE EXCEPTION 'ORDER_NOT_CONFIRMABLE' USING ERRCODE = '55000';
  END IF;

  UPDATE public.orders
  SET
    status = 'delivered',
    delivered_date = p_delivered_date,
    updated_at = pg_catalog.now()
  WHERE id = p_order_id;

  RETURN pg_catalog.jsonb_build_object(
    'confirmed', true,
    'order_id', p_order_id,
    'status', 'delivered',
    'delivered_date', p_delivered_date
  );
END;
$function$;

ALTER FUNCTION public.confirm_customer_order_delivery_atomic(uuid, uuid, date)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.confirm_customer_order_delivery_atomic(uuid, uuid, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_customer_order_delivery_atomic(uuid, uuid, date)
  TO service_role;

COMMENT ON FUNCTION public.confirm_customer_order_delivery_atomic(uuid, uuid, date) IS
  'Service-role-only customer delivery confirmation serialized by the shared per-customer transaction lock.';

COMMIT;
