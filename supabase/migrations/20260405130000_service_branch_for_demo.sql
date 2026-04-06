-- Simpler demo flow: admin sets customers.service_branch = 'demo' for test accounts.
-- Drops demo_access if present (replaced by service_branch).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS service_branch text;

COMMENT ON COLUMN public.customers.service_branch IS
  'Optional label from admin (e.g. demo). When set to demo, customer may see branches marked internal_demo.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'demo_access'
  ) THEN
    UPDATE public.customers SET service_branch = 'demo' WHERE demo_access IS TRUE;
  END IF;
END $$;

ALTER TABLE public.customers
  DROP COLUMN IF EXISTS demo_access;
