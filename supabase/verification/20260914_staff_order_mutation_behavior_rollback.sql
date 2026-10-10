-- LOCAL TEST DATABASES ONLY.
-- Behaviour regression for 20260914190000_harden_staff_order_mutations.sql.
-- Every fixture and mutation is enclosed in one transaction and rolled back.
-- Expected result: every row is PASS, followed by ROLLBACK.

DO $database_guard$
BEGIN
  IF current_database() <> 'audit_root_acl18' THEN
    RAISE EXCEPTION
      'LOCAL_ONLY: run this probe only on audit_root_acl18';
  END IF;
END;
$database_guard$;

BEGIN;

CREATE TEMP TABLE staff_order_acl_context (
  actor_id uuid NOT NULL,
  missing_actor_id uuid NOT NULL,
  branch_a text NOT NULL,
  branch_b text NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL,
  product_price integer NOT NULL,
  product_is_refill boolean NOT NULL,
  customer_a uuid NOT NULL,
  customer_b uuid NOT NULL,
  customer_prepay uuid NOT NULL,
  order_pending_a uuid NOT NULL,
  order_pending_b uuid NOT NULL,
  order_scheduled_a uuid NOT NULL,
  order_delivered_a uuid NOT NULL,
  order_delivered_b uuid NOT NULL,
  order_paid_manual_a uuid NOT NULL,
  order_backend_unpaid_a uuid NOT NULL,
  order_backend_paid_a uuid NOT NULL,
  order_portal_a uuid NOT NULL,
  order_safe_delete_a uuid NOT NULL,
  order_sales_new_a uuid NOT NULL,
  order_sales_prepay_a uuid NOT NULL,
  order_hard_backend_paid_a uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO staff_order_acl_context
SELECT
  (
    SELECT p.id
    FROM public.profiles AS p
    JOIN auth.users AS u ON u.id = p.id
    ORDER BY p.id
    LIMIT 1
  ),
  gen_random_uuid(),
  (
    SELECT b.name
    FROM public.branches AS b
    WHERE b.status = 'active'
    ORDER BY b.name
    LIMIT 1
  ),
  (
    SELECT b.name
    FROM public.branches AS b
    WHERE b.status = 'active'
    ORDER BY b.name
    OFFSET 1 LIMIT 1
  ),
  p.id,
  p.name,
  p.price,
  COALESCE(p.is_refill, false),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
FROM public.products AS p
WHERE p.status = 'active'
ORDER BY p.id
LIMIT 1;

DO $fixture_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staff_order_acl_context) THEN
    RAISE EXCEPTION 'TEST_FIXTURE_MISSING: active product not found';
  END IF;
END;
$fixture_guard$;

