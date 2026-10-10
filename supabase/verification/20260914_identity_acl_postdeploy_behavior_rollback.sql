-- STAGING ONLY: behavior probe for the authenticated voucher top-up RPC.
-- This script intentionally attempts a write as an authenticated JWT that has
-- no matching public.profiles row.  The enclosing transaction always rolls
-- back, including the attempted voucher change and all temporary objects.
-- Expected result: one row with status = PASS.

BEGIN;

CREATE TEMP TABLE voucher_acl_probe_input ON COMMIT DROP AS
SELECT
  (
    SELECT c.id
    FROM public.customers AS c
    WHERE c.is_active IS TRUE
    ORDER BY c.id
    LIMIT 1
  ) AS customer_id,
  (
    SELECT p.id
    FROM public.products AS p
    WHERE p.status = 'active'
    ORDER BY p.id
    LIMIT 1
  ) AS product_id,
  gen_random_uuid() AS missing_profile_user_id;

CREATE TEMP TABLE voucher_acl_probe_result (
  check_name text PRIMARY KEY,
  status text NOT NULL,
  detail text NOT NULL
) ON COMMIT DROP;

INSERT INTO voucher_acl_probe_result (check_name, status, detail)
VALUES (
  'voucher_topup_missing_profile_fails_closed',
  'BLOCK',
  'probe did not run'
);

GRANT SELECT ON TABLE voucher_acl_probe_input TO authenticated;
GRANT SELECT, UPDATE ON TABLE voucher_acl_probe_result TO authenticated;

SELECT set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'role', 'authenticated',
    'sub', missing_profile_user_id
  )::text,
  true
)
FROM voucher_acl_probe_input;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_customer_id uuid;
  v_product_id uuid;
  v_expected_context jsonb := '{}'::jsonb;
BEGIN
  SELECT customer_id, product_id
    INTO v_customer_id, v_product_id
  FROM voucher_acl_probe_input;

  IF v_customer_id IS NULL OR v_product_id IS NULL THEN
    UPDATE voucher_acl_probe_result
    SET detail = 'active customer or active product fixture is missing'
    WHERE check_name = 'voucher_topup_missing_profile_fails_closed';
    RETURN;
  END IF;

  IF public.current_staff_context() IS DISTINCT FROM v_expected_context THEN
    UPDATE voucher_acl_probe_result
    SET detail = 'generated probe user unexpectedly resolved to a staff profile'
    WHERE check_name = 'voucher_topup_missing_profile_fails_closed';
    RETURN;
  END IF;

  -- A caller can set a custom GUC on a direct database session.  It must not
  -- act as an authorization capability for the voucher trigger or RPC.
  PERFORM set_config('vividaqua.voucher_write_mode', 'topup', true);

  BEGIN
    PERFORM public.increment_voucher_balance(
      v_customer_id,
      v_product_id,
      1
    );

    UPDATE voucher_acl_probe_result
    SET detail = 'RPC returned successfully for an authenticated user without a profile'
    WHERE check_name = 'voucher_topup_missing_profile_fails_closed';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%VOUCHER_TOPUP_NOT_ALLOWED%' THEN
        UPDATE voucher_acl_probe_result
        SET status = 'PASS',
            detail = 'missing-profile authenticated caller was rejected'
        WHERE check_name = 'voucher_topup_missing_profile_fails_closed';
      ELSE
        UPDATE voucher_acl_probe_result
        SET detail = 'unexpected rejection: ' || SQLERRM
        WHERE check_name = 'voucher_topup_missing_profile_fails_closed';
      END IF;
  END;
END;
$$;

RESET ROLE;

SELECT check_name, status, detail
FROM voucher_acl_probe_result;

ROLLBACK;
