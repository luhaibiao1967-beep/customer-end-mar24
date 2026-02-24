# Magic Link 项目状态总结

> 文档生成时间：2025-02-15  
> 用途：供下一个 AI 助手快速了解项目现状并继续工作

---

## 一、已完成的部分

### 1.1 前端修改

| 文件 | 修改内容 |
|------|----------|
| `src/App.tsx` | 新增 `/diagnostics` 路由；导入 `MagicLinkDiagnostics` 组件 |
| `src/Pages/CustomerLogin.tsx` | 登录页：输入 WhatsApp → 调用 `auth-check-and-send-link`；已注册显示 Magic Link + wa.me 按钮；未注册跳转注册 |
| `src/Pages/CustomerRegister.tsx` | 注册页：提交表单前先调用 `auth-check-and-send-link`；若已注册则跳过 OTP，直接显示 Magic Link + wa.me + 进入 Dashboard |
| `src/Pages/MagicLinkDiagnostics.tsx` | **新建**：诊断页面，展示环境配置、发送统计、最近 20 条 login_link 记录 |
| `src/Components/MagicLinkHandler.tsx` | 处理 `/home?token=xxx`，校验 token 后跳转 `/customer-home` |

### 1.2 后端 Edge Functions

| 文件 | 说明 |
|------|------|
| `supabase/functions/auth-check-and-send-link/index.ts` | 检查客户是否存在；存在则发送 Magic Link 模板消息 |
| `supabase/functions/auth-magic-link-diagnostics/index.ts` | **新建**：诊断接口，返回 env 状态、最近 login_link 发送记录 |
| `supabase/functions/_shared/whatsappCloud.ts` | `sendTemplateMessage`、`buildButtonUrlComponents`、`buildBodyParams` |
| `supabase/functions/auth-verify-otp/index.ts` | OTP 验证 + 注册完成时发送 Magic Link |
| `supabase/functions/auth-validate-token/index.ts` | 校验 Magic Link token |
| `supabase/functions/auth-send-otp/index.ts` | 发送 OTP |
| `supabase/functions/admin-resend-magic-link/index.ts` | 管理端重发 Magic Link |

### 1.3 配置与文档

| 文件 | 说明 |
|------|------|
| `.env` | `VITE_SUPABASE_MODE=cloud`；`WA_CLOUD_PHONE_NUMBER_ID=960149357187389`（仅本地参考，Edge Functions 不读此文件） |
| `ENV_SECRETS_CHECKLIST.md` | Supabase Secrets 配置清单 |
| `EDGE_FUNCTION_DEPLOY.md` | Edge Function 部署说明、诊断页说明 |
| `MAGIC_LINK_DELIVERY_GUIDE.md` | Magic Link 送达问题排查指南 |

### 1.4 数据库迁移

| 文件 | 说明 |
|------|------|
| `supabase/migrations/20260215130000_add_login_link_message_type.sql` | 将 `login_link` 加入 `whatsapp_messages.message_type` 约束 |

---

## 二、当前配置（已确认）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| **WA_CLOUD_PHONE_NUMBER_ID** | `960149357187389` | 已确认，写在 `.env` 和文档中 |
| **WA_TEMPLATE_MAGIC_LINK** | 需在 Supabase Secrets 中配置 | 文档建议：`magic_link_login`（带按钮）或 `magic_link_simple`（纯文本） |
| **Supabase 项目** | `zpxdxyjzseuvdhxbuqpc` | Secrets 页面：https://supabase.com/dashboard/project/zpxdxyjzseuvdhxbuqpc/settings/functions |

**注意**：`WA_TEMPLATE_MAGIC_LINK`、`WA_CLOUD_API_TOKEN`、`APP_URL`、`ENVIRONMENT`、`WA_BUSINESS_WHATSAPP_NUMBER` 等均在 **Supabase Dashboard → Edge Functions → Secrets** 中配置，**不**从 `.env` 读取。

---

## 三、未解决的问题

### 3.1 Magic Link 无法送达

- **现象**：API 返回成功，数据库 `whatsapp_messages` 为 `status: sent`，但客户在 WhatsApp 收不到消息。
- **可能原因**：`ENVIRONMENT=development`（不实际发送）、测试号码白名单、消息在「消息请求」、需切换 Live 模式等。详见 `MAGIC_LINK_DELIVERY_GUIDE.md`。

### 3.2 42 个 Problems 未消除

