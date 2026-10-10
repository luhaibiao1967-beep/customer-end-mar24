-- Harden customer commercial attributes behind the shared authenticated role.
--
-- Supabase browser sessions all execute as `authenticated`, while the actual
-- staff role lives in public.profiles.  Column grants and RLS therefore cannot
-- by themselves distinguish a finance user from sales or a branch admin.  The
-- trigger below makes that role boundary authoritative without breaking the
-- existing customer-maintenance screens.

BEGIN;

CREATE OR REPLACE FUNCTION public.guard_customer_commercial_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_context jsonb;
  v_role text;
  v_min_active_refill_price numeric;
  v_discount numeric;
  v_authoritative_current_borrowed integer;
BEGIN
  -- Trusted backend code and migrations retain their existing write path.
  -- Do not use current_user here: this SECURITY DEFINER function is owned by
  -- postgres, so current_user is deliberately the function owner.
  IF auth.role() IS DISTINCT FROM 'authenticated' THEN
    RETURN NEW;
  END IF;

  -- The operations schema maintains current_borrowed_gallons through an
  -- orders AFTER trigger.  That nested SECURITY DEFINER call still carries
  -- the browser JWT, so allow only its exact, independently recomputed result.
  -- A direct browser UPDATE runs at trigger depth 1 and can never use this
  -- path; unrelated nested writes also fail the strict row-difference check.
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND (
       to_jsonb(NEW) - ARRAY['current_borrowed_gallons', 'updated_at']
     ) IS NOT DISTINCT FROM (
       to_jsonb(OLD) - ARRAY['current_borrowed_gallons', 'updated_at']
     ) THEN
    SELECT (
      COALESCE(NEW.initial_borrowed_gallons, 0)::bigint
      + COALESCE(sum(o.borrowed_gallons::bigint), 0)
    )::integer
      INTO v_authoritative_current_borrowed
    FROM public.orders AS o
    WHERE o.customer_id = NEW.id
      AND o.status = 'delivered'
      AND o.is_active IS NOT FALSE;

    IF NEW.current_borrowed_gallons
         IS DISTINCT FROM v_authoritative_current_borrowed THEN
      RAISE EXCEPTION 'CUSTOMER_BORROWED_BALANCE_INVALID'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  v_context := public.current_staff_context();
  v_role := v_context->>'role';

  IF v_context->>'status' IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'ACTIVE_STAFF_REQUIRED' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT COALESCE(
      v_role IN ('sales', 'admin', 'branch_admin', 'operations_admin'),
      false
    ) THEN
      RAISE EXCEPTION 'CUSTOMER_CREATE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;

    -- operations_admin is retained for legacy compatibility, but it is not a
    -- commercial role.  It may create only the neutral pre-pay/zero-discount
    -- starting state; sales or a branch/admin role can later approve changes.
    IF v_role = 'operations_admin'
       AND (
         COALESCE(NEW.discount, 0) <> 0
         OR NEW.customer_type::text IS DISTINCT FROM 'pre_pay'
       ) THEN
      RAISE EXCEPTION 'CUSTOMER_COMMERCIAL_FIELDS_FORBIDDEN'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_role = 'finance' THEN
      -- Finance owns settlement terms, not customer identity, branch, credit,
      -- lifecycle, or pre-pay pricing semantics.
      IF (to_jsonb(NEW) - ARRAY['payment_term', 'payment_method', 'updated_at'])
           IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['payment_term', 'payment_method', 'updated_at'])
      THEN
        RAISE EXCEPTION 'FINANCE_CUSTOMER_UPDATE_FORBIDDEN'
          USING ERRCODE = '42501';
      END IF;
    ELSIF v_role = 'operations_admin' THEN
      IF NEW.discount IS DISTINCT FROM OLD.discount
         OR NEW.customer_type IS DISTINCT FROM OLD.customer_type THEN
        RAISE EXCEPTION 'CUSTOMER_COMMERCIAL_FIELDS_FORBIDDEN'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NOT COALESCE(v_role IN ('sales', 'admin', 'branch_admin'), false) THEN
      RAISE EXCEPTION 'CUSTOMER_UPDATE_FORBIDDEN' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- A customer discount is a flat per-unit discount on every active refill
  -- product.  Keep it valid for the cheapest such product, matching the
  -- server-authored order validation in the 2000 migration.
  IF TG_OP = 'INSERT' OR NEW.discount IS DISTINCT FROM OLD.discount THEN
    v_discount := NEW.discount;
    IF v_discount IS NULL OR v_discount < 0 THEN
      RAISE EXCEPTION 'CUSTOMER_DISCOUNT_OUT_OF_RANGE'
        USING ERRCODE = '22023';
    END IF;

    SELECT min(p.price)
      INTO v_min_active_refill_price
    FROM public.products AS p
    WHERE p.status = 'active'
      AND p.is_refill IS TRUE
      AND p.price IS NOT NULL;

    IF (v_min_active_refill_price IS NULL AND v_discount <> 0)
       OR (
         v_min_active_refill_price IS NOT NULL
         AND v_discount > v_min_active_refill_price
       ) THEN
      RAISE EXCEPTION 'CUSTOMER_DISCOUNT_OUT_OF_RANGE'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.customer_type IS DISTINCT FROM OLD.customer_type THEN
    -- Customer type changes alter pricing, payment, credit and voucher
    -- semantics.  Keep the type fixed after creation so an in-flight backend
    -- request can never be committed under a stale interpretation.
    RAISE EXCEPTION 'CUSTOMER_TYPE_IMMUTABLE_AFTER_CREATE'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.guard_customer_commercial_write() OWNER TO postgres;
REVOKE ALL PRIVILEGES ON FUNCTION public.guard_customer_commercial_write()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_customer_commercial_write
  ON public.customers;
CREATE TRIGGER guard_customer_commercial_write
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_commercial_write();

COMMENT ON FUNCTION public.guard_customer_commercial_write() IS
  'Enforces role-specific customer updates, authoritative nested borrowed-balance refreshes, refill discount bounds, and immutable post-create customer type without changing existing branch RLS.';

COMMIT;
