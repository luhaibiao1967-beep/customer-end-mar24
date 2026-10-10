-- LOCAL TEST DATABASES ONLY.
-- Behaviour and rollback regression for
-- 20260914220000_atomic_customer_later_pay_order.sql.
-- Every fixture, failure trigger and mutation is rolled back. Run with psql
-- -v ON_ERROR_STOP=1. Expected result: 42 PASS rows, then ROLLBACK.

DO $database_guard$
BEGIN
  IF current_database() NOT IN ('audit_root_acl18', 'audit_cafa_customer') THEN
    RAISE EXCEPTION
      'LOCAL_ONLY: run only on audit_root_acl18 or audit_cafa_customer';
  END IF;
END;
$database_guard$;

BEGIN;

-- The historical cafa clone lacks this Supabase helper. It exists only for
-- this rolled-back test transaction and lets the production triggers run.
DO $local_clone_prerequisites$
BEGIN
  IF to_regprocedure('auth.role()') IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION auth.role()
      RETURNS text
      LANGUAGE sql
      STABLE
      AS $body$
        SELECT COALESCE(
          NULLIF(current_setting('request.jwt.claim.role', true), ''),
          (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb)->>'role'
        )
      $body$
    $ddl$;
  END IF;
END;
$local_clone_prerequisites$;

DO $migration_guard$
BEGIN
  IF to_regprocedure(
       'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)'
     ) IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'orders'
         AND column_name IN (
           'later_pay_order_key', 'later_pay_order_request_hash'
         )
       GROUP BY table_schema, table_name
       HAVING count(*) = 2
     ) THEN
    RAISE EXCEPTION
      'MIGRATION_MISSING: apply 20260914220000_atomic_customer_later_pay_order.sql first';
  END IF;
END;
$migration_guard$;

CREATE TEMP TABLE later_pay_results (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE later_pay_context (
  branch_name text NOT NULL,
  other_branch_name text NOT NULL,
  inactive_branch_name text NOT NULL,
  refill_product_id uuid NOT NULL,
  refill_product_name text NOT NULL,
  main_customer_id uuid NOT NULL,
  full_voucher_customer_id uuid NOT NULL,
  edit_customer_id uuid NOT NULL,
  credit_active_customer_id uuid NOT NULL,
  credit_inactive_customer_id uuid NOT NULL,
  overdue_active_customer_id uuid NOT NULL,
  overdue_inactive_customer_id uuid NOT NULL,
  inactive_customer_id uuid NOT NULL,
  prepay_customer_id uuid NOT NULL,
  inactive_branch_customer_id uuid NOT NULL,
  rollback_customer_id uuid NOT NULL,
  main_key uuid NOT NULL,
  full_voucher_key uuid NOT NULL,
  edit_key uuid NOT NULL,
  credit_inactive_key uuid NOT NULL,
  overdue_inactive_key uuid NOT NULL,
  rollback_key uuid NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE later_pay_free_product (
  product_id uuid NOT NULL,
  product_name text NOT NULL
) ON COMMIT DROP;

GRANT SELECT ON TABLE later_pay_context TO service_role, authenticated, anon;
GRANT SELECT ON TABLE later_pay_free_product TO service_role, authenticated, anon;
GRANT SELECT, INSERT ON TABLE later_pay_results
  TO service_role, authenticated, anon;

CREATE FUNCTION pg_temp.record_later_pay_check(
  p_check_name text,
  p_ok boolean,
  p_detail text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  INSERT INTO pg_temp.later_pay_results(check_name, status, detail)
  VALUES (
    p_check_name,
    CASE WHEN p_ok THEN 'PASS' ELSE 'BLOCK' END,
    p_detail
  );
END;
$function$;

CREATE FUNCTION pg_temp.call_later_pay(
  p_customer_id uuid,
  p_order_key uuid,
  p_edit_order_id uuid,
  p_note text,
  p_quantity integer,
  p_unit_price integer,
  p_discount integer,
  p_deduction integer,
  p_gift_quantity integer,
  p_delivery_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_product_id uuid;
  v_product_name text;
  v_items jsonb := '[]'::jsonb;
  v_deductions jsonb := '[]'::jsonb;
  v_priced_quantity integer;
BEGIN
  SELECT refill_product_id, refill_product_name
    INTO v_product_id, v_product_name
  FROM pg_temp.later_pay_context;

  v_priced_quantity := p_quantity - p_gift_quantity;
  IF p_gift_quantity > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product', v_product_name,
      'is_refill', true,
      'quantity', p_gift_quantity,
      'unit_price', 0,
      'discount', 0
    ));
  END IF;
  IF v_priced_quantity > 0 THEN
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'product', v_product_name,
      'is_refill', true,
      'quantity', v_priced_quantity,
      'unit_price', p_unit_price,
      'discount', p_discount
    ));
  END IF;
  IF p_deduction > 0 THEN
    v_deductions := jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', p_deduction
    ));
  END IF;

  RETURN public.submit_customer_later_pay_order(
    p_customer_id,
    p_order_key,
    p_edit_order_id,
    p_delivery_date,
    p_note,
    v_items,
    v_deductions
  );
