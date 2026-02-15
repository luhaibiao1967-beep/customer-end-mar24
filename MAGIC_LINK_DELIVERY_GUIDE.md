# Magic Link 送达问题 - 完整解决方案

## 问题现状

- API 返回 `accepted`（Meta 已接受）
- 数据库 `whatsapp_messages` 显示 `status: sent`
- 但客户在 WhatsApp 中**收不到消息**

**重要**：`accepted` ≠ `delivered`。Meta 接受请求不代表消息已送达设备。

---

## 方案一：配置 WA_BUSINESS_WHATSAPP_NUMBER（必做）

在 Supabase Secrets 中添加：

| 变量 | 值 | 说明 |
|------|-----|------|
| WA_BUSINESS_WHATSAPP_NUMBER | `15551703205` | 测试用号码（+1 555 170 3205） |
| 或 | `628xxxxxxxx` | 生产用印尼号码（去掉 +） |

**作用**：Login 成功页会显示「Buka chat dengan kami」按钮，点击后打开 WhatsApp 与你的聊天。消息若已送达，会出现在该聊天中；若在「消息请求」中，也会更容易找到。

---

## 方案二：切换到 Live 模式 + 生产号码（根本解决）

**测试号码（+1 555...）的限制**：
- 仅能向 5 个已添加的测试号码发送
- 送达率可能不如正式号码

**建议**：
1. 在 Meta Business Manager 中完成 **Business Verification**
2. 注册 **自有 WhatsApp Business 号码**（印尼号码）
3. 将应用从 **Development** 切换为 **Live**
4. 在 Supabase Secrets 中更新 `WA_BUSINESS_WHATSAPP_NUMBER` 为实际号码

---

## 方案三：创建备用模板（纯文本）

若模板 `magic_link_login`（带按钮）送达有问题，可尝试纯文本模板：

1. Meta Business Manager → **Message templates** → **Create template**
2. 名称：`magic_link_simple`
3. 语言：Indonesian
4. 类别：Marketing
5. Body：`Hello {{1}}, your order link: {{2}}. Save this message for future orders!`
6. 提交审核

审核通过后，在 Supabase Secrets 中设置：
- `WA_TEMPLATE_MAGIC_LINK` = `magic_link_simple`

并在代码中改用 body 参数（需修改 `auth-check-and-send-link` 支持该模板）。

---

## 方案四：检查消息请求

1. 打开 WhatsApp
2. 进入 **设置 → 消息请求**（或 **Message requests**）
3. 查看是否有来自你业务的未读消息
4. 接受后，消息会出现在主聊天列表

---

## 方案五：wa.me 链接

配置 `WA_BUSINESS_WHATSAPP_NUMBER` 后，登录成功页会显示「Buka chat dengan kami」按钮，点击后：
- 打开 WhatsApp 与你的业务聊天
- 若消息已送达，会出现在该聊天中
- 若在消息请求中，可在此处接受

---

## 快速检查清单

- [ ] Supabase Secrets 中已配置 `WA_BUSINESS_WHATSAPP_NUMBER`
- [ ] 测试号码是否为 Meta 允许列表中的 5 个之一
- [ ] 是否已检查「消息请求」
- [ ] 是否已尝试切换到 Live 模式
- [ ] 是否已检查是否屏蔽了业务号码
