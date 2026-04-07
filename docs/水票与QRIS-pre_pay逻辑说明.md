# 水票与 QRIS（pre_pay）逻辑说明

本文档归纳客户端 **pre_pay（预付费）** 下单时 **水票抵扣** 与 **Midtrans QRIS 现金** 的数据流、表职责与常见误区，便于后续维护与对账。

**相关代码与迁移（随仓库更新）：**

| 类型 | 路径 |
|------|------|
| pre_pay 下单 + Snap | [`supabase/functions/submit-prepay-order/index.ts`](../supabase/functions/submit-prepay-order/index.ts) |
| Midtrans 回调 | [`supabase/functions/midtrans-webhook/index.ts`](../supabase/functions/midtrans-webhook/index.ts) |
| Snap 成功补单 / 补 settlement | [`supabase/functions/confirm-snap-payment/index.ts`](../supabase/functions/confirm-snap-payment/index.ts) |
| 订单字段与 HQ 视图 | [`supabase/migrations/20260411120000_orders_prepay_breakdown.sql`](../supabase/migrations/20260411120000_orders_prepay_breakdown.sql) |
| 前端下单页 | [`src/Pages/PlaceOrder.tsx`](../src/Pages/PlaceOrder.tsx) |

---

## 1. 客户类型与支付路径（对照）

| 客户类型 | 典型流程 | Midtrans 商户订单号前缀 | 说明 |
|----------|----------|-------------------------|------|
| **pre_pay** | 下单时水票 + 不足部分 QRIS（Snap） | **`pop_`** | 本文重点 |
| **later_pay** | 先记账下单，之后在订单列表批量 QRIS | **`op_`** | 见 HQ 其它文档 |
| 水票套餐购买（QRIS） | 单独购票 | **`vpc_`** | 写入 `voucher_purchase_requests` 等 |

**`vcp_`（自定义数量购票）**：由 `create-qris-payment` 生成时，当前 webhook 未按 `vpc_` 对称处理 **`hq_midtrans_settlements`**，购票成功若未走补全逻辑可能不落表；与 **pre_pay 订单 `pop_`** 是不同场景。

---

## 2. 金额三层含义（不要混用）

对 **pre_pay 一单** 通常同时存在下面几种「金额」，含义不同：

1. **`orders.total_amount`（目录总价）**  
   前端按行：`单价 × 数量` 汇总，例如 **3 桶 × 15000 = 45000**。表示商品标价合计，**不等于**  necessarily 客户扫码支付的金额。

2. **`payment_amount` / `qris_charged_idr`（QRIS 应收）**  
   前端传入 `payment_amount`（应付现金部分）；Edge Function 中 `qrisAmount = payment_amount ?? order.total_amount`。  
   写入订单列 **`qris_charged_idr`**（与迁移注释一致），应与 **Midtrans 实收**、**`hq_midtrans_settlements.gross_amount`** 对账。

3. **水票抵扣（赠票 / 付费票余额）**  
   从 `customer_product_vouchers` 扣减；**赠票** 与 **付费票** 在扣减时按「先消耗赠票余额」拆分（`splitGiftAndPaidVoucherQty`）。

**误区：** 用 `orders.total_amount` 去对 Midtrans，会在「多桶用水票、少桶付现金」时**系统性偏大**。对现金应以 **`qris_charged_idr` / `hq_midtrans_settlements`** 为准。

---

## 3. `voucher_usage_ledger`：只记「扣水票余额」，不记「纯 QRIS 桶」

- 写入来源：`submit-prepay-order` 在扣减 `customer_product_vouchers` 后，按 `product_deductions` 生成 **gift / paid** 拆分，再 **`insertVoucherUsageLines`**。
- **赠票**：`pricing_basis = gift_zero`，`line_amount = 0`。
- **付费票余额**：按加权进价或套餐兜底算出 `unit_amount`、`line_amount`。
- **用 QRIS 直接支付、未从付费水票余额扣桶** 的那部分数量：**不会产生 ledger 行**。  
  因此可能出现「一单只有赠票两行、没有第三行」——**属当前设计**，不是漏插 ledger。