END;
$function$;

CREATE FUNCTION pg_temp.expect_later_pay_error(
  p_check_name text,
  p_customer_id uuid,
  p_order_key uuid,
  p_edit_order_id uuid,
  p_note text,
  p_quantity integer,
  p_unit_price integer,
  p_discount integer,
  p_deduction integer,
  p_gift_quantity integer,
  p_delivery_date date,
  p_expected_state text,
  p_expected_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_state text;
  v_message text;
BEGIN
  BEGIN
    PERFORM pg_temp.call_later_pay(
      p_customer_id, p_order_key, p_edit_order_id, p_note,
      p_quantity, p_unit_price, p_discount, p_deduction,
      p_gift_quantity, p_delivery_date
    );
    PERFORM pg_temp.record_later_pay_check(
      p_check_name, false, 'unexpected success'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                            v_message = MESSAGE_TEXT;
    PERFORM pg_temp.record_later_pay_check(
      p_check_name,
      v_state = p_expected_state
        AND position(lower(p_expected_message) IN lower(v_message)) > 0,
      format('SQLSTATE %s: %s', v_state, v_message)
    );
  END;
END;
$function$;

CREATE FUNCTION pg_temp.expect_cancel_error(
  p_check_name text,
  p_customer_id uuid,
  p_order_id uuid,
  p_expected_message text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $function$
DECLARE
  v_state text;
  v_message text;
BEGIN
  BEGIN
    PERFORM public.cancel_customer_pending_order(p_customer_id, p_order_id);
    PERFORM pg_temp.record_later_pay_check(
      p_check_name, false, 'unexpected success'
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE,
                            v_message = MESSAGE_TEXT;
    PERFORM pg_temp.record_later_pay_check(
      p_check_name,
      position(lower(p_expected_message) IN lower(v_message)) > 0,
      format('SQLSTATE %s: %s', v_state, v_message)
    );
  END;
END;
$function$;

WITH fixture_key AS (
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) AS suffix
), active_branch AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, order_cutoff_hour, closed_weekdays
  )
  SELECT gen_random_uuid(), 'Later pay active ' || suffix,
         'Rollback fixture', 'audit-2200-active-' || suffix,
         'active', 23, '{}'::integer[]
  FROM fixture_key
  RETURNING name
), other_branch AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, order_cutoff_hour, closed_weekdays
  )
  SELECT gen_random_uuid(), 'Later pay moved ' || suffix,
         'Rollback fixture', 'audit-2200-moved-' || suffix,
         'inactive', 0, ARRAY[0,1,2,3,4,5,6]::integer[]
  FROM fixture_key
  RETURNING name
), inactive_branch AS (
  INSERT INTO public.branches (
    id, name, address, phone, status, order_cutoff_hour, closed_weekdays
  )
  SELECT gen_random_uuid(), 'Later pay inactive ' || suffix,
         'Rollback fixture', 'audit-2200-inactive-' || suffix,
         'inactive', 23, '{}'::integer[]
  FROM fixture_key
  RETURNING name
), refill_product AS (
  INSERT INTO public.products (
    id, name, price, unit, is_refill, status
  )
  SELECT gen_random_uuid(), 'Atomic later-pay refill ' || suffix,
         12000, 'gallon', true, 'active'
  FROM fixture_key
  RETURNING id, name
), fixture_customers AS (
  INSERT INTO public.customers (
    id, name, address, whatsapp, discount, branch,
    payment_term, customer_type, is_active, credit_limit
  )
  SELECT
    gen_random_uuid(), customer.label || ' ' || fixture_key.suffix,
    'Rollback customer', customer.whatsapp || fixture_key.suffix,
    2000,
    CASE WHEN customer.label = 'inactive-branch'
      THEN inactive_branch.name ELSE active_branch.name END,
    'daily', customer.customer_type, customer.is_active,
    customer.credit_limit
  FROM fixture_key
  CROSS JOIN active_branch
  CROSS JOIN inactive_branch
  CROSS JOIN (VALUES
    ('main', 'audit2200-main-', 'later_pay', true, 200000::numeric),
    ('full-voucher', 'audit2200-full-', 'later_pay', true, 200000::numeric),
    ('edit', 'audit2200-edit-', 'later_pay', true, 200000::numeric),
    ('credit-active', 'audit2200-ca-', 'later_pay', true, 20000::numeric),
    ('credit-inactive', 'audit2200-ci-', 'later_pay', true, 20000::numeric),
    ('overdue-active', 'audit2200-oa-', 'later_pay', true, NULL::numeric),
    ('overdue-inactive', 'audit2200-oi-', 'later_pay', true, NULL::numeric),
    ('inactive', 'audit2200-off-', 'later_pay', false, NULL::numeric),
    ('prepay', 'audit2200-pre-', 'pre_pay', true, NULL::numeric),
    ('inactive-branch', 'audit2200-branch-', 'later_pay', true, NULL::numeric),
    ('rollback', 'audit2200-rb-', 'later_pay', true, 200000::numeric)
  ) AS customer(label, whatsapp, customer_type, is_active, credit_limit)
  RETURNING id, name
), customer_map AS (
  SELECT
    (array_agg(id) FILTER (WHERE name LIKE 'main %'))[1] AS main_id,
    (array_agg(id) FILTER (WHERE name LIKE 'full-voucher %'))[1] AS full_id,
    (array_agg(id) FILTER (WHERE name LIKE 'edit %'))[1] AS edit_id,
    (array_agg(id) FILTER (WHERE name LIKE 'credit-active %'))[1] AS ca_id,
    (array_agg(id) FILTER (WHERE name LIKE 'credit-inactive %'))[1] AS ci_id,
    (array_agg(id) FILTER (WHERE name LIKE 'overdue-active %'))[1] AS oa_id,
    (array_agg(id) FILTER (WHERE name LIKE 'overdue-inactive %'))[1] AS oi_id,
    (array_agg(id) FILTER (WHERE name LIKE 'inactive %'))[1] AS inactive_id,
    (array_agg(id) FILTER (WHERE name LIKE 'prepay %'))[1] AS prepay_id,
    (array_agg(id) FILTER (WHERE name LIKE 'inactive-branch %'))[1] AS ib_id,
    (array_agg(id) FILTER (WHERE name LIKE 'rollback %'))[1] AS rollback_id
  FROM fixture_customers
)
INSERT INTO later_pay_context (
  branch_name, other_branch_name, inactive_branch_name,
  refill_product_id, refill_product_name,
  main_customer_id, full_voucher_customer_id, edit_customer_id,
  credit_active_customer_id, credit_inactive_customer_id,
  overdue_active_customer_id, overdue_inactive_customer_id,
  inactive_customer_id, prepay_customer_id, inactive_branch_customer_id,
  rollback_customer_id, main_key, full_voucher_key, edit_key,
  credit_inactive_key, overdue_inactive_key, rollback_key
)
SELECT
  active_branch.name, other_branch.name, inactive_branch.name,
  refill_product.id, refill_product.name,
  customer_map.main_id, customer_map.full_id, customer_map.edit_id,
  customer_map.ca_id, customer_map.ci_id,
  customer_map.oa_id, customer_map.oi_id,
  customer_map.inactive_id, customer_map.prepay_id, customer_map.ib_id,
  customer_map.rollback_id,
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid()
FROM active_branch
CROSS JOIN other_branch
CROSS JOIN inactive_branch
CROSS JOIN refill_product
CROSS JOIN customer_map;

