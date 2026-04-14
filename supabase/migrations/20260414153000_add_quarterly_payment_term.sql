-- Allow quarterly billing cycle for later_pay customers.
ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_payment_term_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_payment_term_check
  CHECK (
    payment_term = ANY (
      ARRAY[
        'daily'::text,
        'weekly'::text,
        'biweekly'::text,
        'monthly'::text,
        'quarterly'::text
      ]
    )
  );
