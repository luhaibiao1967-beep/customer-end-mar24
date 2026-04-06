-- One-time backfill: mark existing welcome-product voucher balance as gift (cost 0),
-- up to app_settings welcome_voucher_qty per customer for that product.
-- Does not reduce gift_balance if already set higher by the app.

WITH settings AS (
  SELECT
    (SELECT value::uuid FROM public.app_settings WHERE key = 'welcome_voucher_product_id') AS welcome_pid,
    (SELECT NULLIF(trim(value), '')::int FROM public.app_settings WHERE key = 'welcome_voucher_qty') AS welcome_qty
)
UPDATE public.customer_product_vouchers cpv
SET gift_balance = LEAST(
  cpv.balance,
  GREATEST(
    cpv.gift_balance,
    LEAST(cpv.balance, COALESCE(s.welcome_qty, 0))
  )
)
FROM settings s
WHERE s.welcome_pid IS NOT NULL
  AND s.welcome_qty IS NOT NULL
  AND s.welcome_qty > 0
  AND cpv.product_id = s.welcome_pid;
