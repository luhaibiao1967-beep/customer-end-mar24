-- Daily gift voucher audit: send report to this email (Resend).
INSERT INTO public.app_settings (key, value, description) VALUES
  (
    'gift_voucher_audit_recipients',
    'luhaibiao1967@gmail.com',
    'Comma-separated email addresses for daily gift voucher audit (sent via Resend)'
  )
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();