CREATE TEMP TABLE staff_order_acl_results (
  sequence integer GENERATED ALWAYS AS IDENTITY,
  check_name text NOT NULL,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

GRANT SELECT ON TABLE staff_order_acl_context
  TO authenticated, service_role;
GRANT SELECT, INSERT ON TABLE staff_order_acl_results
  TO authenticated, service_role;

CREATE FUNCTION pg_temp.clear_test_claims()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END;
$function$;

CREATE FUNCTION pg_temp.set_test_claims(p_sub uuid, p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', p_role, 'sub', p_sub)::text,
    true
  );
  PERFORM set_config('request.jwt.claim.sub', p_sub::text, true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
END;
$function$;

CREATE FUNCTION pg_temp.expect_dml(
  p_check_name text,
  p_sql text,
  p_should_succeed boolean,
  p_expected_rows integer DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_rows integer := 0;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    IF p_should_succeed AND v_rows = p_expected_rows THEN
      INSERT INTO pg_temp.staff_order_acl_results (
        check_name, status, detail
      ) VALUES (
        p_check_name, 'PASS', format('affected %s row(s)', v_rows)
      );
    ELSIF NOT p_should_succeed AND v_rows = 0 THEN
      INSERT INTO pg_temp.staff_order_acl_results (
        check_name, status, detail
      ) VALUES (
        p_check_name, 'PASS', 'rejected by row visibility/policy'
      );
    ELSIF p_should_succeed THEN
      RAISE EXCEPTION 'unexpected row count: %', v_rows
        USING ERRCODE = 'ZX002';
    ELSE
      RAISE EXCEPTION 'unexpectedly affected % row(s)', v_rows
        USING ERRCODE = 'ZX001';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'ZX001' OR SQLSTATE 'ZX002' THEN
      INSERT INTO pg_temp.staff_order_acl_results (
        check_name, status, detail
      ) VALUES (p_check_name, 'BLOCK', SQLERRM);
    WHEN OTHERS THEN
      IF NOT p_should_succeed AND SQLSTATE = '42501' THEN
        INSERT INTO pg_temp.staff_order_acl_results (
          check_name, status, detail
        ) VALUES (
          p_check_name, 'PASS', format('rejected with SQLSTATE %s', SQLSTATE)
        );
      ELSE
        INSERT INTO pg_temp.staff_order_acl_results (
          check_name, status, detail
        ) VALUES (
          p_check_name, 'BLOCK',
          format('SQLSTATE %s: %s', SQLSTATE, SQLERRM)
        );
      END IF;
  END;
END;
$function$;

CREATE FUNCTION pg_temp.expect_true(p_check_name text, p_sql text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_ok boolean;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v_ok;
    INSERT INTO pg_temp.staff_order_acl_results (
      check_name, status, detail
    ) VALUES (
      p_check_name,
      CASE WHEN v_ok IS TRUE THEN 'PASS' ELSE 'BLOCK' END,
      CASE WHEN v_ok IS TRUE THEN 'postcondition satisfied'
           ELSE 'postcondition was false or null' END
    );
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO pg_temp.staff_order_acl_results (
        check_name, status, detail
      ) VALUES (
        p_check_name, 'BLOCK',
        format('SQLSTATE %s: %s', SQLSTATE, SQLERRM)
      );
  END;
END;
$function$;

-- Isolated customers and orders are created as postgres. Trigger bypass is
-- intentional here; the role tests below exercise all browser-facing paths.
INSERT INTO public.customers (
  id, name, address, whatsapp, branch, customer_type, is_active, created_by
)
SELECT customer_a, 'ACL 1900 Customer A', 'Test address', '620000000001',
       branch_a, 'later_pay', true, actor_id
FROM staff_order_acl_context
UNION ALL
SELECT customer_b, 'ACL 1900 Customer B', 'Test address', '620000000002',
       branch_b, 'later_pay', true, actor_id
FROM staff_order_acl_context
UNION ALL
SELECT customer_prepay, 'ACL 1900 Prepay', 'Test address', '620000000003',
       branch_a, 'pre_pay', true, actor_id
FROM staff_order_acl_context;

INSERT INTO public.orders (
  id, customer_id, customer_name, customer_address, customer_whatsapp,
  customer_discount, branch, total_amount, status, payment_status,
  paid_date, delivery_date, created_by, created_by_display, is_active,
  note, payment_confirmation_type, payment_evidence
)
SELECT
  fixture.order_id, fixture.customer_id, fixture.customer_name,
  'Test address', '620000000000', 0, fixture.branch, 100,
  fixture.order_status, fixture.payment_status, fixture.paid_date,
  current_date + 1, fixture.created_by, fixture.created_by_display, true,
  fixture.note, fixture.confirmation_type, fixture.payment_evidence
FROM staff_order_acl_context AS context
CROSS JOIN LATERAL (VALUES
  (context.order_pending_a, context.customer_a, 'ACL Pending A',
    context.branch_a, 'pending', 'unpaid', NULL::date,
    context.actor_id, 'Sales', 'pending-a', NULL::text, NULL::text),
  (context.order_pending_b, context.customer_b, 'ACL Pending B',
    context.branch_b, 'pending', 'unpaid', NULL::date,
    context.actor_id, 'Sales', 'pending-b', NULL::text, NULL::text),
  (context.order_scheduled_a, context.customer_a, 'ACL Scheduled A',
    context.branch_a, 'scheduled', 'unpaid', NULL::date,
    context.actor_id, 'Sales', 'scheduled-a', NULL::text, NULL::text),
  (context.order_delivered_a, context.customer_a, 'ACL Delivered A',
    context.branch_a, 'delivered', 'unpaid', NULL::date,
    context.actor_id, 'Sales', 'delivered-a', NULL::text, NULL::text),
  (context.order_delivered_b, context.customer_b, 'ACL Delivered B',
    context.branch_b, 'delivered', 'unpaid', NULL::date,
    context.actor_id, 'Sales', 'delivered-b', NULL::text, NULL::text),
  (context.order_paid_manual_a, context.customer_a, 'ACL Manual Paid A',
    context.branch_a, 'delivered', 'paid', current_date,
    context.actor_id, 'Sales', 'paid-manual-a', 'manual', 'fixture-proof'),
  (context.order_backend_unpaid_a, context.customer_prepay,
    'ACL Backend Unpaid A', context.branch_a, 'pending', 'unpaid', NULL::date,
    NULL::uuid, 'Customer Portal', 'backend-unpaid-a', 'pre_pay', NULL::text),
  (context.order_backend_paid_a, context.customer_prepay,
    'ACL Backend Paid A', context.branch_a, 'pending', 'paid', current_date,
    NULL::uuid, 'Customer Portal', 'backend-paid-a', 'pre_pay', NULL::text),
  (context.order_portal_a, context.customer_a, 'ACL Portal A',
    context.branch_a, 'pending', 'unpaid', NULL::date,
    NULL::uuid, 'Customer Portal', 'portal-a', NULL::text, NULL::text),
  (context.order_safe_delete_a, context.customer_a, 'ACL Safe Delete A',
    context.branch_a, 'pending', 'unpaid', NULL::date,
    context.actor_id, 'Sales', 'safe-delete-a', NULL::text, NULL::text),
  (context.order_hard_backend_paid_a, context.customer_prepay,
    'ACL Hard Backend Paid A', context.branch_a, 'pending', 'paid', current_date,
    context.actor_id, 'Sales', 'hard-backend-paid-a', 'pre_pay', NULL::text)
) AS fixture(
  order_id, customer_id, customer_name, branch, order_status,
  payment_status, paid_date, created_by, created_by_display, note,
  confirmation_type, payment_evidence
);

INSERT INTO public.order_items (
  order_id, product, product_id, is_refill, quantity, unit_price, discount
)
SELECT fixture.order_id, context.product_name, context.product_id,
       context.product_is_refill, 1, context.product_price, 0
FROM staff_order_acl_context AS context
CROSS JOIN LATERAL (VALUES
  (context.order_pending_a), (context.order_pending_b),
  (context.order_scheduled_a), (context.order_delivered_a),
  (context.order_delivered_b), (context.order_paid_manual_a),
  (context.order_backend_unpaid_a), (context.order_backend_paid_a),
  (context.order_portal_a), (context.order_safe_delete_a),
  (context.order_hard_backend_paid_a)
) AS fixture(order_id);

-- A hard backend key always wins over a staff-looking creator marker.
UPDATE public.orders AS orders
SET
  prepay_checkout_key = gen_random_uuid(),
  prepay_request_hash = md5(gen_random_uuid()::text),
  midtrans_order_id = 'pop_acl_1900_' || replace(gen_random_uuid()::text, '-', ''),
  qris_charged_idr = 100
FROM staff_order_acl_context AS context
WHERE orders.id = context.order_hard_backend_paid_a;

-- Missing and inactive identities fail closed.
SELECT
  set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated', 'sub', missing_actor_id
    )::text,
    true
  ),
  set_config('request.jwt.claim.sub', missing_actor_id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true)
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'missing_profile_update_denied',
  $sql$UPDATE public.orders SET note = 'forbidden'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

UPDATE public.profiles
SET role = 'sales', branch = context.branch_a, status = 'inactive'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT
  set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', actor_id)::text,
    true
  ),
  set_config('request.jwt.claim.sub', actor_id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true)
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'inactive_profile_update_denied',
  $sql$UPDATE public.orders SET note = 'forbidden'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

-- Sales: create/correct ordinary branch orders, but never schedule, take an
-- early payment, cross branches, or control backend identity.
UPDATE public.profiles
SET role = 'sales', branch = context.branch_a, status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'sales_insert_order_allowed',
  $sql$
    INSERT INTO public.orders (
      customer_id, customer_name, customer_address, customer_whatsapp,
      customer_discount, branch, total_amount, delivery_date, note,
      created_by, created_by_display, payment_status
    )
    SELECT customer_a, 'ACL Sales New', 'Test address', '620000000004',
           0, branch_a, 999999, current_date + 1, 'sales-new',
           missing_actor_id, 'spoofed actor', 'unpaid'
    FROM pg_temp.staff_order_acl_context
    RETURNING id
  $sql$,
  true
);
SELECT pg_temp.expect_dml(
  'sales_later_pay_initial_paid_denied',
  $sql$
    INSERT INTO public.orders (
      customer_id, customer_name, customer_address, customer_whatsapp,
      customer_discount, branch, total_amount, delivery_date, note,
      created_by, created_by_display, payment_status, paid_date
    )
    SELECT customer_a, 'ACL Fake Free', 'Test address', '620000000006',
           0, branch_a, 0, current_date + 1, 'fake-free-paid',
           actor_id, 'Sales', 'paid', current_date
    FROM pg_temp.staff_order_acl_context
  $sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_prepay_initial_unpaid_denied',
  $sql$
    INSERT INTO public.orders (
      customer_id, customer_name, customer_address, customer_whatsapp,
      customer_discount, branch, total_amount, delivery_date, note,
      created_by, created_by_display, payment_status
    )
    SELECT customer_prepay, 'ACL Fake Unpaid Prepay', 'Test address',
           '620000000007', 0, branch_a, 0, current_date + 1,
           'fake-unpaid-prepay', actor_id, 'Sales', 'unpaid'
    FROM pg_temp.staff_order_acl_context
  $sql$,
  false
);
RESET ROLE;