INSERT INTO public.customer_product_vouchers (
  customer_id, product_id, balance, gift_balance
)
SELECT customer_id, refill_product_id, balance, gift_balance
FROM later_pay_context
CROSS JOIN LATERAL (VALUES
  (main_customer_id, 3, 1),
  (full_voucher_customer_id, 0, 0),
  (rollback_customer_id, 1, 1)
) AS balances(customer_id, balance, gift_balance);

INSERT INTO public.voucher_packages (
  product_id, qty, price, label, is_active, sort_order
)
SELECT refill_product_id, 2, 18000, 'Atomic rollback package', true, 0
FROM later_pay_context;

WITH inserted AS (
  INSERT INTO public.products (id, name, price, unit, is_refill, status)
  VALUES (
    gen_random_uuid(),
    'Atomic legitimate free sample ' || substr(gen_random_uuid()::text, 1, 8),
    0,
    'sample',
    false,
    'active'
  )
  RETURNING id, name
)
INSERT INTO later_pay_free_product(product_id, product_name)
SELECT id, name FROM inserted;

-- Credit and overdue fixtures. Inactive rows must not consume credit or block.
INSERT INTO public.orders (
  id, customer_id, customer_name, customer_address, customer_whatsapp,
  customer_discount, branch, total_amount, status, payment_status,
  delivery_date, created_by_display, is_active
)
SELECT
  COALESCE(order_id, gen_random_uuid()), customer_id, label,
  'Rollback customer', whatsapp,
  2000, branch_name, total_amount, status, payment_status, delivery_date,
  'Audit fixture', is_active
