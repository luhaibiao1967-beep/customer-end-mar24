-- Voucher packages (admin manages via Supabase Dashboard Table Editor)
CREATE TABLE IF NOT EXISTS voucher_packages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty         integer NOT NULL CHECK (qty > 0),
  price       integer NOT NULL CHECK (price > 0),
  label       text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);

-- Add midtrans_order_id to voucher_purchase_requests
ALTER TABLE voucher_purchase_requests
  ADD COLUMN IF NOT EXISTS midtrans_order_id text;

-- Add midtrans_order_id to orders (for later_pay order payments)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS midtrans_order_id text;
