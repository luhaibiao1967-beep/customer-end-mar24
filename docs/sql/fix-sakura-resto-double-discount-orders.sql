-- One-off: fix two Sakura Resto orders affected by double discount (bug 2026-04-07).
-- Expected after fix: 15 gal → 187,500 IDR; 13 gal → 162,500 IDR (net 12,500/gal).
-- Run in Supabase SQL Editor (or psql) once. Idempotent: second run updates 0 rows.

-- 1) Preview — confirm exactly the two orders and one refill line each
-- SELECT o.id, o.delivery_date, o.total_amount, c.name,
--        oi.id AS order_item_id, oi.quantity, oi.unit_price, oi.discount,
--        oi.quantity * (oi.unit_price - oi.discount) AS line_total
-- FROM public.orders o
-- JOIN public.customers c ON c.id = o.customer_id
-- JOIN public.order_items oi ON oi.order_id = o.id
-- WHERE c.name ILIKE '%sakura%'
--   AND (c.name ILIKE '%resto%' OR c.name ILIKE '%restor%')
--   AND o.id::text ~ '^(4fd8e52a|51ed42dd)';

BEGIN;

-- 2) Correct line items: store list price 15,000; keep per-gallon discount 2,500 (was wrongly storing net 12,500 as unit_price)
UPDATE public.order_items oi
SET unit_price = 15000
FROM public.orders o
JOIN public.customers c ON c.id = o.customer_id
WHERE oi.order_id = o.id
  AND oi.is_refill = true
  AND c.name ILIKE '%sakura%'
  AND (c.name ILIKE '%resto%' OR c.name ILIKE '%restor%')
  AND o.id::text ~ '^(4fd8e52a|51ed42dd)'
  AND oi.unit_price = 12500
  AND oi.discount = 2500;

-- 3) Recalculate order totals from line items
UPDATE public.orders o
SET
  total_amount = s.line_sum,
  updated_at = now()
FROM (
  SELECT
    oi.order_id,
    SUM(oi.quantity * (oi.unit_price - oi.discount))::integer AS line_sum
  FROM public.order_items oi
  GROUP BY oi.order_id
) s
WHERE o.id = s.order_id
  AND o.id IN (
    SELECT o2.id
    FROM public.orders o2
    JOIN public.customers c ON c.id = o2.customer_id
    WHERE c.name ILIKE '%sakura%'
      AND (c.name ILIKE '%resto%' OR c.name ILIKE '%restor%')
      AND o2.id::text ~ '^(4fd8e52a|51ed42dd)'
  );

COMMIT;
