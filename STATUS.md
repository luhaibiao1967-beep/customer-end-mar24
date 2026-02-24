# 本轮修改总结 (STATUS.md)

> 记录 Magic Link 相关改动及当前状态

---

## 一、本轮修改的所有逻辑

### 1. 注册页「已注册跳过 OTP」

- **文件**：`src/Pages/CustomerRegister.tsx`
- **逻辑**：提交表单时先调用 `auth-check-and-send-link`；若返回 `exists: true`，则不再发 OTP，直接显示「已注册」界面（Magic Link + wa.me + 进入 Dashboard）。
- **新增状态**：`alreadyRegistered`、`waMeUrl`。

### 2. 诊断功能

- **后端**：新建 `supabase/functions/auth-magic-link-diagnostics/index.ts`，查询 `whatsapp_messages` 中 `message_type = 'login_link'` 的记录，返回环境配置状态和最近 20 条发送记录。
- **前端**：新建 `src/Pages/MagicLinkDiagnostics.tsx`，调用上述接口并展示诊断结果。

### 3. 路由与入口

- **文件**：`src/App.tsx`
- **改动**：新增 `/diagnostics` 路由，挂载 `MagicLinkDiagnostics` 组件。

---

## 二、App.tsx 具体改动

| 改动 | 说明 |
|------|------|
| 新增 import | `import MagicLinkDiagnostics from './Pages/MagicLinkDiagnostics'` |
| 新增路由 | `<Route path="/diagnostics" element={<MagicLinkDiagnostics />} />`，放在 `/home` 之后、`/` 之前，无需登录即可访问 |

**未改动**：其他路由、`loadCustomer`、`sessionStorage`、`storage` 事件监听等逻辑保持不变。

---

## 三、MagicLinkDiagnostics.tsx 用途

**作用**：Magic Link 发送诊断页，用于排查「链接发不出或收不到」的原因。

**功能**：

1. 调用 Edge Function `auth-magic-link-diagnostics`
2. 展示**诊断结论**：DEV 模式、配置缺失、API 失败等
3. 展示**环境配置**：`ENVIRONMENT`、`WA_TEMPLATE_MAGIC_LINK`、`WA_CLOUD_API_TOKEN`、`WA_CLOUD_PHONE_NUMBER_ID`、`APP_URL` 等（不暴露具体密钥）
4. 展示**发送统计**：最近 20 条 `login_link` 的 sent/failed 数量
5. 展示**最近发送记录**：号码脱敏、状态、时间、错误详情
6. 提供**排查建议**和**刷新**按钮

**访问路径**：`/diagnostics`（无需登录）

---

## 四、为什么有 168 个报错

### 4.1 可能来源

| 来源 | 说明 |
|------|------|
| **supabase/functions（Deno）** | Edge Functions 使用 Deno，通过 URL 导入（如 `https://deno.land/std@0.168.0/http/server.ts`）。IDE 的 TypeScript 按 Node 解析，会报大量 `Cannot find module` 或类似错误。 |
| **ESLint 配置不完整** | `package.json` 中 `lint` 脚本使用 `eslint`，但 `devDependencies` 未包含 `eslint`、`@typescript-eslint/parser`、`@typescript-eslint/eslint-plugin` 等，可能导致 lint 报错或无法正确运行。 |
| **MagicLinkDiagnostics 类型** | 使用 `React.CSSProperties` 但未 `import React`，在严格模式下可能报类型错误。 |
| **IDE 工作区范围** | 若工作区包含 `supabase/functions`，Deno 与 Node 混用会放大报错数量。 |

### 4.2 建议排查步骤

1. 在 IDE Problems 面板中查看报错具体文件和内容。
2. 执行 `npm run build`，确认前端是否能正常构建。
3. 若报错集中在 `supabase/functions/`：
   - 在 VS Code 中为 `supabase/functions` 配置 Deno 扩展，或
   - 在 `supabase/functions` 下添加 `deno.json`，或
   - 在 `tsconfig.json` 中排除 `supabase/functions`，避免 Node 解析 Deno 代码。
4. 若报错在 `src/`：检查 `MagicLinkDiagnostics.tsx` 是否需补充 `import React` 或改用 `import type { CSSProperties } from 'react'`。
5. 在 `package.json` 的 `devDependencies` 中补充 ESLint 相关依赖，再执行 `npm run lint`。

---

## 五、相关文件清单

| 文件 | 状态 |
|------|------|
| `src/App.tsx` | 已修改 |
| `src/Pages/MagicLinkDiagnostics.tsx` | 新建 |
| `src/Pages/CustomerRegister.tsx` | 已修改 |
| `supabase/functions/auth-magic-link-diagnostics/index.ts` | 新建 |
| `MAGIC_LINK_STATUS.md` | 项目整体状态文档 |
| `STATUS.md` | 本文件，本轮修改总结 |
