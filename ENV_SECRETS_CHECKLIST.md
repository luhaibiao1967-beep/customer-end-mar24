# 环境变量核对清单

## 当前 .env（前端用）

| 变量 | 当前值 | 说明 |
|------|--------|------|
| VITE_SUPABASE_MODE | cloud | 使用 Supabase 云 |

**说明**：`.env` 仅用于 Vite 前端构建，以下变量需在 **Supabase Dashboard → Project Settings → Edge Functions → Secrets** 中配置。

---

## 生产环境 Supabase Secrets（必需）

| 变量名 | 生产环境 | 说明 |
|-------|----------|------|
| ENVIRONMENT | `production` 或不设置 | ⚠️ **切勿设为 `development`**，否则不会发送 WhatsApp |
| APP_URL | 你的生产域名 | 如 `https://order.waterapp.com` 或 Vercel 地址 |
| WA_TEMPLATE_MAGIC_LINK | 模板名 | 与 admin-resend-magic-link 相同 |
| WA_CLOUD_API_TOKEN | Token | WhatsApp Cloud API |
| WA_CLOUD_PHONE_NUMBER_ID | ID | WhatsApp 电话号码 ID |
| WA_TEMPLATE_LANGUAGE | `id` | 可选，默认 id |

---

## 生产环境测试清单

- [ ] Supabase Secrets 中 **ENVIRONMENT** 不为 `development`（或删除该变量）
- [ ] **APP_URL** 指向实际生产域名（Magic Link 会使用此域名）
- [ ] 前端已部署到生产（Vercel 等）
- [ ] 若 `admin-resend-magic-link` 能发 WhatsApp，则 Secrets 已正确

---

## 设置步骤

1. 打开 https://supabase.com/dashboard/project/zpxdxyjzseuvdhxbuqpc/settings/functions
2. 在 **Secrets** 中确认：`ENVIRONMENT` 不是 `development`，`APP_URL` 为生产域名
3. 若 `admin-resend-magic-link` 已能发送 WhatsApp，则 `auth-check-and-send-link` 可直接使用
