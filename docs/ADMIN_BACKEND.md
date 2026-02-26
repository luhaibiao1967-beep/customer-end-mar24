# Admin 后台管理说明

## 一、现有架构

### 1.1 客户端 vs 管理端

| 项目 | 用途 | 用户 |
|------|------|------|
| **Customer End** (本仓库) | 客户下单、购券、查看订单 | 终端客户 |
| **Water Depot** (水站管理端) | 客户管理、订单调度、参数配置 | 销售、运营、财务、管理员 |

客户端与管理端**共享同一 Supabase 项目**（water depot 项目 `jzdnvdebwmuebjbergsp`）。

### 1.2 数据库中的 Admin 角色

在 `profiles` 表中已定义角色：

| 角色 | 说明 |
|------|------|
| `admin` | 管理员：最高权限 |
| `sales` | 销售：客户管理、branch 分配 |
| `operator` | 运营：订单调度、配送 |
| `finance` | 财务：支付、对账 |

RLS 策略中，`admin` 拥有与 `operator`、`sales`、`finance` 相同的访问权限。

### 1.3 现有 Admin 相关 Edge Functions

| 函数 | 用途 |
|------|------|
| `admin-resend-magic-link` | 管理端重发 Magic Link 到客户 WhatsApp |

---

## 二、Admin 后台应具备的功能

### 2.1 参数配置

| 配置项 | 说明 | 存储建议 |
|--------|------|----------|
| 新客户赠送 voucher 数量 | 当前固定 5 | `app_settings` 表或 Supabase Secrets |
| OTP 有效期（分钟） | 当前 5 分钟 | 同上 |
| Voucher 套餐及价格 | 当前硬编码在前端 | `voucher_packages` 表 |
| 产品及单价 | 水桶、换桶等 | `products` 表（已有） |
| Branch 列表 | 服务网点 | `branches` 表（已有） |

### 2.2 查询与统计

| 功能 | 说明 |
|------|------|
| 客户列表 | 按 branch、customer_type、注册时间筛选 |
| 订单统计 | 按日期、branch、状态汇总 |
| Voucher 销售统计 | 按套餐、时间汇总 |
| 配送统计 | 按 branch、司机、日期 |
| OTP 发送日志 | `auth_otps`、`otp_send_log` |
| WhatsApp 发送日志 | `whatsapp_messages` |

### 2.3 管理操作

| 操作 | 说明 |
|------|------|
| 分配 Branch | 将 `Pending` 客户分配到具体 branch |
| 修改客户类型 | pre_pay ↔ later_pay |
| 调整 voucher 余额 | 手动增减 |
| 重发 Magic Link | 已有 `admin-resend-magic-link` |
| 订单状态变更 | pending → scheduled → delivered |

---

## 三、实现方式建议

### 3.1 水站管理端 (Water Depot)

Admin 后台应作为**水站管理端项目**的一部分，而非客户端的子模块。管理端通常包括：

- 登录：Supabase Auth（邮箱/密码 或 其他方式）
- 权限：基于 `profiles.role` 的 RLS
- 路由：`/admin` 或独立子域名

### 3.2 新增配置表（可选）

```sql
-- 应用级配置
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 示例
INSERT INTO app_settings (key, value) VALUES
  ('new_customer_voucher_bonus', '5'),
  ('otp_expiry_minutes', '5');
```

### 3.3 Admin 账号创建

1. 在 Supabase Dashboard → Authentication → Users 中创建用户
2. 在 `profiles` 表中插入记录，设置 `role = 'admin'`
3. 管理端登录后，根据 `profiles.role` 展示对应菜单与权限

---

## 四、与本客户端的关系

- **客户端**：不包含 Admin 功能，仅面向终端客户
- **管理端**：独立项目，供内部使用，连接同一 Supabase
- **数据共享**：customers、orders、branches、products 等表由两端共同使用

若需在客户端中增加「Admin 入口」（如 `/admin` 路由），需：

1. 使用 Supabase Auth 做管理员登录
2. 校验 `profiles.role = 'admin'`
3. 可嵌入 iframe 或跳转到独立管理端 URL

---

*文档更新日期：2025-02*
