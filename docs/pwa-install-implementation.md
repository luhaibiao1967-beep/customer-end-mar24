# PWA 退出后安装提示 — 实现说明

**已在仓库实现**（`src/utils/pwaInstall.ts`、`InstallAppModal`、`CustomerLogin` 挂载后读 session 标记、`CustomerHome` / `MyAccount` / `TopNavV0` 退出时写标记、`LanguageContext` 文案）。

以下为原始设计清单（备查）。

---

## 新建 `src/utils/pwaInstall.ts`

（内容与此前设计一致：`markLogoutForPwaPrompt`、`consumeLogoutPwaPromptFlag`、`canShowPwaInstallPrompt`、`dismissPwaPromptForDays`、`setPwaNeverPrompt`、`isIosSafari`、`isStandaloneDisplay` 等。）

---

## 新建 `src/Components/InstallAppModal.tsx`

- Props: `open`, `onClose`
- `useEffect` 注册 `beforeinstallprompt`（`preventDefault` + 存 deferred）、`appinstalled` 时 `markPwaInstalledByUser` 并关闭
- iOS：`isIosSafari()` 为真时显示两步文案（Share → Add to Home Screen）
- Android：有 deferred 时主按钮调用 `prompt()`；否则显示 `androidManual` 文案
- 按钮：安装（若有）、「以后再说」14 天、`setPwaNeverPrompt` 不再提示
- 样式用 `useColorTokens` + `theme`

---

## 修改 `src/Pages/CustomerLogin.tsx`

- `import InstallAppModal`, `canShowPwaInstallPrompt`, `consumeLogoutPwaPromptFlag`
- `const [pwaInstallOpen, setPwaInstallOpen] = useState(false)`
- `useEffect(() => { if (consumeLogoutPwaPromptFlag() && canShowPwaInstallPrompt()) setPwaInstallOpen(true) }, [])`
- JSX 根部旁渲染 `<InstallAppModal open={pwaInstallOpen} onClose={() => setPwaInstallOpen(false)} />`

---

## 修改 `src/Pages/CustomerHome.tsx`

- `import { markLogoutForPwaPrompt } from '../utils/pwaInstall'`
- 在 `handleSignOut` 内 **最先** 调用 `markLogoutForPwaPrompt()`，再 `removeItem` / `navigate`

---

## 修改 `src/Pages/MyAccount.tsx`

- 同上：`markLogoutForPwaPrompt` 在 `handleSignOut` 开头调用

---

## 修改 `src/Components/TopNavV0.tsx`

- `import { markLogoutForPwaPrompt } from '../utils/pwaInstall'`
- 在 `else` 分支：`sessionStorage.clear()` 后立刻 `markLogoutForPwaPrompt()`

---

## 修改 `src/contexts/LanguageContext.tsx`

英文 `en` 与印尼文 `id` 增加例如：

- `pwaInstall.title` / `body` / `installNow` / `later` / `never`
- `pwaInstall.iosStep1` / `iosStep2`
- `pwaInstall.androidManual`（无系统安装弹窗时用浏览器菜单说明）

---

## 可选后续

- `manifest.json` 的 `display` 改为 `standalone`
- `vite-plugin-pwa` 以提高 Android `beforeinstallprompt` 触发率

---

## 验证

- 手机退出登录 → 登录页出现弹窗 → 拒绝 / 14 天 / 永不
- 已安装 PWA（standalone）不再出现
- iOS 仅说明文案；Android 有 prompt 时可一键安装
