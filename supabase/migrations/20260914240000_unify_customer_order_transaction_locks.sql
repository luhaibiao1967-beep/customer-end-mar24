-- Serialize every order workflow for one customer before taking any row lock.
--
-- This migration deliberately patches the installed function definitions
-- instead of copying several thousand lines from earlier migrations.  That
-- keeps later payment-reservation changes intact.  The patch helper fails
-- closed unless its anchor occurs exactly once, preserves owner/ACL/security
-- metadata, and makes a repeated run a no-op once the common lock is present.

BEGIN;

CREATE OR REPLACE FUNCTION public.__patch_customer_order_lock_for_migration(
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
  v_lock_position integer;
  v_for_update_position integer;
  v_owner oid;
  v_acl aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_owner_after oid;
  v_acl_after aclitem[];
  v_security_definer_after boolean;
  v_config_after text[];
BEGIN
  v_oid := pg_catalog.to_regprocedure(p_signature);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'CUSTOMER_ORDER_LOCK_PATCH_FUNCTION_MISSING: %', p_signature;
  END IF;

  SELECT
    pg_catalog.pg_get_functiondef(p.oid),
    p.proowner,
    p.proacl,
    p.prosecdef,
    p.proconfig
  INTO
    v_definition,
    v_owner,
    v_acl,
    v_security_definer,
    v_config
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_oid;

  v_lock_position := pg_catalog.strpos(
    v_definition,
    'vividaqua:customer-order:'
  );
  v_for_update_position := pg_catalog.strpos(
    pg_catalog.upper(v_definition),
    'FOR UPDATE'
  );

  IF v_for_update_position = 0 THEN
    RAISE EXCEPTION 'CUSTOMER_ORDER_LOCK_PATCH_ROW_LOCK_MISSING: %', p_signature;
  END IF;

  -- Re-running the migration is safe, but a pre-existing misplaced common
  -- lock must never be accepted silently.
  IF v_lock_position > 0 THEN
    IF v_lock_position > v_for_update_position THEN
      RAISE EXCEPTION 'CUSTOMER_ORDER_LOCK_AFTER_ROW_LOCK: %', p_signature;
    END IF;
    RETURN;
  END IF;

  IF p_anchor IS NULL OR p_anchor = '' THEN
    RAISE EXCEPTION 'CUSTOMER_ORDER_LOCK_PATCH_EMPTY_ANCHOR: %', p_signature;
  END IF;

  v_anchor_count := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, p_anchor, ''))
  ) / pg_catalog.length(p_anchor);

  IF v_anchor_count <> 1 THEN
    RAISE EXCEPTION
      'CUSTOMER_ORDER_LOCK_PATCH_ANCHOR_COUNT: % expected 1, got %',
      p_signature,
      v_anchor_count;
  END IF;

  v_updated := pg_catalog.replace(
    v_definition,
    p_anchor,
    p_injection || p_anchor
  );
  EXECUTE v_updated;

  v_oid := pg_catalog.to_regprocedure(p_signature);
  SELECT
    pg_catalog.pg_get_functiondef(p.oid),
    p.proowner,
    p.proacl,
    p.prosecdef,
    p.proconfig
  INTO
    v_definition,
    v_owner_after,
    v_acl_after,
    v_security_definer_after,
    v_config_after
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner
     OR v_acl_after IS DISTINCT FROM v_acl
     OR v_security_definer_after IS DISTINCT FROM v_security_definer
     OR v_config_after IS DISTINCT FROM v_config THEN
    RAISE EXCEPTION 'CUSTOMER_ORDER_LOCK_PATCH_METADATA_CHANGED: %', p_signature;
  END IF;

  v_lock_position := pg_catalog.strpos(
    v_definition,
    'vividaqua:customer-order:'
  );
  v_for_update_position := pg_catalog.strpos(
    pg_catalog.upper(v_definition),
    'FOR UPDATE'
  );
  IF v_lock_position = 0 OR v_lock_position > v_for_update_position THEN
    RAISE EXCEPTION 'CUSTOMER_ORDER_LOCK_PATCH_VERIFICATION_FAILED: %', p_signature;
  END IF;
END;
$migration_helper$;

ALTER FUNCTION public.__patch_customer_order_lock_for_migration(text, text, text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION
  public.__patch_customer_order_lock_for_migration(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Customer pre-pay checkout creation: customer lock, request-key lock, order
-- row, then customer/product/voucher rows.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.create_customer_prepay_checkout(uuid,uuid,date,text,jsonb,jsonb)',
  $anchor$  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkout_key::text, 0));$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

