-- Settings for daily gift voucher audit notifications
INSERT INTO app_settings (key, value, description) VALUES
  ('gift_voucher_audit_enabled', '1', 'Enable daily gift voucher audit WhatsApp notification (1=on, 0=off)'),
  ('gift_voucher_audit_recipients', '', 'Comma-separated WhatsApp numbers for daily gift voucher audit, e.g. +62812xxxx,+62813xxxx')
ON CONFLICT (key) DO NOTHING;