-- Capture the generated order id without exposing id INSERT to authenticated.
UPDATE staff_order_acl_context AS context
SET order_sales_new_a = order_row.id
FROM (
  SELECT id
  FROM public.orders
  WHERE note = 'sales-new'
  ORDER BY created_at DESC, id
  LIMIT 1
) AS order_row;

SELECT pg_temp.expect_true(
  'sales_insert_identity_and_zero_total_canonical',
  $sql$
    SELECT created_by = context.actor_id
       AND created_by_display = 'Sales'
       AND total_amount = 0
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_sales_new_a
  $sql$
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'sales_insert_matching_item_allowed',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT order_sales_new_a, product_name, product_id, product_is_refill,
           2, product_price, 0
    FROM pg_temp.staff_order_acl_context
  $sql$,
  true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'item_insert_recomputes_total',
  $sql$
    SELECT orders.total_amount = context.product_price * 2
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_sales_new_a
  $sql$
);

-- The existing Sales UI creates a paid pre-pay order header first and inserts
-- its item rows in a second request.  A bare pre_pay marker on a canonical
-- staff-created row must not be mistaken for Midtrans/backend ownership.
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'sales_insert_staff_prepay_order_allowed',
  $sql$
    INSERT INTO public.orders (
      customer_id, customer_name, customer_address, customer_whatsapp,
      customer_discount, branch, total_amount, delivery_date, note,
      created_by, created_by_display, payment_status, paid_date,
      payment_confirmation_type
    )
    SELECT customer_prepay, 'ACL Sales Prepay', 'Test address', '620000000005',
           0, branch_a, 999999, current_date + 1, 'sales-prepay-new',
           missing_actor_id, 'spoofed actor', 'paid', current_date, 'pre_pay'
    FROM pg_temp.staff_order_acl_context
    RETURNING id
  $sql$,
  true
);
RESET ROLE;