-- Persisting a Snap session is part of the same payment/order workflow.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.store_customer_prepay_snap_session(uuid,uuid,text,text)',
  $anchor$  PERFORM pg_advisory_xact_lock(hashtextextended(p_checkout_key::text, 0));$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

-- Releasing a failed/expired pre-pay checkout restores customer vouchers.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.release_customer_prepay_checkout(uuid,uuid,text)',
  $anchor$  SELECT o.*
  INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.customer_id = p_customer_id
  FOR UPDATE;$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

-- A webhook settlement starts with only a Midtrans id.  Resolve the customer
-- without a row lock, take the common customer lock, and then run the original
-- locked state transition.  Backend-managed orders cannot be reassigned, so
-- the observed customer identity is stable for valid rows.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.settle_customer_prepay_checkout(text,integer,text,text,text,jsonb,timestamp with time zone)',
  $anchor$  SELECT o.*
  INTO v_order
  FROM public.orders AS o
  WHERE o.midtrans_order_id = p_midtrans_order_id
  FOR UPDATE;$anchor$,
  $inject$  SELECT o.customer_id
  INTO v_order.customer_id
  FROM public.orders AS o
  WHERE o.midtrans_order_id = p_midtrans_order_id;

  IF FOUND THEN
    IF v_order.customer_id IS NULL THEN
      RAISE EXCEPTION 'PREPAY_ORDER_CUSTOMER_REQUIRED';
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'vividaqua:customer-order:' || v_order.customer_id::text,
        0
      )
    );
  END IF;

$inject$
);

-- Voucher-only pre-pay creation follows the same customer-first order.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.create_customer_voucher_only_order(uuid,uuid,date,text,jsonb,jsonb)',
  $anchor$  PERFORM pg_advisory_xact_lock(
    hashtextextended('voucher-only:' || p_order_key::text, 0)
  );$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

-- Portal cancellation locks the customer scope before its order and customer
-- rows, including voucher restoration.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.cancel_customer_pending_order(uuid,uuid)',
  $anchor$  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
    AND o.customer_id = p_customer_id
  FOR UPDATE;$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

-- Staff create locks the customer before the customer row.  Calls into pre-pay
-- or voucher-only creation re-enter the same transaction lock safely.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.create_staff_order_atomic(uuid,uuid,date,text,jsonb)',
  $anchor$  SELECT c.*
    INTO v_customer
  FROM public.customers AS c
  WHERE c.id = p_customer_id
  FOR UPDATE;$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

-- Correction may deliberately reassign an ordinary order.  Lock the original
-- and target customers in UUID order so A->B and B->A cannot invert each other.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.correct_staff_order_atomic(uuid,uuid,date,text,integer,jsonb,text)',
  $anchor$  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;$anchor$,
  $inject$  SELECT o.customer_id
    INTO v_order.customer_id
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  IF NOT FOUND OR v_order.customer_id >= p_customer_id THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'vividaqua:customer-order:' || p_customer_id::text,
        0
      )
    );
    IF v_order.customer_id IS NOT NULL
       AND v_order.customer_id IS DISTINCT FROM p_customer_id THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          'vividaqua:customer-order:' || v_order.customer_id::text,
          0
        )
      );
    END IF;
  ELSE
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'vividaqua:customer-order:' || v_order.customer_id::text,
        0
      )
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'vividaqua:customer-order:' || p_customer_id::text,
        0
      )
    );
  END IF;

$inject$
);

-- Delivery and staff cancellation begin with an unlocked identity probe.  The
-- common customer lock is always acquired before the original order row lock.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.finalize_staff_order_delivery(uuid,date,text,text,integer,jsonb,boolean,text,text)',
  $anchor$  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;$anchor$,
  $inject$  SELECT o.customer_id
    INTO v_order.customer_id
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  IF FOUND THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'vividaqua:customer-order:' || v_order.customer_id::text,
        0
      )
    );
  END IF;

$inject$
);

SELECT public.__patch_customer_order_lock_for_migration(
  'public.cancel_staff_order_atomic(uuid)',
  $anchor$  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;$anchor$,
  $inject$  SELECT o.customer_id
    INTO v_order.customer_id
  FROM public.orders AS o
  WHERE o.id = p_order_id;

  IF FOUND THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'vividaqua:customer-order:' || v_order.customer_id::text,
        0
      )
    );
  END IF;

$inject$
);

