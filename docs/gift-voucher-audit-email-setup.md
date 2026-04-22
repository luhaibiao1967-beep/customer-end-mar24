# Gift Voucher 每日巡检 + 邮件通知（Resend）

比 WhatsApp 更简单：只需 **Resend API Key** + **发件人地址** + **收件人邮箱**（写在 `app_settings`）。

---

## 1) Edge Function

- `supabase/functions/daily-gift-voucher-audit/index.ts`  
  定时触发后统计 `customer_product_vouchers.gift_balance > 0`，向配置的邮箱发送纯文本报告。

---

## 2) Supabase Secrets（必须）

```bash
supabase secrets set RESEND_API_KEY="re_xxxxxxxx"
```

可选（默认使用 Resend 测试发件人，仅适合验证；正式环境请改成你已验证域名的发件人）：

```bash
supabase secrets set GIFT_AUDIT_EMAIL_FROM="VividAqua <noreply@yourdomain.com>"
```

已有且继续用于 `pg_cron` 调用：

- `GIFT_AUDIT_CRON_SECRET`：与数据库 `cron.job` 里 `x-cron-secret` 一致。

---

## 3) 数据库配置（收件人）

`gift_voucher_audit_recipients` 现在是 **逗号分隔的邮箱**，例如：

```sql
update app_settings
set value = 'luhaibiao1967@gmail.com', updated_at = now()
where key = 'gift_voucher_audit_recipients';

update app_settings
set value = '1', updated_at = now()
where key = 'gift_voucher_audit_enabled';
```

> 若之前填的是 WhatsApp 号码（以 `+` 开头），请改成有效邮箱，否则会报错。

---

## 4) 部署函数

```bash
supabase functions deploy daily-gift-voucher-audit --no-verify-jwt --use-api
```

（`--no-verify-jwt` 便于 `pg_cron` / `net.http_post` 不带 JWT 调用；`--use-api` 避免本机无 Docker 时 bundler 失败。）

---

## 5) 手工测试

```bash
curl.exe -sS -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/daily-gift-voucher-audit" ^
  -H "Content-Type: application/json" ^
  -H "x-cron-secret: YOUR_CRON_SECRET" ^
  -d "{}"
```

成功时返回 `success: true` 且 `channel: "email"`，收件箱应收到邮件。

---

## 6) 定时任务（已迁移则跳过）

当前仓库迁移 **`20260423140000_gift_audit_cron_twice_wib.sql`** 会在生产库上配置 **每天两次（印尼 WIB）**：

- **12:00 WIB**（UTC `05:00`）— 任务名 `daily-gift-voucher-audit-wib-12`
- **17:00 WIB**（UTC `10:00`）— 任务名 `daily-gift-voucher-audit-wib-17`

`x-cron-secret` 会从旧的 `daily-gift-voucher-audit-job` 里解析；若解析失败则回退为 `audit-secret-2026-04-22`（与最早迁移一致）。若你曾改过 Secret，请确保与 Edge Function 的 `GIFT_AUDIT_CRON_SECRET` 一致。

若尚未跑过迁移，执行：

```bash
supabase db push --linked --yes
```

手工维护时可查：

```sql
select jobname, schedule, command from cron.job
where jobname like 'daily-gift-voucher-audit%'
order by jobname;
```

---

## 7) Resend 账号说明

1. 注册 [Resend](https://resend.com)，创建 API Key。  
2. 验证发件域名后，把 `GIFT_AUDIT_EMAIL_FROM` 设为该域名下的地址。  
3. 测试阶段可用 `onboarding@resend.dev`（Resend 文档说明的限制请自行确认）。

---

旧版 WhatsApp 说明已废弃；若仓库里仍有 `docs/gift-voucher-audit-whatsapp-setup.md`，请以本文为准。
