# Magic Link 问题 - 具体操作步骤

> 本文档区分「你必须做的」和「AI/自动化已完成的」操作

---

## 第一部分：你必须做的（Supabase Dashboard）

### 步骤 1：打开 Supabase Secrets 页面

1. 打开：https://supabase.com/dashboard/project/zpxdxyjzseuvdhxbuqpc/settings/functions
2. 找到 **Edge Functions → Secrets** 区域

### 步骤 2：检查/配置以下 Secrets

| 变量名 | 操作 | 说明 |
|--------|------|------|
| **ENVIRONMENT** | 删除该变量，或设为 `production` | ⚠️ 若为 `development`，WhatsApp 不会真正发送 |
| **APP_URL** | 设为你的生产域名 | 如 `https://order.waterapp.com` |
| **WA_CLOUD_API_TOKEN** | 确认已配置 | WhatsApp Cloud API 访问令牌 |
| **WA_CLOUD_PHONE_NUMBER_ID** | 确认已配置 | 当前值：`960149357187389` |
| **WA_TEMPLATE_MAGIC_LINK** | 确认已配置 | 与 admin-resend-magic-link 使用的模板名一致 |
| **WA_BUSINESS_WHATSAPP_NUMBER** | 添加：`15551703205` 或你的印尼号码 | 用于 wa.me 链接，帮助客户找到消息 |

**注意**：Secrets 修改后无需重新部署 Edge Function，会自动生效。

### 步骤 3：保存

点击保存，确保所有变量已正确写入。

---

## 第二部分：你必须做的（Meta / WhatsApp）

### 步骤 4：检查测试号码白名单（若使用测试号码）

1. 登录 Meta for Developers：https://developers.facebook.com/
2. 进入你的 WhatsApp 应用 → **WhatsApp → API Setup**
3. 在 **To** 区域查看「Phone numbers」→ 确认接收 Magic Link 的号码在允许的 5 个测试号码中
4. 若不在，点击 **Manage phone number list** 添加

### 步骤 5：检查 WhatsApp「消息请求」

1. 在手机上打开 WhatsApp
2. 进入 **设置 → 消息请求**（或 **Message requests**）
3. 查看是否有来自你业务的未读消息
4. 若有，点击接受，消息会出现在主聊天列表

### 步骤 6：（可选）切换到 Live 模式（根本解决）

若测试号码限制导致无法送达：

1. 在 Meta Business Manager 完成 **Business Verification**
2. 注册 **自有 WhatsApp Business 号码**（印尼号码）
3. 将应用从 **Development** 切换为 **Live**
4. 在 Supabase Secrets 中更新 `WA_BUSINESS_WHATSAPP_NUMBER` 为实际号码

---

## 第三部分：AI 已完成的自动化操作

### 已执行

1. ✅ 部署 `auth-magic-link-diagnostics` Edge Function
2. ✅ 前端构建通过（`npm run build`）
3. ✅ 修正诊断逻辑：支持 WA_TEMPLATE_MAGIC_LINK_SIMPLE
4. ✅ 修正文档中的错误提示（Secrets 修改后无需重新部署）
5. ✅ 登录页增加「🔧 Magic Link 诊断」入口

### 诊断页使用方式

1. 启动项目：`npm run dev`
2. 访问：http://localhost:5173/diagnostics
3. 查看「诊断结论」「环境配置」「最近发送记录」
4. 根据提示逐项排查

---

## 第四部分：验证流程

### 验证 Magic Link 是否发送成功

1. 在登录页输入**已注册**的 WhatsApp 号码
2. 若返回「已注册」，应显示：
   - Magic Link 链接（可点击）
   - 「Buka chat dengan kami」按钮（若已配置 WA_BUSINESS_WHATSAPP_NUMBER）
3. 检查 WhatsApp：
   - 主聊天列表
   - 消息请求
4. 若仍收不到，访问 `/diagnostics` 查看最近发送记录的 `status` 和 `error_detail`

---

## 快速检查清单

- [ ] Supabase Secrets 中 ENVIRONMENT 不为 `development`
- [ ] WA_BUSINESS_WHATSAPP_NUMBER 已配置
- [ ] 测试号码在 Meta 允许的 5 个之一
- [ ] 已检查 WhatsApp「消息请求」
- [ ] 访问 `/diagnostics` 确认无配置缺失
