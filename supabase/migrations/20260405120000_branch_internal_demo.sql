-- Demo / internal branches: hidden from customers unless service_branch is demo (see migration 20260405130000).

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS internal_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.branches.internal_demo IS
  'If true, branch is hidden unless customers.service_branch is demo or customer.branch is Demo.';
