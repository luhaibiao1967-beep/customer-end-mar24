# 环境变量核对清单

## 当前 .env（前端用）

| 变量 | 当前值 | 说明 |
|------|--------|------|
| VITE_SUPABASE_MODE | cloud | 使用 Supabase 云 |

**说明**：`.env` 仅用于 Vite 前端构建，以下变量需在 **Supabase Dashboard → Project Settings → Edge Functions → Secrets** 中配置。

---

## auth-check-and-send-link 需要的 Supabase Secrets

| 变量名 | 是否必需 | 说明 |
|-------|----------|------|
| SUPABASE_URL | ✅ 自动注入 | Supabase 项目 URL，通常自动提供 |
| SUPABASE_SERVICE_ROLE_KEY | ✅ 自动注入 | Service Role Key，通常自动提供 |
| APP_URL | ⚠️ 建议设置 | 应用域名，如 `https://order.waterapp.com`，未设置时默认 `https://order.waterapp.com` |
| WA_TEMPLATE_MAGIC_LINK | ⚠️ 必需（生产） | WhatsApp 模板名称，用于发送 Magic Link |
| WA_TEMPLATE_LANGUAGE | 可选 | 语言代码，默认 `id` |
| WA_CLOUD_API_TOKEN | ✅ 必需（生产） | WhatsApp Cloud API Token |
| WA_CLOUD_PHONE_NUMBER_ID | ✅ 必需（生产） | WhatsApp 电话号码 ID |
| ENVIRONMENT | 可选 | 设为 `development` 时跳过 WhatsApp 发送，仅返回 magic_link |

---

## 命名一致性

- 与 `admin-resend-magic-link`、`auth-verify-otp` 使用相同变量名
- 无需在 `.env` 中重复配置，Supabase Secrets 对所有 Edge Functions 生效

---

## 设置步骤

1. 打开 https://supabase.com/dashboard/project/zpxdxyjzseuvdhxbuqpc/settings/functions
2. 在 **Secrets** 中确认或添加上述变量
3. 若 `admin-resend-magic-link` 已能发送 WhatsApp，则 Secrets 已配置，`auth-check-and-send-link` 可直接使用
