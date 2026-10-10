-- Close legacy public write paths for orders and order_items while preserving
-- the authenticated staff workflows used by the operations application.
-- Customer-portal mutations run through service-role Edge Functions/RPCs.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- PostgreSQL ORs permissive policies.  Therefore keeping even one historical
-- authenticated/PUBLIC write policy can silently bypass a newer branch-aware
-- policy.  Reset the complete client-facing write-policy set and recreate one
-- canonical policy per operation below.  service_role policies are preserved.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('orders', 'order_items')
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      AND roles::text[] && ARRAY['public', 'anon', 'authenticated']::text[]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      v_policy.policyname,
      v_policy.schemaname,
      v_policy.tablename
    );
  END LOOP;
END;
$$;

-- The legacy snapshot granted ALL, which also includes TRUNCATE, REFERENCES,
-- and TRIGGER.  Reset the ACL instead of revoking only the obvious DML verbs.
REVOKE ALL PRIVILEGES ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.order_items FROM PUBLIC, anon, authenticated;

-- Existing deployments grant table privileges broadly through default
-- privileges. Re-assert only the table privileges needed by authenticated
-- staff; the policies below remain the authoritative row-level gate.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_items TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.orders TO service_role;
GRANT ALL PRIVILEGES ON TABLE public.order_items TO service_role;

DROP POLICY IF EXISTS staff_insert_orders ON public.orders;
CREATE POLICY staff_insert_orders
  ON public.orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN ('sales', 'admin')
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = orders.branch)
        AND EXISTS (
          SELECT 1
          FROM public.customers AS c
          WHERE c.id = orders.customer_id
            AND c.branch = orders.branch
        )
    )
  );

DROP POLICY IF EXISTS staff_update_orders ON public.orders;
CREATE POLICY staff_update_orders
  ON public.orders
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN (
          'sales',
          'operator',
          'operator_manager',
          'finance',
          'admin',
          'branch_admin',
          'operations_admin'
        )
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = orders.branch)
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN (
          'sales',
          'operator',
          'operator_manager',
          'finance',
          'admin',
          'branch_admin',
          'operations_admin'
        )
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = orders.branch)
        AND EXISTS (
          SELECT 1
          FROM public.customers AS c
          WHERE c.id = orders.customer_id
            AND c.branch = orders.branch
        )
    )
  );

DROP POLICY IF EXISTS staff_delete_orders ON public.orders;
CREATE POLICY staff_delete_orders
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND status <> 'delivered'
    AND COALESCE(payment_status, 'unpaid') NOT IN ('paid', 'partial')
    AND midtrans_order_id IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.voucher_usage_ledger AS l
      WHERE l.order_id = orders.id
    )
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN ('sales', 'admin')
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = orders.branch)
        AND (p.role = 'admin' OR orders.created_by = auth.uid())
    )
  );

DROP POLICY IF EXISTS staff_insert_order_items ON public.order_items;
CREATE POLICY staff_insert_order_items
  ON public.order_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.orders AS o ON o.id = order_items.order_id
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN ('sales', 'operator_manager', 'admin', 'branch_admin', 'operations_admin')
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = o.branch)
    )
  );

DROP POLICY IF EXISTS staff_update_order_items ON public.order_items;
CREATE POLICY staff_update_order_items
  ON public.order_items
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.orders AS o ON o.id = order_items.order_id
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN ('operator', 'operator_manager', 'admin', 'branch_admin', 'operations_admin')
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = o.branch)
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.orders AS o ON o.id = order_items.order_id
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN ('operator', 'operator_manager', 'admin', 'branch_admin', 'operations_admin')
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = o.branch)
    )
  );

DROP POLICY IF EXISTS staff_delete_order_items ON public.order_items;
CREATE POLICY staff_delete_order_items
  ON public.order_items
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles AS p
      JOIN public.orders AS o ON o.id = order_items.order_id
      WHERE p.id = auth.uid()
        AND p.status = 'active'
        AND p.role IN ('sales', 'operator_manager', 'admin', 'branch_admin', 'operations_admin')
        AND (p.role = 'admin' OR p.branch = 'All' OR p.branch = o.branch)
    )
  );

-- Keep checkout identity one-way: a row without a checkout key must not carry
-- pop_ payment identity, QRIS amount, Snap session, or release metadata.
-- A trigger scoped to identity-column updates preserves historical legacy rows
-- when unrelated operational fields are updated.
CREATE OR REPLACE FUNCTION public.guard_keyless_prepay_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.prepay_checkout_key IS NULL
     AND (
       NEW.prepay_request_hash IS NOT NULL
       OR NEW.qris_charged_idr IS NOT NULL
       OR left(NEW.midtrans_order_id, 4) = 'pop_'
       OR NEW.prepay_snap_token IS NOT NULL
       OR NEW.prepay_snap_redirect_url IS NOT NULL
       OR NEW.prepay_snap_created_at IS NOT NULL
       OR NEW.prepay_released_at IS NOT NULL
       OR NEW.prepay_release_reason IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'PREPAY_CHECKOUT_KEY_REQUIRED_FOR_PAYMENT_IDENTITY';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_keyless_prepay_identity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_keyless_prepay_identity() FROM anon;
REVOKE ALL ON FUNCTION public.guard_keyless_prepay_identity() FROM authenticated;

DROP TRIGGER IF EXISTS guard_keyless_prepay_identity ON public.orders;
CREATE TRIGGER guard_keyless_prepay_identity
BEFORE INSERT OR UPDATE OF
  prepay_checkout_key,
  prepay_request_hash,
  midtrans_order_id,
  qris_charged_idr,
  prepay_snap_token,
  prepay_snap_redirect_url,
  prepay_snap_created_at,
  prepay_released_at,
  prepay_release_reason
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.guard_keyless_prepay_identity();

COMMENT ON FUNCTION public.guard_keyless_prepay_identity() IS
  'Rejects new or identity-mutated orders that carry pre-pay QRIS, Snap, or release identity without a prepay checkout key.';
