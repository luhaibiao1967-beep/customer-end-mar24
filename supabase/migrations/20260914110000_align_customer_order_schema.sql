-- Align the customer-portal migration chain with the order/customer schema
-- already used by the shared operations application.  Older staging clones
-- were bootstrapped from a snapshot that still used pre_paid/later_paid and
-- did not contain the order lifecycle columns consumed by current RPCs.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS inactivated_at timestamptz,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS payment_confirmation_type text;

UPDATE public.orders
SET is_active = true
WHERE is_active IS NULL;

ALTER TABLE public.orders
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

-- Some databases still have the legacy delivery_notes column, while newer
-- ones have already merged it into note.  Use dynamic SQL so this migration
-- remains valid in either shape and never overwrites an existing note.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'delivery_notes'
  ) THEN
    EXECUTE $sql$
      UPDATE public.orders
      SET note = delivery_notes
      WHERE (note IS NULL OR btrim(note) = '')
        AND delivery_notes IS NOT NULL
        AND btrim(delivery_notes) <> ''
    $sql$;
  END IF;
END;
$$;

-- Normalize the legacy enum spelling to the spelling used by every current
-- customer Edge Function and database RPC.
ALTER TABLE public.customers
  ALTER COLUMN customer_type DROP DEFAULT;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_customer_type_check;

UPDATE public.customers
SET customer_type = CASE customer_type
  WHEN 'pre_paid' THEN 'pre_pay'
  WHEN 'later_paid' THEN 'later_pay'
  ELSE customer_type
END;

ALTER TABLE public.customers
  ALTER COLUMN customer_type SET DEFAULT 'pre_pay'::character varying,
  ALTER COLUMN customer_type SET NOT NULL;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_customer_type_check CHECK (
    customer_type::text = ANY (
      ARRAY['pre_pay'::character varying, 'later_pay'::character varying]::text[]
    )
  ) NOT VALID;

ALTER TABLE public.customers
  VALIDATE CONSTRAINT customers_customer_type_check;

COMMENT ON COLUMN public.customers.customer_type IS
  'pre_pay: voucher/QRIS settlement is required before fulfilment; later_pay: eligible for post-paid ordering.';

-- The shared operations application has added several staff roles since the
-- customer snapshot was created.  Keep a fresh customer migration chain from
-- rejecting those profiles, while retaining the database-level allow-list.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check CHECK (
    role IN (
      'sales',
      'operator',
      'operator_manager',
      'finance',
      'admin',
      'branch_admin',
      'operations_admin',
      'adminFin'
    )
  ) NOT VALID;

ALTER TABLE public.profiles
  VALIDATE CONSTRAINT profiles_role_check;

COMMENT ON CONSTRAINT profiles_role_check ON public.profiles IS
  'Allowed staff roles shared by the customer and operations applications; operations_admin is retained only for legacy compatibility.';
