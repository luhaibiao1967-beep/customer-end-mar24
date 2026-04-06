# HQ / 外部应用：订单中 Voucher 与 QRIS 使用情况查询（向 Branch 划款）

本文说明在 **同一 Supabase 项目**中，如何从**订单**维度查清 **水票（voucher）抵扣金额**与 **Midtrans QRIS 实收**，供 HQ 应用或其它系统将款项分摊到 **branch**。  
（更细的券单价逻辑见 **[HQ-水票划款数据逻辑与SQL.md](./HQ-水票划款数据逻辑与SQL.md)**；Midtrans 总表说明见 **[HQ-结算与Midtrans查询说明.md](./HQ-结算与Midtrans查询说明.md)**。）

---

## 1. 两条独立资金流

| 类型 | 含义 | 主要数据来源 | 按网点拆分时 |
|------|------|----------------|----------------|
| **Voucher（水票）** | 客户用已购/赠送水票抵扣桶数，**不同套餐、加权成本不同** | **`voucher_usage_ledger`** | 使用行上的 **`branch`**（下单时快照）与 **`line_amount`**（已含单价×张数） |
| **QRIS（现金）** | 客户通过 Midtrans 实付的 IDR（pre_pay 补差价、later_pay 批量付等） | **`hq_midtrans_settlements`**，并与 **`orders.midtrans_order_id`** 对齐 | 通过 **`orders.branch`** 或下文 **视图** 拆到订单再汇总 |

**不要混淆**：

- **买水票**（`vpc_*` / `voucher_purchase_requests`）是「客户向 HQ 买券」的实收，与**某张配送订单**是不同业务；向 branch 划「订单履约」款时，以 **订单上的 ledger + 订单 QRIS** 为主。
- **订单上的 voucher 消耗**才记入 **`voucher_usage_ledger`**（扣券时写入）。

### 1.1 水票「购买」与 Midtrans 对账（`vpc_*`）

| 数据 | 表 | 说明 |
|------|-----|------|
| 购买申请（套餐/自定义张数、金额、`vpc_` 单号） | **`voucher_purchase_requests`** | 创建 Snap 前插入，`status`：`pending` → `confirmed` |
| Midtrans 成功实收（`transaction_id`、`settled_at`、`gross_amount` 等） | **`hq_midtrans_settlements`** | **`source_type = 'voucher_purchase`**，`midtrans_order_id` 与申请一致；`voucher_purchase_request_id` 可选关联 |

写入时机：

- **`midtrans-webhook`**：收到成功通知时写 `hq_midtrans_settlements`（与确认余额一致）。
- **`confirm-voucher-payment`**（Snap `onSuccess`）：若通知尚未到达，会通过 **Midtrans Status API** **补写**同一结构一行，避免只有 `vpc_` 单号、库里无结算行。

HQ 联查（需已执行迁移 **`hq_vw_voucher_purchase_detail`**）：

```sql
SELECT *
FROM public.hq_vw_voucher_purchase_detail
WHERE request_created_at >= :from_ts
  AND request_created_at < :to_ts
ORDER BY request_created_at DESC;
```

`settlement_id` 为空时：仍可到 Midtrans Dashboard 用 **`midtrans_order_id`** 对账；或确认已部署新版 **`confirm-voucher-payment`** / webhook 正常后再查。

---

## 2. 客户类型与 Midtrans 单号前缀

| `customers.customer_type` | 订单常见情况 | Midtrans 商户 `order_id` 前缀 | 结算表 `source_type` |
|---------------------------|--------------|--------------------------------|----------------------|
| **pre_pay** | 可「部分水票 + 部分 QRIS」 | **`pop_`**（单笔订单补差价） | `prepay_order_qris` |
| **later_pay** | 可后付；后续用 QRIS 合并多笔未付单 | **`op_`**（多订单同一笔支付） | `later_pay_orders` |

查询 **`hq_midtrans_settlements`** 时，用 **`midtrans_order_id`** 与 **`orders.midtrans_order_id`** 对齐即可关联到订单。

---

## 3. Voucher：如何从订单查询（含不同套餐单价）

所有**订单消耗水票**的结算行都在 **`voucher_usage_ledger`**（无 FK 到 `orders`，但 **`order_id` = `orders.id`**）。

| 字段 | 划款用途 |
|------|----------|
| **`branch`** | 该笔消耗归属网点（快照） |
| **`product_id`** | 商品维度 |
| **`voucher_qty`** | 张数（正数消耗，负数一般为取消冲销） |
| **`unit_amount`** | **结算用单价（IDR/张）** — 反映加权购券价、套餐价或赠送 0 价等 |
| **`line_amount`** | **`voucher_qty * unit_amount`**，券侧 **IDR 总额** |
| **`pricing_basis`** | `gift_zero` / `purchase_weighted_avg` / `package_fallback` / `zero_unknown` |

### 3.1 单笔订单：水票用了多少、金额多少

```sql
-- :order_id = orders.id
SELECT
  l.branch,
  p.name AS product_name,
  l.voucher_qty,
  l.unit_amount,
  l.line_amount,
  l.pricing_basis,
  l.created_at
FROM public.voucher_usage_ledger l
LEFT JOIN public.products p ON p.id = l.product_id
WHERE l.order_id = :order_id::uuid
ORDER BY l.created_at;
```

### 3.2 单笔订单：券侧汇总（仅消耗，不含冲销时用 `voucher_qty > 0`）

```sql
SELECT
  l.branch,
  SUM(l.line_amount) AS voucher_settlement_idr
FROM public.voucher_usage_ledger l
WHERE l.order_id = :order_id::uuid
  AND l.voucher_qty > 0
GROUP BY l.branch;
```

