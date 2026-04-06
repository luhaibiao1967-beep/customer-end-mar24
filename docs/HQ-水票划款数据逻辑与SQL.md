# HQ：水票划款数据逻辑与 SQL

本文档说明 **Customer End / Supabase** 中，与「订单用水票抵扣、券结算单价」相关的**表、写入时机**，以及 **HQ 应用**如何查询（含向 branch 划款时的金额依据）。

---

## 1. 数据存在哪里？

| 需求 | 表 / 视图 | 说明 |
|------|-----------|------|
| 某订单用了几张券、每张结算单价（IDR）、券侧总金额 | **`voucher_usage_ledger`** | 下单扣券时写入；或查视图 **`hq_vw_order_voucher_settlement`** |
| 某订单是否有 Midtrans 实付（补差价等） | **`hq_midtrans_settlements`** | 支付成功回调写入；或视图 **`hq_vw_order_midtrans_cash`** |
| 订单网点、状态 | **`orders`** | `branch`、`status`、`total_amount`、`payment_status` |

**要点**：水票抵扣在 **下单成功** 时记入 `voucher_usage_ledger`；**配送完成** 不会新增一行券流水（划款仍按该订单已产生的 ledger 行）。

---

## 2. 字段含义（`voucher_usage_ledger`）

| 字段 | 含义 |
|------|------|
| `order_id` | 订单 UUID |
| `branch` | 下单时的服务网点（快照） |
| `product_id` | 商品 |
| `voucher_qty` | 张数；**正数** = 消耗；**负数** = 取消订单冲销 |
| `unit_amount` | **结算单价（IDR/张）**，用于 HQ 向 branch 分摊 |
| `line_amount` | `voucher_qty * unit_amount`（IDR） |
| `pricing_basis` | `gift_zero` / `purchase_weighted_avg` / `package_fallback` / `zero_unknown` |

---

## 3. 查询：某订单用了多少 voucher、单价与金额

将 `:order_id` 换成实际订单 UUID。

### 3.1 明细（按商品维度，可能多行：赠送一行 + 购买一行）

```sql
SELECT
  product_id,
  voucher_qty,
  unit_amount,
  line_amount,
  pricing_basis,
  created_at
FROM public.voucher_usage_ledger
WHERE order_id = :order_id
ORDER BY created_at;
```

### 3.2 汇总：本单共消耗多少张、券侧结算总额（IDR）

**仅统计**实际消耗（不含负数冲销时若需单独看净额，可用下面「净额」版）。

```sql
SELECT
  SUM(voucher_qty) AS total_vouchers_used,
  SUM(line_amount) AS total_voucher_settlement_idr
FROM public.voucher_usage_ledger
WHERE order_id = :order_id
  AND voucher_qty > 0;
```

### 3.3 使用视图（与 3.1 等价，多订单信息列）

```sql
SELECT *
FROM public.hq_vw_order_voucher_settlement
WHERE order_id = :order_id
ORDER BY ledger_created_at;
```

---

## 4. `pricing_basis` 简表

| 值 | 含义 |
|----|------|
| `gift_zero` | 赠送券，单价 0 |
| `purchase_weighted_avg` | 按客户已确认购票的加权平均 |
| `package_fallback` | 无购票记录时用套餐折算 |
| `zero_unknown` | 无法解析时为 0 |

---

## 5. Midtrans 现金（同一订单）

若 pre_pay 订单有 QRIS 补差价：

```sql
SELECT gross_amount, source_type, midtrans_order_id, settled_at
FROM public.hq_midtrans_settlements
WHERE order_id = :order_id
   OR midtrans_order_id = (SELECT midtrans_order_id FROM public.orders WHERE id = :order_id);
```

---

## 6. 迁移

视图由迁移 **`20260406100000_hq_settlement_views.sql`** 创建；部署后 HQ 可直接 `SELECT` 上述视图。