-- Customer later-pay create/edit now takes the common customer lock before its
-- request-key lock and before either the edited order or customer row.
SELECT public.__patch_customer_order_lock_for_migration(
  'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)',
  $anchor$  IF p_order_key IS NOT NULL THEN
    -- Serialize same-key retries before probing the unique identity row.$anchor$,
  $inject$  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || p_customer_id::text,
      0
    )
  );

$inject$
);

DROP FUNCTION public.__patch_customer_order_lock_for_migration(text, text, text);

-- Scheduling used to be the sole live staff path that updated orders directly.
-- Give it the same authenticated, branch-scoped, customer-first transaction.
CREATE OR REPLACE FUNCTION public.set_staff_order_schedule_status(
  p_order_id uuid,
  p_status text
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
  v_order_json jsonb;
  v_has_backend_identity boolean;
  v_old_status text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'authenticated'
     OR v_actor IS NULL
     OR p_order_id IS NULL THEN
    RAISE EXCEPTION 'STAFF_ORDER_IDENTITY_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('pending', 'scheduled') THEN
    RAISE EXCEPTION 'INVALID_ORDER_SCHEDULE_STATUS' USING ERRCODE = '22023';
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';
  v_staff_branch := v_context->>'branch';
  IF v_context->>'status' IS DISTINCT FROM 'active'
     OR NOT COALESCE(v_role IN (
       'operator', 'operator_manager', 'admin', 'branch_admin', 'operations_admin'
     ), false) THEN
    RAISE EXCEPTION 'STAFF_ORDER_SCHEDULE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  -- Identity probe only: no row lock is taken before the common customer lock.
  SELECT o.customer_id
    INTO v_customer_id
  FROM public.orders AS o
  WHERE o.id = p_order_id;
  IF NOT FOUND OR v_customer_id IS NULL THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'vividaqua:customer-order:' || v_customer_id::text,
      0
    )
  );

  SELECT o.*
    INTO v_order
  FROM public.orders AS o
  WHERE o.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;
  IF v_order.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'ORDER_CUSTOMER_CHANGED_RETRY' USING ERRCODE = '40001';
  END IF;

  v_order_json := pg_catalog.to_jsonb(v_order);
  v_old_status := COALESCE(v_order.status::text, 'pending');
  v_has_backend_identity :=
    NULLIF(v_order_json->>'midtrans_order_id', '') IS NOT NULL
    OR NULLIF(v_order_json->>'qris_charged_idr', '') IS NOT NULL
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
    OR COALESCE((v_order_json->>'voucher_used')::numeric, 0) <> 0
    OR COALESCE((v_order_json->>'voucher_deduction')::numeric, 0) <> 0
    OR public.staff_order_has_voucher_ledger(p_order_id);

  IF v_role <> 'admin'
     AND NOT (v_role = 'operator_manager' AND v_staff_branch = 'All')
     AND (
       v_staff_branch IS NULL
       OR v_staff_branch = 'All'
       OR v_order.branch IS DISTINCT FROM v_staff_branch
     ) THEN
    RAISE EXCEPTION 'ORDER_BRANCH_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_order.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ORDER_SCHEDULE_TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF v_old_status = p_status THEN
    RETURN pg_catalog.jsonb_build_object(
      'order_id', p_order_id,
      'status', p_status,
      'changed', false
    );
  END IF;

  IF NOT (
       (v_old_status = 'pending' AND p_status = 'scheduled')
       OR (v_old_status = 'scheduled' AND p_status = 'pending')
     )
     OR (
       v_has_backend_identity
       AND v_order.payment_status::text IS DISTINCT FROM 'paid'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.order_items AS oi
       WHERE oi.order_id = p_order_id
       GROUP BY oi.order_id
       HAVING SUM(oi.quantity::bigint) > 0
     ) THEN
    RAISE EXCEPTION 'ORDER_SCHEDULE_TRANSITION_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  UPDATE public.orders AS o
  SET status = p_status,
      updated_at = pg_catalog.now()
  WHERE o.id = p_order_id;

  RETURN pg_catalog.jsonb_build_object(
    'order_id', p_order_id,
    'status', p_status,
    'changed', true
  );
END;
$function$;

ALTER FUNCTION public.set_staff_order_schedule_status(uuid, text)
  OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION
  public.set_staff_order_schedule_status(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_staff_order_schedule_status(uuid, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_staff_order_schedule_status(uuid, text) IS
  'Atomically toggles a staff-visible order between pending and scheduled after taking the shared per-customer transaction lock.';

COMMIT;
