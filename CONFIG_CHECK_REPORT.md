# 配置检查报告

生成时间：检查本地配置

---

## 1. 前端连接目标（实际生效）

| 参数 | 来源 | 值 |
|------|------|-----|
| **VITE_SUPABASE_MODE** | .env | `production` |
| **VITE_SUPABASE_URL_CLOUD** | .env | `https://jzdnvdebwmuebjbergsp.supabase.co` |
| **VITE_SUPABASE_ANON_KEY_CLOUD** | .env | `eyJ...` (ref: **jzdnvdebwmuebjbergsp**) |

**结论：** 前端（npm run dev）实际连接的是 **水店项目 jzdnvdebwmuebjbergsp** ✅

---

## 2. Supabase CLI 链接的项目

| 文件 | 内容 |
|------|------|
| `supabase/.temp/project-ref` | **zpxdxyjzseuvdhxbuqpc** |
| `supabase/.temp/pooler-url` | `postgresql://postgres.zpxdxyjzseuvdhxbuqpc@...` |

**结论：** `supabase link` 当前指向 **旧项目 zpxdxyjzseuvdhxbuqpc** ⚠️

**影响：** 执行 `supabase functions deploy` 时，Edge Functions 会部署到 **旧项目**，而不是水店项目。

---

## 3. 代码中的默认值（.env 缺失时的 fallback）

| 文件 | 默认 URL | 默认项目 |
|------|----------|----------|
| `src/supabaseClient.ts` | `zpxdxyjzseuvdhxbuqpc` | 旧项目 |
| `scripts/run-diagnostics.js` | `zpxdxyjzseuvdhxbuqpc` | 旧项目 |
| `test-auth.js` | `zpxdxyjzseuvdhxbuqpc` | 旧项目 |

**结论：** 若 .env 未加载，会回退到旧项目。

---

## 4. 项目对照表

| 项目 ref | 用途 |
|----------|------|
| **jzdnvdebwmuebjbergsp** | 水店（合并后统一数据库） |
| **zpxdxyjzseuvdhxbuqpc** | 旧客户端项目 |

---

## 5. 问题诊断：auth_otps 为空

**可能原因：**

1. **Edge Functions 部署目标错误**
   - `supabase link` 指向旧项目
   - `supabase functions deploy` 会部署到旧项目
   - 前端调用的是水店项目 (jzdnvdebwmuebjbergsp)
   - 若水店项目未部署这些 functions，请求会 404
   - 若能登录成功，说明水店项目上已有 functions（可能由水店团队部署）

2. **数据写入位置**
   - 若 functions 部署在旧项目：auth_otps 会写入 **旧项目**
   - 若 functions 部署在水店项目：auth_otps 会写入 **水店项目**
   - 你在水店项目查 auth_otps 为空 → 可能 functions 实际跑在旧项目

3. **客户数据来源**
   - 能登录说明 customers 表有记录
   - 若 customers 在水店、auth_otps 在水店为空，但 OTP 验证成功 → 可能是 Fazpass 直接验证，未依赖 auth_otps
   - 或 customers 在旧项目，前端实际连的是旧项目（需确认 .env 是否被 Vite 正确加载）

---

## 6. 建议操作

### 步骤 1：将 Supabase CLI 链接到水店项目

```powershell
cd "e:\cursur customer end vividaqua\water-depot-customer-end-dev-Jan-31"
supabase link --project-ref jzdnvdebwmuebjbergsp
```

### 步骤 2：重新部署 Edge Functions 到水店项目

```powershell
supabase functions deploy auth-send-otp
supabase functions deploy auth-verify-otp
supabase functions deploy auth-check-device-login
supabase functions deploy auth-validate-token
```

### 步骤 3：确认 Vite 加载了 .env

运行 `npm run dev` 时，Vite 会加载项目根目录的 `.env`。可在 `src/supabaseClient.ts` 临时加一行调试：

```ts
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL_CLOUD || 'using fallback');
```

打开浏览器 Console，应看到水店 URL。

### 步骤 4：更新 supabaseClient 默认值为水店

将 `supabaseClient.ts` 中的 fallback 改为水店项目，避免 .env 缺失时连错库。

---

## 7. 检查清单

- [ ] 确认 .env 中 VITE_SUPABASE_URL_CLOUD 为水店
- [ ] 执行 supabase link --project-ref jzdnvdebwmuebjbergsp
- [ ] 重新部署所有 auth 相关 Edge Functions
- [ ] 在 Supabase Dashboard (jzdnvdebwmuebjbergsp) 检查 auth_otps、whatsapp_messages、customers
- [ ] 用新号码测试注册，确认 auth_otps 有水店项目记录