FROM later_pay_context
CROSS JOIN LATERAL (VALUES
  (NULL::uuid, credit_active_customer_id, 'credit-active', 'audit2200-ca',
    10000, 'pending', 'unpaid', current_date + 1, true),
  (NULL::uuid, credit_inactive_customer_id, 'credit-inactive', 'audit2200-ci',
    50000, 'pending', 'unpaid', current_date + 1, false),
  (NULL::uuid, overdue_active_customer_id, 'overdue-active', 'audit2200-oa',
    1000, 'delivered', 'unpaid', current_date - 2, true),
  (NULL::uuid, overdue_inactive_customer_id, 'overdue-inactive', 'audit2200-oi',
    1000, 'delivered', 'unpaid', current_date - 2, false),
  (full_voucher_key, full_voucher_customer_id, 'full-voucher', 'audit2200-full',
    13000, 'pending', 'paid', current_date + 2, true)
) AS orders_fixture(
  order_id, customer_id, label, whatsapp, total_amount, status,
  payment_status, delivery_date, is_active
);

INSERT INTO public.order_items (
  order_id, product_id, product, is_refill, quantity, unit_price, discount
)
SELECT full_voucher_key, refill_product_id, refill_product_name,
       true, quantity, unit_price, discount
FROM later_pay_context
CROSS JOIN LATERAL (VALUES
  (1, 0, 0),
  (1, 15000, 2000)
) AS item(quantity, unit_price, discount);

INSERT INTO public.voucher_usage_ledger (
  order_id, customer_id, branch, product_id,
  voucher_qty, unit_amount, line_amount, pricing_basis
)
SELECT
  full_voucher_key, full_voucher_customer_id, branch_name,
  refill_product_id, voucher_qty, unit_amount, line_amount, pricing_basis
FROM later_pay_context
CROSS JOIN LATERAL (VALUES
  (1, 0, 0, 'gift_zero'),
  (1, 9000, 9000, 'package_fallback')
) AS ledger(voucher_qty, unit_amount, line_amount, pricing_basis);

-- Rolled-back fault injection proves item creation/replacement failures cannot
-- leak partial order headers or edits.
CREATE FUNCTION public.audit_2200_reject_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.order_id::text = current_setting('audit.item_order_id', true)
     OR EXISTS (
       SELECT 1
       FROM public.orders AS o
       WHERE o.id = NEW.order_id
         AND o.customer_id::text =
           current_setting('audit.item_customer_id', true)
     ) THEN
    RAISE EXCEPTION 'AUDIT_ITEM_FAILURE' USING ERRCODE = 'XX000';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER audit_2200_reject_item
BEFORE INSERT ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.audit_2200_reject_item();

SELECT pg_temp.record_later_pay_check(
  'function_metadata_hardened',
  p.prosecdef
    AND pg_get_userbyid(p.proowner) = 'postgres'
    AND p.proconfig @> ARRAY['search_path=pg_catalog, public']::text[],
  format('owner=%s security_definer=%s config=%s',
         pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig)
)
FROM pg_proc AS p
WHERE p.oid =
  'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)'::regprocedure;

SELECT pg_temp.record_later_pay_check(
  'function_acl_service_role_only',
  has_function_privilege(
    'service_role',
    'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'public',
    'public.submit_customer_later_pay_order(uuid,uuid,uuid,date,text,jsonb,jsonb)',
    'EXECUTE'
  ),
  'only service_role has explicit/effective EXECUTE'
);

SET LOCAL ROLE service_role;