**对账时：** 现金部分看 **`hq_midtrans_settlements`**（及订单上的 **`qris_charged_idr`**）；水票消耗看 **ledger**；不要用「ledger 行数」反推 QRIS 桶数。

---

## 4. Midtrans 成功与 `hq_midtrans_settlements`

- 表 **`hq_midtrans_settlements`**：一笔 Midtrans 商户订单号一行，`source_type` 对 **`pop_`** 为 **`prepay_order_qris`**。
- **`midtrans-webhook`**：在 `transaction_status` 为成功（settlement 或 capture+accept）时写入；**`pop_`** 分支需能根据 `midtrans_order_id` 找到 **`orders`** 行。

**曾出现的问题（已修复）：**  
若 **`midtrans_order_id` 写在创建订单之后、Snap 返回之后**，可能出现 **Webhook 早于 UPDATE** 到达 → 查无订单 → **不落 `hq_midtrans_settlements`、订单仍 unpaid**。  
**修复：** 在 **`submit-prepay-order` 创建订单的 INSERT 中即写入 `midtrans_order_id`**（与即将用于 Snap 的 `pop_` 一致），再调 Midtrans。

**补单：** 前端 **`confirm-snap-payment`** 可在用户支付成功后，用 Midtrans Status API 补写 **`hq_midtrans_settlements`**（与 webhook 幂等，`midtrans_order_id` 唯一）。

---

## 5. 订单快照：`qris_charged_idr` 与 `prepay_breakdown`

迁移 **`20260411120000_orders_prepay_breakdown.sql`** 为 **`orders`** 增加：

- **`qris_charged_idr`**：本单计划 QRIS 金额（整数 IDR）。
- **`prepay_breakdown`（jsonb）**：下单时快照，主要包括：
  - `catalog_total_idr`：与 `order.total_amount` 一致；
  - `qris_idr`：与 `qris_charged_idr` 一致；
  - `voucher_splits`：与 ledger 一致的按产品 `from_gift` / `from_paid`；
  - `item_cash_units`：按行拆 **多少桶走水票抵扣、多少桶走纯 QRIS**（`by_voucher` / `by_qris`）。

仅在 **`submit-prepay-order`** 成功完成水票扣减逻辑后、调用 Snap **之前** 更新订单。**迁移前历史订单** 这两列可为 **NULL**。

---

## 6. HQ 视图：`hq_vw_prepay_order_payment`

- 筛选 **`midtrans_order_id ~ '^pop_'`** 的 pre_pay Snap 单。
- 左连 **`hq_midtrans_settlements`**，并聚合 **`voucher_usage_ledger`**（赠票数量、非赠票数量、`line_amount` 合计等）。

便于一条 SQL 对照：**目录总价、计划 QRIS、Midtrans 实收、水票 ledger**。

---

## 7. 前端与请求体（pre_pay）

- 页面：**`PlaceOrder`**，`handlePayWithQris` 调用 **`submit-prepay-order`**。
- Body 要点：`order.total_amount`、`payment_amount`（即应付 QRIS）、`product_deductions`（按产品扣票数量）、`items`。

---

## 8. 排查清单（少一笔 settlement / 金额不对）

1. Midtrans 后台 **Order ID** 是否为 **`pop_` 开头**，且与本库 **`orders.midtrans_order_id`** 一致。  
2. **`hq_midtrans_settlements.gross_amount`** 是否与 Midtrans **Gross** 一致（不要用 `total_amount` 代替 QRIS）。  
3. **`voucher_usage_ledger`**：赠票/付费票行是否符合预期；纯 QRIS 桶**无 ledger 行**是否正常。  
4. 若需人工补 **`hq_midtrans_settlements`**，注意 **`midtrans_order_id` 唯一**；并核对 **`orders.payment_status`** 是否需改为 **paid**。

---

*文档版本：与 `main` 分支中上述迁移及 Edge Function 行为对齐；若改表或改 webhook，请同步更新本文。*