- **说明**：用户反馈 IDE 中仍有 42 个 Problems，具体来源未在本会话中完整排查。
- **可能来源**：
  - TypeScript 类型错误
  - ESLint 规则违规
  - 未使用的导入/变量
  - Deno 与 Node 环境差异（Edge Functions 使用 Deno）
- **建议**：下一个 AI 助手需执行 `npm run lint`、`npm run build`，并查看 IDE Problems 面板，逐项定位并修复。

### 3.3 Edge Function 部署状态

- **已部署（推测）**：`auth-check-and-send-link`、`auth-send-otp`、`auth-verify-otp`、`auth-validate-token`、`admin-resend-magic-link`、`order-confirmation` 等（项目此前已在使用）。
- **未确认是否已部署**：`auth-magic-link-diagnostics`（本次新建）。
- **部署命令**：`supabase functions deploy auth-magic-link-diagnostics`（需在项目根目录执行，且已登录 Supabase CLI）。

---

## 四、给下一个 AI 助手的具体指令

### 步骤 1：排查并修复 42 个 Problems

1. 在项目根目录执行：
   ```bash
   npm run lint
   npm run build
   ```
2. 打开 IDE 的 **Problems** 面板，查看所有报错/警告。
3. 逐项修复：类型错误、未使用变量、ESLint 规则等。
4. 若为 Deno/Edge Function 相关，检查 `supabase/functions/` 下文件，确保符合 Deno 语法。

### 步骤 2：确认并部署 Edge Function

1. 确认 Supabase CLI 已登录：`supabase login`
2. 部署诊断函数：
   ```bash
   supabase functions deploy auth-magic-link-diagnostics
   ```
3. 若其他 Edge Function 有修改，一并部署：
   ```bash
   supabase functions deploy auth-check-and-send-link
   supabase functions deploy auth-verify-otp
   # 按需部署其他函数
   ```

### 步骤 3：验证 Magic Link 诊断页

1. 启动前端：`npm run dev`
2. 访问 `http://localhost:5173/diagnostics`
3. 若接口报错，检查 `auth-magic-link-diagnostics` 是否已部署、Supabase 项目是否正确。
4. 根据诊断页的「诊断结论」「环境配置」「最近发送记录」判断 Magic Link 无法送达的具体原因。

### 步骤 4：根据诊断结果修复 Magic Link 送达

1. 若诊断显示 `ENVIRONMENT=development`：在 Supabase Secrets 中删除或改为 `production`。
2. 若 `WA_TEMPLATE_MAGIC_LINK` 未配置：在 Meta 创建模板，并在 Secrets 中设置。
3. 若 `status: failed`：查看诊断页中的 `error_detail`，按错误信息修复（如 Token 过期、模板名错误等）。
4. 若 `status: sent` 但用户收不到：参考 `MAGIC_LINK_DELIVERY_GUIDE.md`，检查测试号码白名单、消息请求、Live 模式等。

### 步骤 5：可选优化

- 在登录页或诊断页增加「前往诊断」入口，方便用户自助排查。
- 若需纯文本模板，可配置 `WA_TEMPLATE_MAGIC_LINK_SIMPLE`，代码已支持。

---

## 五、项目结构速览

```
water-depot-customer-end-dev-Jan-31/
├── .env                          # 前端用，Edge Functions 不读
├── src/
│   ├── App.tsx                   # 路由：/home, /diagnostics, /, /register, /reauth, /customer-home 等
│   ├── Pages/
│   │   ├── CustomerLogin.tsx      # 登录入口
│   │   ├── CustomerRegister.tsx   # 注册（已注册则跳过 OTP）
│   │   ├── MagicLinkDiagnostics.tsx  # 诊断页
│   │   └── ...
│   └── Components/
│       └── MagicLinkHandler.tsx   # /home?token=xxx 处理
├── supabase/
│   ├── functions/
│   │   ├── auth-check-and-send-link/
│   │   ├── auth-magic-link-diagnostics/  # 新建
│   │   ├── auth-verify-otp/
│   │   ├── auth-validate-token/
│   │   └── _shared/whatsappCloud.ts
│   └── migrations/
└── MAGIC_LINK_STATUS.md          # 本文件
```

---

## 六、关键链接

- Supabase Secrets：https://supabase.com/dashboard/project/zpxdxyjzseuvdhxbuqpc/settings/functions
- 诊断页（部署后）：`https://你的域名/diagnostics`
- Magic Link 格式：`https://APP_URL/home?token={customer.auth_token}`
