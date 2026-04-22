-- 1) Set recipient EMAILS (comma-separated; Resend)
update app_settings
set value = 'you@example.com', updated_at = now()
where key = 'gift_voucher_audit_recipients';

-- 2) Optional: disable/enable audit
-- update app_settings set value = '0', updated_at = now() where key = 'gift_voucher_audit_enabled';
-- update app_settings set value = '1', updated_at = now() where key = 'gift_voucher_audit_enabled';

-- 3) pg_cron：推荐用迁移 20260423140000_gift_audit_cron_twice_wib.sql（12:00 与 17:00 WIB）
--    若需手工创建，可建两条 job（PROJECT_REF、YOUR_CRON_SECRET 替换为实际值）：
--    12:00 WIB = 0 5 * * * UTC ； 17:00 WIB = 0 10 * * * UTC

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 4) List cron jobs
select jobname, schedule, command from cron.job
where jobname like 'daily-gift-voucher-audit%'
order by jobname;
