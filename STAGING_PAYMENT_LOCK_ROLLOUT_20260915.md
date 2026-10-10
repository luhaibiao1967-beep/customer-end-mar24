# Staging 付款预留与统一锁部署清单（2026-09-15）

## 强制边界

- 唯一允许目标：Vividaqua Staging Clone `qdnruupfqeiojmxvfzds`。
- 禁止目标：Production `fjnadtyaysddxwyccert`。
- 当前远程状态：尚未部署。本地两套历史结构最终态行为测试合计 368/368 通过；真实双连接并发测试两套各 4/4 通过。
- 不要直接执行全仓库 `supabase db push`：远程迁移历史尚未读取成功，且仓库旧迁移包含硬编码的 Production URL。只执行本清单明确列出的 2026-09-14 加固链。

## 1. 只读确认

1. 本地链接保护：`supabase/.temp/project-ref` 必须精确等于 `qdnruupfqeiojmxvfzds`。
2. 在 Staging SQL Editor 运行：
   - `supabase/verification/20260915_staging_hardening_chain_status_read_only.sql`
   - `supabase/verification/20260914_payment_hardening_preflight_read_only.sql`
3. 若任一预检返回 `BLOCK`，停止部署并先处理数据；`REVIEW` 必须记录数量和处置决定。

## 2. 数据库迁移顺序

状态清单中的 `20260914110000` 至 `20260914220000` 是本批迁移的前置条件。它们必须全部显示 `INSTALLED`；若有任意 `MISSING`，停止并先核对 Staging 历史，不要根据单个缺失项猜测或跳跃补跑。

前置条件满足后，只执行本次新增的 4 个迁移。它们已在两套本地历史结构上验证可重复执行：

1. `20260914230000_atomic_later_pay_payment_reservation.sql`
2. `20260914240000_unify_customer_order_transaction_locks.sql`
3. `20260914250000_atomic_staff_payment_and_trip_workflows.sql`
4. `20260914260000_atomic_customer_delivery_confirmation.sql`

执行完后重新运行状态清单，16 行必须全部为 `INSTALLED`，然后才能进入回滚型行为测试。

## 3. 数据库验收边界

五个 `*_behavior_rollback.sql` 带有本地数据库名硬护栏，只允许在
`audit_root_acl18`、`audit_cafa_customer` 或一次性审计克隆中运行；不得删除护栏后在
Staging 主库运行。它们已在两套历史结构上合计完成 368/368、0 FAIL。真实双连接并发
脚本也只能用于名称为 `audit_lock_%` 的一次性克隆库。

Staging SQL Editor 只运行以下只读部署后检查：

1. `20260915_staging_hardening_chain_status_read_only.sql`：16/16 `INSTALLED`
2. `20260914_identity_acl_postdeploy_read_only.sql`：全部 `PASS`、0 offender
3. `20260915_staging_payment_lock_postdeploy_read_only.sql`：全部 `PASS`、0 offender

随后通过 Edge Functions + Midtrans Sandbox 浏览器流程验证真实远程行为。

## 4. Edge Functions 部署

数据库验收通过后再部署，webhook 最后部署：

1. `create-order-payment`
2. `confirm-snap-payment`
3. `payment-action`
4. `customer-self-service`
5. `create-qris-payment`
6. `midtrans-webhook`

部署前确认 Staging Secrets 使用 Midtrans Sandbox，且没有 Production Midtrans 密钥或流量。

## 5. 浏览器可见验收

1. later-pay 订单第一次点击付款：生成一张 QRIS，订单立即显示“付款处理中/继续付款”。
2. 关闭弹窗后再次点击：复用同一个支付标识和 Snap 会话，不生成第二笔付款。
3. 付款处理中：订单不可编辑、不可直接取消，证据上传也会被拒绝。
4. Sandbox 支付成功：webhook 与手动“检查状态”重复触发仍只结算一次。
5. Sandbox 过期/取消：预留释放，订单恢复可编辑/可重新付款。
6. staff 付款、撤销、排车、取消、送达：并发操作要么完整成功，要么完整失败，不出现半完成数据。
7. 券订单取消：订单停用、余额恢复、正向与冲正账本均保留。

## 6. 停止与回退门槛

- 任一脚本出现 FAIL、权限比预期更宽、金额不一致、重复 Midtrans ID 或 HTTP 5xx：立即停止后续步骤。
- Edge Function 出错时先恢复上一个 Staging 版本；不要把新前端发布到 Production。
- 数据库迁移主要是加法与权限收紧，不做临时手写“反向 SQL”。需要恢复时使用 Staging 快照/克隆并保留问题库用于审计。
- 完成 Staging 验收之前，Production 继续保持零改动。

## 当前连接限制

当前电脑可以通过 Supabase 管理 API确认 Staging 为 `ACTIVE_HEALTHY` 且本地链接正确，但数据库直连受 IPv6/TLS 网络路径限制，CLI 尚未执行任何远程 SQL。可选安全路径：

- 使用已登录的 Staging Dashboard SQL Editor 按本清单执行；或
- 在本机安全设置 Staging 的 IPv4 pooler 数据库密码后再使用 CLI/psql。不要把数据库密码粘贴到聊天或提交到仓库。
