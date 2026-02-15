# Edge Function 部署 - 你需要配合的操作

## 重要说明

**Edge Functions 运行在 Supabase 云端**，它们从 **Supabase Secrets** 读取环境变量，**不会**读取项目根目录的 `.env` 文件。

`.env` 仅用于前端 Vite 构建。`WA_CLOUD_PHONE_NUMBER_ID` 等 WhatsApp 相关变量必须在 Supabase Dashboard 中配置。

---

## 你需要做的（一次性配置）

### 1. 打开 Supabase Secrets 页面

https://supabase.com/dashboard/project/zpxdxyjzseuvdhxbuqpc/settings/functions

### 2. 在 Secrets 中添加/确认以下变量

| 变量名 | 值 | 说明 |
|-------|-----|------|
| WA_CLOUD_PHONE_NUMBER_ID | `960149357187389` | 你已确认的值 |
| WA_CLOUD_API_TOKEN | （你的 Token） | WhatsApp Cloud API 访问令牌 |
| WA_TEMPLATE_MAGIC_LINK | （模板名） | 与 admin-resend-magic-link 相同 |
| APP_URL | `https://你的生产域名` | 如 order.waterapp.com |
| ENVIRONMENT | `production` | 或不设置（切勿用 development） |

### 3. 保存后无需重新部署

Secrets 修改后，已部署的 Edge Function 会自动使用新值，**无需再次执行** `supabase functions deploy`。

---

## 验证

配置完成后，在 Login 页输入已注册的 WhatsApp 号码，应能收到 Magic Link 消息。
