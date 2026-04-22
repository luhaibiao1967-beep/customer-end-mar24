-- Gift voucher audit: run twice per day in Asia/Jakarta (WIB).
--   12:00 WIB = 05:00 UTC  → 0 5 * * *
--   17:00 WIB = 10:00 UTC → 0 10 * * *
--
-- Reuses x-cron-secret from the existing job `daily-gift-voucher-audit-job` when present;
-- otherwise falls back to the original default from 20260422170000 (update if you rotate secrets).

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_old_cmd text;
  v_secret text;
  v_http_cmd text;
  v_job_id bigint;
BEGIN
  SELECT command INTO v_old_cmd
  FROM cron.job
  WHERE jobname = 'daily-gift-voucher-audit-job'
  LIMIT 1;

  IF v_old_cmd IS NOT NULL THEN
    v_secret := (regexp_match(v_old_cmd, $rx$'x-cron-secret',\s*'([^']+)'$rx$))[1];
  END IF;

  IF v_secret IS NULL OR length(trim(v_secret)) = 0 THEN
    v_secret := 'audit-secret-2026-04-22';
    RAISE NOTICE 'gift_audit_cron: could not parse x-cron-secret from old cron job; using default. If 401, set GIFT_AUDIT_CRON_SECRET + re-run a matching cron SQL.';
  END IF;

  v_http_cmd := format(
    $fmt$
SELECT net.http_post(
  url := %L,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-cron-secret', %L
  ),
  body := '{}'::jsonb
);
$fmt$,
    'https://fjnadtyaysddxwyccert.supabase.co/functions/v1/daily-gift-voucher-audit',
    v_secret
  );

  FOR v_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname IN (
      'daily-gift-voucher-audit-job',
      'daily-gift-voucher-audit-wib-12',
      'daily-gift-voucher-audit-wib-17'
    )
  LOOP
    PERFORM cron.unschedule(v_job_id);
  END LOOP;

  PERFORM cron.schedule('daily-gift-voucher-audit-wib-12', '0 5 * * *', v_http_cmd);
  PERFORM cron.schedule('daily-gift-voucher-audit-wib-17', '0 10 * * *', v_http_cmd);
END $$;