-- Basic server-authoritative rejection paths.
SELECT pg_temp.expect_later_pay_error(
  'inactive_customer_rejected', inactive_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  '42501', 'CUSTOMER_IS_INACTIVE'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'prepay_customer_rejected', prepay_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  '42501', 'CUSTOMER_IS_NOT_LATER_PAY'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'inactive_branch_rejected', inactive_branch_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  '42501', 'SERVICE_BRANCH_INACTIVE'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'server_price_change_rejected', main_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 14999, 2000, 0, 0, current_date + 2,
  '22023', 'ORDER_PRICE_CHANGED'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'later_pay_voucher_deduction_rejected', edit_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 1, 0, current_date + 2,
  '55000', 'LATER_PAY_VOUCHERS_NOT_SUPPORTED'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'forged_zero_price_refill_rejected', main_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 0, 0, 0, 1, current_date + 2,
  '22023', 'ORDER_PRICE_CHANGED'
) FROM later_pay_context;
WITH called AS (
  SELECT public.submit_customer_later_pay_order(
    c.main_customer_id,
    gen_random_uuid(),
    NULL,
    current_date + 2,
    'legitimate free catalog item',
    jsonb_build_array(jsonb_build_object(
      'product_id', f.product_id,
      'product', f.product_name,
      'is_refill', false,
      'quantity', 1,
      'unit_price', 0,
      'discount', 0
    )),
    '[]'::jsonb
  ) AS result
  FROM later_pay_context AS c
  CROSS JOIN later_pay_free_product AS f
), cancelled AS (
  SELECT
    called.result,
    public.cancel_customer_pending_order(
      c.main_customer_id,
      (called.result->>'order_id')::uuid
    ) AS cancel_result
  FROM called
  CROSS JOIN later_pay_context AS c
)
SELECT pg_temp.record_later_pay_check(
  'legitimate_zero_price_catalog_item_allowed',
  result->>'created' = 'true'
    AND result->>'payment_status' = 'paid'
    AND (result->>'total_amount')::integer = 0
    AND cancel_result->>'cancelled' = 'true'
    AND (cancel_result->>'refunded_voucher_qty')::integer = 0,
  jsonb_build_object(
    'create', result,
    'cancel', cancel_result
  )::text
) FROM cancelled;
SELECT pg_temp.expect_later_pay_error(
  'active_credit_limit_rejected', credit_active_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  'P0001', 'CREDIT_LIMIT_EXCEEDED'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'active_overdue_rejected', overdue_active_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  'P0001', 'OUTSTANDING_PAYMENT_BLOCKED'
) FROM later_pay_context;

-- An inactive audit row is neither receivable exposure nor an overdue block.
WITH called AS (
  SELECT pg_temp.call_later_pay(
    credit_inactive_customer_id, credit_inactive_key, NULL, NULL,
    1, 15000, 2000, 0, 0, current_date + 2
  ) AS result
  FROM later_pay_context
)
SELECT pg_temp.record_later_pay_check(
  'inactive_credit_create_succeeds',
  result->>'created' = 'true', result::text
) FROM called;

WITH called AS (
  SELECT pg_temp.call_later_pay(
    overdue_inactive_customer_id, overdue_inactive_key, NULL, NULL,
    1, 15000, 2000, 0, 0, current_date + 2
  ) AS result
  FROM later_pay_context
)
SELECT pg_temp.record_later_pay_check(
  'inactive_overdue_create_succeeds',
  result->>'created' = 'true', result::text
) FROM called;

-- Ordinary later-pay create is keyed and never consumes a voucher implicitly.
WITH called AS (
  SELECT pg_temp.call_later_pay(
    main_customer_id, main_key, NULL, 'first request',
    3, 15000, 2000, 0, 0, current_date + 2
  ) AS result
  FROM later_pay_context
)
SELECT pg_temp.record_later_pay_check(
  'keyed_create_result',
  result->>'created' = 'true'
    AND result->>'payment_status' = 'unpaid'
    AND (result->>'total_amount')::integer = 39000,
  result::text
) FROM called;
SELECT pg_temp.record_later_pay_check(
  'keyed_create_order_state',
  o.total_amount = 39000 AND o.payment_status = 'unpaid'
    AND o.status = 'pending' AND o.is_active,
  row_to_json(o)::text
) FROM public.orders AS o
JOIN later_pay_context AS c ON o.later_pay_order_key = c.main_key;
SELECT pg_temp.record_later_pay_check(
  'later_pay_create_leaves_voucher_balance',
  cpv.balance = 3 AND cpv.gift_balance = 1,
  format('balance=%s gift=%s', cpv.balance, cpv.gift_balance)
) FROM public.customer_product_vouchers AS cpv
JOIN later_pay_context AS c
  ON cpv.customer_id = c.main_customer_id
 AND cpv.product_id = c.refill_product_id;
SELECT pg_temp.record_later_pay_check(
  'later_pay_create_writes_no_voucher_ledger',
  NOT EXISTS (
    SELECT 1
    FROM public.voucher_usage_ledger AS l
    JOIN public.orders AS o ON o.id = l.order_id
    JOIN later_pay_context AS c ON o.later_pay_order_key = c.main_key
  ),
  'no voucher usage rows for the keyed later-pay order'
);

