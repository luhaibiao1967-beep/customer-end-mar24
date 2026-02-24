# WhatsApp 未收到 Magic Link - 排查步骤

API 显示 `sent`，但手机收不到消息。按以下顺序排查：

---

## 1. 立即可用：网页直接登录

登录页已显示 **「Masuk ke Dashboard」** 按钮和 **「Salin link」**（复制链接），可直接点击或复制链接在浏览器打开，**无需等待 WhatsApp**。

---

## 2. 检查 WhatsApp「消息请求」

1. 打开 WhatsApp
2. **设置** → **消息请求**（Message requests）
3. 查看是否有来自业务的未读消息
4. 接受后，消息会出现在主聊天列表

---

## 3. Meta 测试号码白名单（若使用 Development 模式）

若 WA_CLOUD_PHONE_NUMBER_ID 对应的是 Meta 测试号（+1 555...）：

1. 打开 [Meta for Developers](https://developers.facebook.com/) → 你的应用 → **WhatsApp** → **API Setup**
2. 在 **To** 区域找到 **Phone numbers**
3. 确认 **+6281251617360** 在允许的 **5 个测试号码** 中
4. 若不在，点击 **Manage phone number list** 添加

---

## 4. 根本解决：切换到 Live 模式

测试号码有送达限制，建议：

1. 在 Meta Business Manager 完成 **Business Verification**
2. 注册 **自有 WhatsApp Business 号码**（印尼号码）
3. 将应用从 **Development** 切换为 **Live**
4. 在 Supabase Secrets 中更新 `WA_BUSINESS_WHATSAPP_NUMBER` 为实际号码

---

## 5. 尝试纯文本模板（可选）

若带按钮的模板 API 显示 sent 但收不到，可尝试纯文本模板：

1. Meta Business Manager → **Message templates** → **Create template**
2. 名称：`magic_link_simple`
3. 语言：Indonesian，类别：Utility
4. Body：`Hello {{1}}, your order link: {{2}}`
5. 提交审核，通过后在 Supabase Secrets 添加：
   - `WA_TEMPLATE_MAGIC_LINK_SIMPLE` = `magic_link_simple`
6. 代码会优先使用该模板（纯文本可能送达率更高）

---

## 6. 确认 Meta 应用模式

若使用 **Development** 模式 + 测试号码（+1 555...），送达可能不稳定。建议：
- 完成 Business Verification 后切换为 **Live** 模式
- 使用自有印尼号码作为 WhatsApp Business 号码
