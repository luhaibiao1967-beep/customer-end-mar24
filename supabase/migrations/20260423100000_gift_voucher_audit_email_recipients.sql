-- Recipients for daily gift voucher audit are email addresses (Resend), not WhatsApp numbers.
UPDATE public.app_settings
SET
  description = 'Comma-separated email addresses for daily gift voucher audit (sent via Resend)',
  updated_at = now()
WHERE key = 'gift_voucher_audit_recipients';

UPDATE public.app_settings
SET
  description = 'Enable daily gift voucher audit email (1=on, 0=off)',
  updated_at = now()
WHERE key = 'gift_voucher_audit_enabled';
