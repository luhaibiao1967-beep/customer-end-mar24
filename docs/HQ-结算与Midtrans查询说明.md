# HQ 结算与 Midtrans 查询说明

本文档说明 **HQ 后台应用** 如何连接同一 Supabase 项目，查询 **水票抵扣流水** 与 **Midtrans 实收**，用于对账与向 branch 划款。

**更细的「按订单查券张数、单价、结算金额」**：见 **[HQ-水票划款数据逻辑与SQL.md](./HQ-水票划款数据逻辑与SQL.md)**。

---

## 1. 数据来源

| 含义 | 表 | 说明 |
|------|-----|------|
| 水票抵扣（含赠送 0 价、购买加权价、套餐价等） | `voucher_usage_ledger` | 下单扣券时由 Edge Function 写入；按 `branch` 汇总 `line_amount` |
| Midtrans 成功实收（QRIS 等到账） | `hq_midtrans_settlements` | 由 `midtrans-webhook` 在 **支付成功** 时写入，**一行对应一笔** Midtrans 商户 `order_id` |
| 订单主数据 | `orders` | `branch`、`customer_id`、`total_amount`、`midtrans_order_id` 等 |

**注意**：水票抵扣不一定经过 Midtrans；QRIS 差额、购票、批量付订单款才会进 Midtrans，并出现在 `hq_midtrans_settlements`。

---

## 2. `hq_midtrans_settlements` 字段说明

| 字段 | 含义 |
|------|------|
| `midtrans_order_id` | 商户侧订单号（唯一）：`pop_` pre_pay 下单 QRIS、`vpc_` 购票、`op_` 多订单合并付 |
| `midtrans_transaction_id` | Midtrans `transaction_id`（对账用） |
| `gross_amount` | 实收金额（IDR，整数） |
| `source_type` | `prepay_order_qris` \| `voucher_purchase` \| `later_pay_orders` |
| `customer_id` | 客户 |
| `branch` | 写入时的网点快照（`op_` 多笔订单时取首单 branch，明细见 `metadata`） |
| `order_id` | 单笔关联时填写（`prepay_order_qris` 有值） |
| `voucher_purchase_request_id` | 购票记录（`voucher_purchase`） |
| `metadata` | JSON；`later_pay_orders` 时含 `orders` 数组（各单 `id`、`branch`、`total_amount`） |
| `raw_notification` | Midtrans 回调原文（审计） |
| `settled_at` | 结算时间（来自回调或写入时间） |

---

## 3. 查询示例（PostgreSQL）

### 3.1 按 branch、日期汇总 Midtrans 实收

```sql
SELECT
  branch,
  SUM(gross_amount) AS midtrans_idr
FROM hq_midtrans_settlements
WHERE created_at >= $1 AND created_at < $2
GROUP BY branch
ORDER BY branch;
```

### 3.2 按 branch 汇总水票抵扣（ledger）

```sql
SELECT
  branch,
  SUM(line_amount) AS ledger_idr
FROM voucher_usage_ledger
WHERE created_at >= $1 AND created_at < $2
  AND voucher_qty > 0
GROUP BY branch
ORDER BY branch;
```

（若需含取消冲销的负数行，勿加 `voucher_qty > 0`，改与业务约定净额规则。）

### 3.3 核对单笔 pre_pay 订单（券 + QRIS）

```sql
-- 订单
SELECT id, branch, total_amount, midtrans_order_id, payment_status
FROM orders
WHERE id = $order_id;

-- 券侧
SELECT * FROM voucher_usage_ledger WHERE order_id = $order_id;

-- QRIS 实付（若有）
SELECT * FROM hq_midtrans_settlements WHERE order_id = $order_id;
```

### 3.4 later_pay 批量 QRIS（`op_*`）按订单 / 按网点拆实收

同一笔 Midtrans 支付对应多个 `orders` 行时，每条订单的 **`orders.midtrans_order_id`** 相同，与 **`hq_midtrans_settlements.midtrans_order_id`** 一致。结算表一行里的 **`metadata.order_allocations`** 含每笔 `order_id`、`branch`、`amount_idr`；也可用视图按订单展开：

```sql
SELECT *
FROM hq_vw_later_pay_midtrans_per_order
WHERE settlement_created_at >= $1 AND settlement_created_at < $2;

-- 按 branch 汇总该时段 later_pay 实收（与 3.1 全量汇总不同，此处仅 op_* 批次拆行）
SELECT order_branch, SUM(order_amount_idr) AS idr
FROM hq_vw_later_pay_midtrans_per_order
WHERE settlement_created_at >= $1 AND settlement_created_at < $2
GROUP BY order_branch;
```

---

## 4. HQ 应用接入建议

1. **使用 Service Role** 仅在后端调用 Supabase，**勿**把 service key 放进浏览器。
2. 生产环境对账：Midtrans Dashboard 日汇总 vs `SUM(gross_amount)` 按日。
3. RLS：`hq_midtrans_settlements` 默认无开放 policy，匿名/登录用户不能直接读；HQ 用 **service role** 或后续为运营角色单独加 policy。

---

## 5. 历史数据说明

在部署本表与 webhook 逻辑 **之前** 已成功、但未写入 `hq_midtrans_settlements` 的支付，**无法从本表自动补全**，需从 Midtrans 后台导出后对账。新产生的成功回调会入库。

---

## 6. 与本仓库的对应关系

- 迁移文件：`supabase/migrations/*_hq_midtrans_settlements.sql`
- Edge Function：`supabase/functions/midtrans-webhook/index.ts`

更新表结构或回调字段后，请同步修订本文档。

---

## 7. 你需要手动执行的 SQL 吗？

| 场景 | 是否需要手跑 SQL |
|------|------------------|
| 本机/云端使用 **Supabase CLI** 部署迁移（如 `supabase db push` 或链接项目的 CI） | **不需要**。新迁移 `20260405100000_hq_midtrans_settlements.sql` 会随迁移自动执行。 |
| **只使用 Supabase Dashboard**，不用 CLI | **需要一次**：打开 **SQL Editor**，将仓库里该迁移文件的 **完整内容** 复制粘贴执行。 |
| 部署 **Edge Function** `midtrans-webhook` | 在 Dashboard **Functions** 中上传/部署，或用 CLI `supabase functions deploy midtrans-webhook`（**不是** SQL）。 |
| 补历史 Midtrans 数据 | **无现成 SQL**；过去未落库的收款需从 Midtrans 导出或人工补录（若自建补录表）。 |

部署完成后，无需为 `hq_midtrans_settlements` 再执行额外「初始化数据」SQL。
