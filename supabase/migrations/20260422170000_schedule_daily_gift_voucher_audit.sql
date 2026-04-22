-- Configure daily gift voucher audit recipients and schedule.
-- Runs daily at 08:05 WIB (01:05 UTC).

-- Ensure feature flags are configured
INSERT INTO app_settings (key, value, description) VALUES
  ('gift_voucher_audit_enabled', '1', 'Enable daily gift voucher audit WhatsApp notification (1=on, 0=off)'),
  ('gift_voucher_audit_recipients', '+6281251617360', 'Comma-separated WhatsApp numbers for daily gift voucher audit')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = now();

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'daily-gift-voucher-audit-job'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  PERFORM cron.schedule(
    'daily-gift-voucher-audit-job',
    '5 1 * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://fjnadtyaysddxwyccert.supabase.co/functions/v1/daily-gift-voucher-audit',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'audit-secret-2026-04-22'
      ),
      body := '{}'::jsonb
    );
    $cmd$
  );
END $$;
