-- App-wide configurable settings (managed via admin panel or Table Editor)
CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Default welcome voucher settings
INSERT INTO app_settings (key, value, description) VALUES
  ('welcome_voucher_qty',        '2',                                    'Jumlah voucher gratis untuk pelanggan baru (pre_pay)'),
  ('welcome_voucher_product_id', 'bfc446fb-4565-4514-a22a-8d6ba90ffc36', 'Product ID untuk welcome voucher (Refill Gallon)')
ON CONFLICT (key) DO NOTHING;
