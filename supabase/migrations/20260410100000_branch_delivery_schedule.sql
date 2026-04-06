-- Delivery scheduling per branch (Asia/Jakarta): daily cutoff + weekly closed weekdays.

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS order_cutoff_hour integer NOT NULL DEFAULT 16
    CHECK (order_cutoff_hour >= 0 AND order_cutoff_hour <= 23);

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS closed_weekdays integer[] NOT NULL DEFAULT '{}'::integer[];

COMMENT ON COLUMN public.branches.order_cutoff_hour IS
  'Local time (Asia/Jakarta): orders after this hour are scheduled for the next delivery day. Default 16 = 4:00 PM.';

COMMENT ON COLUMN public.branches.closed_weekdays IS
  'Weekdays with no delivery (0=Sunday .. 6=Saturday, JavaScript Date.getDay() in Asia/Jakarta). Empty = open all week.';

-- Optional: enforce array elements 0..6
ALTER TABLE public.branches
  DROP CONSTRAINT IF EXISTS branches_closed_weekdays_range;
ALTER TABLE public.branches
  ADD CONSTRAINT branches_closed_weekdays_range
  CHECK (
    closed_weekdays <@ ARRAY[0,1,2,3,4,5,6]::integer[]
  );