WITH replayed AS (
  SELECT pg_temp.call_later_pay(
    main_customer_id, main_key, NULL, 'first request',
    3, 15000, 2000, 0, 0, current_date + 2
  ) AS result
  FROM later_pay_context
)
SELECT pg_temp.record_later_pay_check(
  'same_key_replay_result',
  result->>'already_created' = 'true', result::text
) FROM replayed;
SELECT pg_temp.record_later_pay_check(
  'same_key_replay_no_duplicate',
  (SELECT count(*) FROM public.orders AS o
   JOIN later_pay_context AS c ON o.later_pay_order_key = c.main_key) = 1
  AND (SELECT balance FROM public.customer_product_vouchers AS cpv
       JOIN later_pay_context AS c
         ON cpv.customer_id = c.main_customer_id
        AND cpv.product_id = c.refill_product_id) = 3,
  'one order exists and the voucher balance is untouched'
);
SELECT pg_temp.expect_later_pay_error(
  'same_key_changed_payload_conflicts', main_customer_id, main_key, NULL,
  'changed request', 3, 15000, 2000, 0, 0, current_date + 2,
  '23505', 'LATER_PAY_ORDER_KEY_CONFLICT'
) FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'voucher_order_edit_rejected', main_customer_id, NULL,
  (SELECT o.id FROM public.orders AS o
   WHERE o.later_pay_order_key = later_pay_context.main_key),
  'edit attack', 2, 15000, 2000, 1, 0, current_date + 2,
  '55000', 'VOUCHER_ORDER_EDIT_NOT_SUPPORTED'
) FROM later_pay_context;

