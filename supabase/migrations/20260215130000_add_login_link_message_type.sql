-- Add 'login_link' to whatsapp_messages message_type constraint
ALTER TABLE public.whatsapp_messages
  DROP CONSTRAINT IF EXISTS message_type_check;

ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT message_type_check CHECK (
    message_type = ANY (ARRAY[
      'otp'::text,
      'welcome'::text,
      'order_confirmation'::text,
      'promo'::text,
      'resend_link'::text,
      'login_link'::text
    ])
  );
