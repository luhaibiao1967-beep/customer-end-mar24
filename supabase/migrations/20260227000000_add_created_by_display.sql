ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS created_by_display text;