-- Historical fully voucher-funded later-pay rows remain safely cancellable.
SELECT pg_temp.record_later_pay_check(
  'historical_full_voucher_fixture_is_paid',
  o.payment_status = 'paid'
    AND (SELECT sum(oi.quantity) FROM public.order_items AS oi
         WHERE oi.order_id = o.id) = 2
    AND (SELECT sum(l.voucher_qty) FROM public.voucher_usage_ledger AS l
         WHERE l.order_id = o.id) = 2,
  row_to_json(o)::text
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.id = c.full_voucher_key;
WITH cancelled AS (
  SELECT public.cancel_customer_pending_order(c.full_voucher_customer_id, o.id)
    AS result
  FROM later_pay_context AS c
  JOIN public.orders AS o ON o.id = c.full_voucher_key
)
SELECT pg_temp.record_later_pay_check(
  'full_voucher_cancel_result',
  result->>'cancelled' = 'true'
    AND (result->>'refunded_voucher_qty')::integer = 2,
  result::text
) FROM cancelled;
SELECT pg_temp.record_later_pay_check(
  'full_voucher_cancel_restores_balance',
  cpv.balance = 2 AND cpv.gift_balance = 1 AND o.is_active = false,
  format('balance=%s gift=%s active=%s', cpv.balance, cpv.gift_balance, o.is_active)
) FROM later_pay_context AS c
JOIN public.customer_product_vouchers AS cpv
  ON cpv.customer_id = c.full_voucher_customer_id
 AND cpv.product_id = c.refill_product_id
JOIN public.orders AS o ON o.id = c.full_voucher_key;
SELECT pg_temp.record_later_pay_check(
  'full_voucher_cancel_signed_ledger',
  sum(l.voucher_qty) = 0 AND sum(l.line_amount) = 0 AND count(*) = 4,
  format('rows=%s net_qty=%s net_amount=%s',
         count(*), sum(l.voucher_qty), sum(l.line_amount))
) FROM public.voucher_usage_ledger AS l
JOIN public.orders AS o ON o.id = l.order_id
JOIN later_pay_context AS c ON o.id = c.full_voucher_key;

-- Simulate a historical partially voucher-funded order. If cash was marked
-- paid, the voucher refund primitive must refuse to pretend it can refund the
-- cash portion. The same order is cancellable while still unpaid.
UPDATE public.customer_product_vouchers AS cpv
SET balance = 1, gift_balance = 0
FROM later_pay_context AS c
WHERE cpv.customer_id = c.main_customer_id
  AND cpv.product_id = c.refill_product_id;
INSERT INTO public.voucher_usage_ledger (
  order_id, customer_id, branch, product_id,
  voucher_qty, unit_amount, line_amount, pricing_basis
)
SELECT o.id, c.main_customer_id, c.branch_name, c.refill_product_id,
       voucher_qty, unit_amount, line_amount, pricing_basis
FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.main_key
CROSS JOIN LATERAL (VALUES
  (1, 0, 0, 'gift_zero'),
  (1, 9000, 9000, 'package_fallback')
) AS ledger(voucher_qty, unit_amount, line_amount, pricing_basis);
UPDATE public.orders AS o
SET payment_status = 'paid'
FROM later_pay_context AS c
WHERE o.later_pay_order_key = c.main_key;
SELECT pg_temp.expect_cancel_error(
  'partial_voucher_cash_paid_cancel_rejected', c.main_customer_id, o.id,
  'PAYMENT_REFUND_REQUIRED'
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.main_key;
UPDATE public.orders AS o
SET payment_status = 'unpaid'
FROM later_pay_context AS c
WHERE o.later_pay_order_key = c.main_key;

WITH cancelled AS (
  SELECT public.cancel_customer_pending_order(c.main_customer_id, o.id) AS result
  FROM later_pay_context AS c
  JOIN public.orders AS o ON o.later_pay_order_key = c.main_key
)
SELECT pg_temp.record_later_pay_check(
  'partial_voucher_cancel_result',
  result->>'cancelled' = 'true'
    AND (result->>'refunded_voucher_qty')::integer = 2,
  result::text
) FROM cancelled;
SELECT pg_temp.record_later_pay_check(
  'partial_voucher_cancel_restores_balance',
  cpv.balance = 3 AND cpv.gift_balance = 1 AND o.is_active = false,
  format('balance=%s gift=%s active=%s', cpv.balance, cpv.gift_balance, o.is_active)
) FROM later_pay_context AS c
JOIN public.customer_product_vouchers AS cpv
  ON cpv.customer_id = c.main_customer_id
 AND cpv.product_id = c.refill_product_id
JOIN public.orders AS o ON o.later_pay_order_key = c.main_key;
SELECT pg_temp.expect_later_pay_error(
  'inactive_keyed_replay_rejected', main_customer_id, main_key, NULL,
  'first request', 3, 15000, 2000, 0, 0, current_date + 2,
  '55000', 'LATER_PAY_ORDER_ALREADY_INACTIVE'
) FROM later_pay_context;

-- Keyed create followed by an edit. The original branch and immutable create
-- request hash remain authoritative even after the customer profile moves and
-- its live discount changes. Edited line pricing and the header snapshot must
-- move together.
WITH called AS (
  SELECT pg_temp.call_later_pay(
    edit_customer_id, edit_key, NULL, 'original',
    1, 15000, 2000, 0, 0, current_date + 2
  ) AS result
  FROM later_pay_context
)
SELECT pg_temp.record_later_pay_check(
  'edit_fixture_keyed_create',
  result->>'created' = 'true', result::text
) FROM called;

RESET ROLE;
UPDATE public.customers AS customer_row
SET
  branch = context.other_branch_name,
  discount = 3000
FROM later_pay_context AS context
WHERE customer_row.id = context.edit_customer_id;
SET LOCAL ROLE service_role;

WITH called AS (
  SELECT pg_temp.call_later_pay(
    c.edit_customer_id, NULL, o.id, 'edited',
    2, 15000, 3000, 0, 0, current_date + 3
  ) AS result
  FROM later_pay_context AS c
  JOIN public.orders AS o ON o.later_pay_order_key = c.edit_key
)
SELECT pg_temp.record_later_pay_check(
  'edit_uses_original_active_branch',
  result->>'edited' = 'true', result::text
) FROM called;
SELECT pg_temp.record_later_pay_check(
  'edit_state_and_hash_are_consistent',
  o.branch = c.branch_name
    AND o.delivery_date = current_date + 3
    AND o.note = 'edited'
    AND o.customer_discount = 3000
    AND o.total_amount = 24000
    AND o.later_pay_order_request_hash = md5(jsonb_build_object(
      'customer_id', c.edit_customer_id,
      'delivery_date', current_date + 2,
      'note', 'original',
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', c.refill_product_id,
        'product', c.refill_product_name,
        'is_refill', true,
        'quantity', 1,
        'unit_price', 15000,
        'discount', 2000
      )),
      'product_deductions', '[]'::jsonb
    )::text)
    AND (SELECT sum(oi.quantity) FROM public.order_items AS oi
         WHERE oi.order_id = o.id) = 2,
  row_to_json(o)::text
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.edit_key;
WITH replayed AS (
  SELECT pg_temp.call_later_pay(
    edit_customer_id, edit_key, NULL, 'original',
    1, 15000, 2000, 0, 0, current_date + 2
  ) AS result
  FROM later_pay_context
)
SELECT pg_temp.record_later_pay_check(
  'delayed_original_create_replay_succeeds',
  result->>'already_created' = 'true', result::text
) FROM replayed;

SELECT set_config('audit.item_order_id', o.id::text, true)
FROM public.orders AS o
JOIN later_pay_context AS c ON o.later_pay_order_key = c.edit_key;
SELECT pg_temp.expect_later_pay_error(
  'edit_item_failure_rejected', c.edit_customer_id, NULL, o.id,
  'must rollback', 3, 15000, 3000, 0, 0, current_date + 4,
  'XX000', 'AUDIT_ITEM_FAILURE'
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.edit_key;
SELECT pg_temp.record_later_pay_check(
  'edit_item_failure_rolls_back_header_and_items',
  o.delivery_date = current_date + 3
    AND o.note = 'edited'
    AND o.customer_discount = 3000
    AND o.total_amount = 24000
    AND (SELECT sum(oi.quantity) FROM public.order_items AS oi
         WHERE oi.order_id = o.id) = 2,
  row_to_json(o)::text
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.edit_key;
SELECT set_config('audit.item_order_id', '', true);

-- Normal later-pay payment tagging remains legal, but freezes customer edits
-- and makes cancellation require provider reconciliation.
UPDATE public.orders AS o
SET midtrans_order_id = 'op_audit_2200'
FROM later_pay_context AS c
WHERE o.later_pay_order_key = c.edit_key;
SELECT pg_temp.record_later_pay_check(
  'midtrans_tag_on_keyed_order_allowed',
  o.midtrans_order_id = 'op_audit_2200', row_to_json(o)::text
) FROM public.orders AS o
JOIN later_pay_context AS c ON o.later_pay_order_key = c.edit_key;
SELECT pg_temp.expect_later_pay_error(
  'midtrans_tagged_edit_rejected', c.edit_customer_id, NULL, o.id,
  'edit after snap', 2, 15000, 3000, 0, 0, current_date + 3,
  '55000', 'ORDER_NOT_EDITABLE'
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.edit_key;
SELECT pg_temp.expect_cancel_error(
  'midtrans_tagged_cancel_rejected', c.edit_customer_id, o.id,
  'PAYMENT_REFUND_REQUIRED'
) FROM later_pay_context AS c
JOIN public.orders AS o ON o.later_pay_order_key = c.edit_key;

-- A failure after the header INSERT is a full statement rollback.
SELECT set_config('audit.item_customer_id', rollback_customer_id::text, true)
FROM later_pay_context;
SELECT pg_temp.expect_later_pay_error(
  'create_item_failure_rejected', rollback_customer_id, rollback_key, NULL,
  'rollback probe', 1, 15000, 2000, 0, 0, current_date + 2,
  'XX000', 'AUDIT_ITEM_FAILURE'
) FROM later_pay_context;
SELECT pg_temp.record_later_pay_check(
  'create_item_failure_rolls_back_all_writes',
  cpv.balance = 1 AND cpv.gift_balance = 1
    AND NOT EXISTS (
      SELECT 1 FROM public.orders AS o
      WHERE o.later_pay_order_key = c.rollback_key
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.voucher_usage_ledger AS l
      WHERE l.customer_id = c.rollback_customer_id
    ),
  format('balance=%s gift=%s', cpv.balance, cpv.gift_balance)
) FROM later_pay_context AS c
JOIN public.customer_product_vouchers AS cpv
 ON cpv.customer_id = c.rollback_customer_id
 AND cpv.product_id = c.refill_product_id;
SELECT set_config('audit.item_customer_id', '', true);

-- A missing create key is rejected before any write.
SELECT pg_temp.expect_later_pay_error(
  'create_without_key_rejected', edit_customer_id, NULL, NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  '22023', 'LATER_PAY_CREATE_OR_EDIT_IDENTITY_REQUIRED'
) FROM later_pay_context;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_later_pay_error(
  'authenticated_execute_rejected', edit_customer_id, gen_random_uuid(), NULL,
  NULL, 1, 15000, 2000, 0, 0, current_date + 2,
  '42501', 'permission denied'
) FROM later_pay_context;
RESET ROLE;

TABLE later_pay_results ORDER BY check_name;

DO $assert_all_passed$
DECLARE
  v_total integer;
  v_blocked integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE status <> 'PASS')
    INTO v_total, v_blocked
  FROM later_pay_results;

  IF v_total <> 42 OR v_blocked <> 0 THEN
    RAISE EXCEPTION
      'ATOMIC_CUSTOMER_LATER_PAY_REGRESSION_FAILED: expected 42 PASS rows, got % total and % blocked',
      v_total, v_blocked;
  END IF;
END;
$assert_all_passed$;

ROLLBACK;