### 3.3 按网点、按日汇总券侧（HQ 向 branch 划「水票结算款」）

```sql
SELECT
  l.branch,
  date_trunc('day', l.created_at AT TIME ZONE 'Asia/Jakarta')::date AS day_jkt,
  SUM(l.line_amount) AS voucher_settlement_idr
FROM public.voucher_usage_ledger l
WHERE l.created_at >= :from_ts
  AND l.created_at < :to_ts
  AND l.voucher_qty > 0
GROUP BY l.branch, day_jkt
ORDER BY day_jkt, l.branch;
```

（若需按**送达月**而非**扣券时间**，需关联 `orders.delivered_date`，与业务约定一致即可。）

**只读视图（与 ledger 一致，多订单列）**：`public.hq_vw_order_voucher_settlement` — 可按 `order_id` 或 `branch` 筛选。

---

## 4. QRIS：如何从订单查询

成功实收写入 **`hq_midtrans_settlements`**（**一行对应一笔 Midtrans 商户订单号**）。

| 字段 | 说明 |
|------|------|
| **`midtrans_order_id`** | 与 **`orders.midtrans_order_id`** 相同则属该笔支付 |
| **`gross_amount`** | Midtrans 实收 IDR |
| **`source_type`** | `prepay_order_qris` / `later_pay_orders` / `voucher_purchase` |
| **`order_id`** | **仅 `prepay_order_qris` 时常有值**；**`later_pay_orders` 批量多为 `NULL`**，需按订单拆 |
| **`metadata`** | `later_pay_orders` 时含 **`order_allocations`** / **`orders`** 数组，便于审计 |

### 4.1 pre_pay：单笔订单 QRIS（`pop_*`）

```sql
SELECT
  o.id AS order_id,
  o.branch,
  o.total_amount,
  h.midtrans_order_id,
  h.gross_amount AS qris_idr,
  h.settled_at
FROM public.orders o
JOIN public.hq_midtrans_settlements h
  ON h.midtrans_order_id = o.midtrans_order_id
WHERE o.id = :order_id::uuid
  AND h.source_type = 'prepay_order_qris';
```

### 4.2 later_pay：一笔 QRIS 对应多订单（`op_*`）

同一 **`midtrans_order_id`** 在多条 **`orders`** 上相同，每条订单有各自的 **`branch`**、**`total_amount`**。

**推荐视图**（需在库中已执行迁移 `20260408100000_hq_vw_later_pay_midtrans_per_order.sql`）：

```sql
SELECT *
FROM public.hq_vw_later_pay_midtrans_per_order
WHERE order_id = :order_id::uuid;
```

按网点汇总 QRIS 分摊：

```sql
SELECT
  order_branch,
  SUM(order_amount_idr) AS qris_allocated_idr
FROM public.hq_vw_later_pay_midtrans_per_order
WHERE settlement_created_at >= :from_ts
  AND settlement_created_at < :to_ts
GROUP BY order_branch;
```

---

## 5. 同一订单同时有 Voucher + QRIS（pre_pay 常见）

典型：**2 桶水，1 桶用水票、1 桶 QRIS**。

- **券部分**：只在 **`voucher_usage_ledger`**（1 行或多行，按商品/赠送拆分）。
- **现金部分**：**`hq_midtrans_settlements`** 中 **`pop_*`** 的 **`gross_amount`** = QRIS 实付；**`orders.total_amount`** 多为「应付现金部分」或业务约定下的总价，以 **`hq_midtrans_settlements.gross_amount`** 与 ledger 核对。

**核对公式（逻辑上）**：

```text
券侧（ledger 正数行） + QRIS（pop 对应 settlement 的 gross_amount） ≈ 订单侧业务总价（依你们定价规则）
```

---

## 6. 外部应用接入建议

1. **连接**：使用 **Service Role** 或仅 **`SELECT`** 的 **RLS 策略**（按 branch / HQ 角色），**勿**把 service key 暴露给浏览器。
2. **幂等**：`hq_midtrans_settlements` 以 **`midtrans_order_id`** 唯一；同一笔不要重复入账。
3. **取消订单**：ledger 可能出现 **负数**行冲销；划款净额需按业务是否包含冲销与期间约定。
4. **时区**：报表按 **`Asia/Jakarta`** 约定 `created_at` / `settled_at` 的日期边界。

---

## 7. 相关文件（代码库）

| 路径 | 说明 |
|------|------|
| `supabase/functions/midtrans-webhook/index.ts` | 成功回调写 `hq_midtrans_settlements` |
| `supabase/functions/confirm-snap-payment/index.ts` | Snap 成功后补写结算（与 webhook 二选一或互补） |
| `supabase/migrations/*hq*voucher*`、`hq_midtrans_settlements.sql` | 表与视图定义 |

---

## 8. 快速对照表

| 想查什么 | 查哪里 |
|----------|--------|
| 订单用了多少券、每张结算单价、券侧总金额 | **`voucher_usage_ledger`**（`WHERE order_id = ...`） |
| 订单是否有一笔 QRIS、`pop_` / `op_` 金额 | **`hq_midtrans_settlements`** + **`orders.midtrans_order_id`** |
| later_pay 一笔 QRIS拆到多订单、多 branch | **`hq_vw_later_pay_midtrans_per_order`** |
| 订单网点 | **`orders.branch`**；券流水网点 | **`voucher_usage_ledger.branch`** |

若后续规则变更（例如划款按 `delivered_date` 而非 `created_at`），在 SQL 中改为 **`JOIN orders`** 并按 **`orders.delivered_date` / `status = 'delivered'`** 过滤即可。