UPDATE staff_order_acl_context AS context
SET order_sales_prepay_a = order_row.id
FROM (
  SELECT id
  FROM public.orders
  WHERE note = 'sales-prepay-new'
  ORDER BY created_at DESC, id
  LIMIT 1
) AS order_row;

SELECT pg_temp.expect_true(
  'sales_staff_prepay_identity_and_payment_canonical',
  $sql$
    SELECT created_by = context.actor_id
       AND created_by_display = 'Sales'
       AND total_amount = 0
       AND payment_status = 'paid'
       AND payment_confirmation_type = 'pre_pay'
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_sales_prepay_a
  $sql$
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'sales_insert_staff_prepay_items_allowed',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT context.order_sales_prepay_a, context.product_name,
           context.product_id, context.product_is_refill,
           fixture.quantity, context.product_price, 0
    FROM pg_temp.staff_order_acl_context AS context
    CROSS JOIN (VALUES (1), (2)) AS fixture(quantity)
  $sql$,
  true,
  2
);
SELECT pg_temp.expect_dml(
  'sales_staff_prepay_payment_undo_denied',
  $sql$UPDATE public.orders
       SET payment_status = 'unpaid', paid_date = NULL,
           payment_confirmation_type = NULL
       WHERE id = (
         SELECT order_sales_prepay_a
         FROM pg_temp.staff_order_acl_context
       )$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_staff_prepay_evidence_change_denied',
  $sql$UPDATE public.orders SET payment_evidence = 'tamper'
       WHERE id = (
         SELECT order_sales_prepay_a
         FROM pg_temp.staff_order_acl_context
       )$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_legacy_portal_prepay_item_insert_denied',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT order_backend_paid_a, product_name, product_id, product_is_refill,
           1, product_price, 0
    FROM pg_temp.staff_order_acl_context
  $sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_legacy_portal_prepay_correction_denied',
  $sql$UPDATE public.orders SET note = 'portal-prepay-tamper'
       WHERE id = (
         SELECT order_backend_paid_a
         FROM pg_temp.staff_order_acl_context
       )$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_portal_creator_spoof_denied',
  $sql$UPDATE public.orders
       SET created_by = (
             SELECT actor_id FROM pg_temp.staff_order_acl_context
           ),
           created_by_display = 'Sales'
       WHERE id = (
         SELECT order_backend_paid_a
         FROM pg_temp.staff_order_acl_context
       )$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_hard_backend_item_update_denied',
  $sql$UPDATE public.order_items SET quantity = 2
       WHERE order_id = (
         SELECT order_hard_backend_paid_a
         FROM pg_temp.staff_order_acl_context
       )$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'sales_staff_prepay_items_recompute_total',
  $sql$
    SELECT orders.total_amount = context.product_price * 3
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_sales_prepay_a
  $sql$
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'sales_total_spoof_is_ignored',
  $sql$UPDATE public.orders SET total_amount = 999999
       WHERE id = (SELECT order_sales_new_a FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'authoritative_total_survives_spoof',
  $sql$
    SELECT orders.total_amount = context.product_price * 2
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_sales_new_a
  $sql$
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'sales_cross_branch_update_denied',
  $sql$UPDATE public.orders SET note = 'cross-branch'
       WHERE id = (SELECT order_pending_b FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_schedule_denied',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_early_payment_denied',
  $sql$UPDATE public.orders
       SET payment_status = 'paid', paid_date = current_date,
           payment_confirmation_type = 'manual'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_backend_identity_update_denied',
  $sql$UPDATE public.orders SET qris_charged_idr = 123
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_portal_inactivation_allowed',
  $sql$UPDATE public.orders SET is_active = false
       WHERE id = (SELECT order_portal_a FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'sales_staff_order_inactivation_denied',
  $sql$UPDATE public.orders SET is_active = false
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_product_identity_mismatch_denied',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT order_sales_new_a, product_name || ' mismatch', product_id,
           product_is_refill, 1, product_price, 0
    FROM pg_temp.staff_order_acl_context
  $sql$,
  false
);
SELECT pg_temp.expect_dml(
  'null_product_id_price_spoof_denied',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT order_sales_new_a, product_name, NULL, product_is_refill,
           1, product_price, 0
    FROM pg_temp.staff_order_acl_context
  $sql$,
  false
);
SELECT pg_temp.expect_dml(
  'sales_delete_reinsert_correction_step_one',
  $sql$DELETE FROM public.order_items
       WHERE order_id = (SELECT order_sales_new_a FROM pg_temp.staff_order_acl_context)$sql$,
  true,
  2
);
SELECT pg_temp.expect_dml(
  'sales_delete_reinsert_correction_step_two',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT order_sales_new_a, product_name, product_id, product_is_refill,
           3, product_price, 0
    FROM pg_temp.staff_order_acl_context
  $sql$,
  true
);
SELECT pg_temp.expect_dml(
  'sales_delete_reinsert_correction_step_three',
  $sql$UPDATE public.orders SET note = 'corrected', total_amount = 1
       WHERE id = (SELECT order_sales_new_a FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'sales_correction_final_total_authoritative',
  $sql$
    SELECT orders.total_amount = context.product_price * 3
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_sales_new_a
  $sql$
);

-- Operator: scheduling and delivery are explicit one-way transitions; only
-- delivered item quantity can change.
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'operator', branch = context.branch_a, status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'operator_schedule_allowed',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_note_only_update_denied',
  $sql$UPDATE public.orders SET note = 'operator-spoof'
       WHERE id = (SELECT order_scheduled_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'operator_pre_delivery_quantity_denied',
  $sql$UPDATE public.order_items SET quantity = 2
       WHERE order_id = (SELECT order_scheduled_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'operator_cross_branch_schedule_denied',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (SELECT order_pending_b FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'operator_delivery_allowed',
  $sql$UPDATE public.orders
       SET status = 'delivered', delivered_date = current_date,
           delivered_by = 'spoofed actor'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_delivered_quantity_allowed',
  $sql$UPDATE public.order_items SET quantity = 2
       WHERE order_id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_unit_price_update_denied',
  $sql$UPDATE public.order_items SET unit_price = unit_price + 1
       WHERE order_id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'operator_item_insert_denied',
  $sql$
    INSERT INTO public.order_items (
      order_id, product, product_id, is_refill, quantity, unit_price, discount
    )
    SELECT order_pending_a, product_name, product_id, product_is_refill,
           1, product_price, 0
    FROM pg_temp.staff_order_acl_context
  $sql$,
  false
);
SELECT pg_temp.expect_dml(
  'operator_backend_unpaid_schedule_denied',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (SELECT order_backend_unpaid_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'operator_backend_paid_schedule_allowed',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (SELECT order_backend_paid_a FROM pg_temp.staff_order_acl_context)
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_backend_paid_delivery_allowed',
  $sql$UPDATE public.orders
       SET status = 'delivered', delivered_date = current_date
       WHERE id = (SELECT order_backend_paid_a FROM pg_temp.staff_order_acl_context)
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_staff_prepay_schedule_allowed',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (
         SELECT order_sales_prepay_a
         FROM pg_temp.staff_order_acl_context
       )
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_staff_prepay_delivery_allowed',
  $sql$UPDATE public.orders
       SET status = 'delivered', delivered_date = current_date
       WHERE id = (
         SELECT order_sales_prepay_a
         FROM pg_temp.staff_order_acl_context
       )
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'operator_backend_item_update_denied',
  $sql$UPDATE public.order_items SET quantity = 2
       WHERE order_id = (SELECT order_backend_paid_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'operator_delivery_actor_and_total_canonical',
  $sql$
    SELECT orders.delivered_by IS NOT NULL
       AND orders.delivered_by <> 'spoofed actor'
       AND orders.total_amount = context.product_price * 2
    FROM public.orders AS orders
    CROSS JOIN pg_temp.staff_order_acl_context AS context
    WHERE orders.id = context.order_pending_a
  $sql$
);

-- A global operator manager retains the established cross-branch trip scope.
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'operator_manager', branch = 'All', status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'operator_manager_global_schedule_allowed',
  $sql$UPDATE public.orders SET status = 'scheduled'
       WHERE id = (SELECT order_pending_b FROM pg_temp.staff_order_acl_context)
       RETURNING id$sql$,
  true
);
RESET ROLE;

-- A global Finance user may confirm only delivered, ordinary later-pay
-- receivables. Null confirmation type and pre-delivery payment both fail.
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'finance', branch = 'All', status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'finance_pre_delivery_payment_denied',
  $sql$UPDATE public.orders
       SET payment_status = 'paid', paid_date = current_date,
           payment_confirmation_type = 'manual'
       WHERE id = (SELECT order_pending_b FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'finance_global_delivered_payment_allowed',
  $sql$UPDATE public.orders
       SET payment_status = 'paid', paid_date = current_date,
           payment_confirmation_type = 'manual',
           payment_confirmed_by = 'spoofed actor'
       WHERE id = (SELECT order_delivered_b FROM pg_temp.staff_order_acl_context)
       RETURNING id$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'finance_null_confirmation_denied',
  $sql$UPDATE public.orders
       SET payment_status = 'paid', paid_date = current_date,
           payment_confirmation_type = NULL
       WHERE id = (SELECT order_delivered_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'finance_business_field_update_denied',
  $sql$UPDATE public.orders SET note = 'finance-spoof'
       WHERE id = (SELECT order_delivered_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'finance_backend_payment_undo_denied',
  $sql$UPDATE public.orders
       SET payment_status = 'unpaid', paid_date = NULL,
           payment_confirmation_type = NULL
       WHERE id = (SELECT order_backend_paid_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'finance_payment_actor_canonical',
  $sql$
    SELECT payment_confirmed_by IS NOT NULL
       AND payment_confirmed_by <> 'spoofed actor'
    FROM public.orders
    WHERE id = (
      SELECT order_delivered_b FROM pg_temp.staff_order_acl_context
    )
  $sql$
);

-- Branch admin can undo an ordinary payment in-scope, but cannot cross a
-- branch or change a backend-managed payment.
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'branch_admin', branch = context.branch_a, status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'branch_admin_manual_payment_undo_allowed',
  $sql$UPDATE public.orders
       SET payment_status = 'unpaid', paid_date = NULL,
           payment_evidence = NULL, payment_confirmation_type = NULL,
           payment_confirmed_by = NULL,
           evidence_amount_verified = NULL,
           evidence_detected_amount = NULL
       WHERE id = (SELECT order_paid_manual_a FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'branch_admin_cross_branch_update_denied',
  $sql$UPDATE public.orders SET note = 'cross-branch-admin'
       WHERE id = (SELECT order_delivered_b FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
SELECT pg_temp.expect_dml(
  'branch_admin_backend_undo_denied',
  $sql$UPDATE public.orders
       SET payment_status = 'unpaid', paid_date = NULL,
           payment_confirmation_type = NULL
       WHERE id = (SELECT order_backend_paid_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.expect_true(
  'manual_payment_undo_clears_evidence',
  $sql$
    SELECT payment_status = 'unpaid'
       AND paid_date IS NULL
       AND payment_evidence IS NULL
       AND payment_confirmation_type IS NULL
       AND payment_confirmed_by IS NULL
       AND to_jsonb(orders)->'evidence_amount_verified' = 'null'::jsonb
       AND to_jsonb(orders)->'evidence_detected_amount' = 'null'::jsonb
    FROM public.orders AS orders
    WHERE id = (
      SELECT order_paid_manual_a FROM pg_temp.staff_order_acl_context
    )
  $sql$
);

-- Global admin retains cross-branch ordinary correction and safe deletion.
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'admin', branch = 'All', status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'admin_cross_branch_correction_allowed',
  $sql$UPDATE public.orders SET note = 'admin-corrected'
       WHERE id = (SELECT order_delivered_b FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'admin_safe_delete_cascades',
  $sql$DELETE FROM public.orders
       WHERE id = (SELECT order_safe_delete_a FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
SELECT pg_temp.expect_dml(
  'admin_backend_delete_denied',
  $sql$DELETE FROM public.orders
       WHERE id = (SELECT order_backend_paid_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;

-- Non-operational roles remain read-only for order mutations.
SELECT pg_temp.clear_test_claims();
UPDATE public.profiles
SET role = 'operations_admin', branch = context.branch_a, status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'operations_admin_order_update_denied',
  $sql$UPDATE public.orders SET note = 'operations-admin-spoof'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;
SELECT pg_temp.clear_test_claims();

UPDATE public.profiles
SET role = 'adminFin', branch = 'All', status = 'active'
FROM staff_order_acl_context AS context
WHERE id = context.actor_id;
SELECT pg_temp.set_test_claims(actor_id, 'authenticated')
FROM staff_order_acl_context;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_dml(
  'admin_fin_order_update_denied',
  $sql$UPDATE public.orders SET note = 'admin-fin-spoof'
       WHERE id = (SELECT order_pending_a FROM pg_temp.staff_order_acl_context)$sql$,
  false
);
RESET ROLE;

-- service_role remains available to trusted Edge Functions.
SELECT
  set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'service_role', 'sub', actor_id)::text,
    true
  ),
  set_config('request.jwt.claim.sub', actor_id::text, true),
  set_config('request.jwt.claim.role', 'service_role', true)
FROM staff_order_acl_context;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_dml(
  'service_role_trusted_total_override_allowed',
  $sql$UPDATE public.orders SET total_amount = 123
       WHERE id = (SELECT order_pending_b FROM pg_temp.staff_order_acl_context)$sql$,
  true
);
RESET ROLE;

SELECT sequence, check_name, status, detail
FROM staff_order_acl_results
ORDER BY sequence;

DO $assert_all_passed$
DECLARE
  v_blocks integer;
BEGIN
  SELECT count(*) INTO v_blocks
  FROM staff_order_acl_results
  WHERE status <> 'PASS';

  IF v_blocks <> 0 THEN
    RAISE EXCEPTION 'STAFF_ORDER_ACL_REGRESSION_FAILED: % blocked check(s)',
      v_blocks;
  END IF;
END;
$assert_all_passed$;

ROLLBACK;
