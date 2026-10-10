-- Persist the immutable product identity alongside the historical display name.
-- Existing rows remain valid because legacy order items may only have `product`.

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS product_id uuid
  REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_items_product_id
  ON public.order_items (product_id);

COMMENT ON COLUMN public.order_items.product_id IS
  'Canonical product UUID at order creation. Nullable only for legacy rows; product keeps the historical display name.';
