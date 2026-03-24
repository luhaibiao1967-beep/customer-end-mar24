# Dual Theme (Light / Dark) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ColorTokensContext` that provides switchable light/dark color tokens to every page, with the preference persisted in `localStorage` and a toggle in MyAccount Settings.

**Architecture:** A single `ColorTokensContext` exports `tokens` (the active color object) and `toggleTheme()`. Pages replace their local `C`/`COLOR` constants with a `useColorTokens()` hook call. `OrderDelivery.css` is handled via a `data-theme` attribute on `<html>` and CSS variable overrides.

**Tech Stack:** React 19, TypeScript, Vite, inline styles + one CSS file (OrderDelivery.css)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/colorTokens.ts` | `ColorTokens` interface + `lightTokens` + `darkTokens` objects |
| Create | `src/contexts/ColorTokensContext.tsx` | Provider, `useColorTokens()` hook, localStorage + `data-theme` sync |
| Modify | `src/App.tsx` | Wrap tree with `<ColorTokensProvider>` |
| Modify | `src/Pages/OrderDelivery.css` | Replace hardcoded teal/purple with CSS variables |
| Modify | `src/Components/TopNavV0.tsx` | Use `useColorTokens()` |
| Modify | `src/Components/BottomNavV0.tsx` | Use `useColorTokens()` |
| Modify | `src/Components/LanguageSwitcher.tsx` | Use `useColorTokens()` |
| Modify | `src/Pages/CustomerHome.tsx` | Replace local `C` with `useColorTokens()` |
| Modify | `src/Pages/MyAccount.tsx` | Replace local `COLOR` + add theme toggle row in Settings |
| Modify | `src/Pages/OrderHistory.tsx` | Replace `theme.gradientPrimary` / `white` with tokens |
| Modify | `src/Pages/PlaceOrder.tsx` | Same as OrderHistory |
| Modify | `src/Pages/BuyVouchers.tsx` | Same as OrderHistory |
| Modify | `src/Pages/CustomerLogin.tsx` | Same as OrderHistory |
| Modify | `src/Pages/BranchSelection.tsx` | Same as OrderHistory |

---

## Task 1: Create color token definitions

**File:** `src/colorTokens.ts`

- [ ] **Create `src/colorTokens.ts`** with the following content:

```typescript
// src/colorTokens.ts

export interface ColorTokens {
  // Page background (can be a gradient string)
  pageBg: string;
  // Cards
  card: string;
  cardBorder: string;
  // Text
  text: string;
  muted: string;
  divider: string;
  // Brand accent
  primary: string;
  primaryBg: string;
  primaryBorder: string;
  // Navigation bars
  navBg: string;
  navBorder: string;
  // Input fields
  inputBg: string;
  // Gradients used as button backgrounds
  gradientPrimary: string;
  gradientSuccess: string;
}

export const lightTokens: ColorTokens = {
  pageBg: 'linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%)',
  card: '#ffffff',
  cardBorder: 'rgba(0,0,0,0.08)',
  text: '#333333',
  muted: '#666666',
  divider: 'rgba(0,0,0,0.07)',
  primary: '#4DCCCC',
  primaryBg: 'rgba(77,204,204,0.12)',
  primaryBorder: 'rgba(77,204,204,0.35)',
  navBg: 'rgba(255,255,255,0.92)',
  navBorder: 'rgba(0,0,0,0.07)',
  inputBg: '#f5f5f5',
  gradientPrimary: 'linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%)',
  gradientSuccess: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
};

export const darkTokens: ColorTokens = {
  pageBg: '#0d1b2a',
  card: 'rgba(22, 34, 50, 0.95)',
  cardBorder: 'rgba(255,255,255,0.08)',
  text: 'rgba(255,255,255,0.92)',
  muted: 'rgba(255,255,255,0.45)',
  divider: 'rgba(255,255,255,0.07)',
  primary: '#00b4d8',
  primaryBg: 'rgba(0,180,216,0.12)',
  primaryBorder: 'rgba(0,180,216,0.25)',
  navBg: 'rgba(14, 20, 28, 0.92)',
  navBorder: 'rgba(255,255,255,0.07)',
  inputBg: 'rgba(255,255,255,0.06)',
  gradientPrimary: 'linear-gradient(135deg, #0a3d62 0%, #0c2461 100%)',
  gradientSuccess: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
};
```

---

## Task 2: Create ColorTokensContext

**File:** `src/contexts/ColorTokensContext.tsx`

- [ ] **Create `src/contexts/ColorTokensContext.tsx`**:

```typescript
// src/contexts/ColorTokensContext.tsx
import React, { createContext, useContext, useState, useEffect } from 'react';
import { ColorTokens, lightTokens, darkTokens } from '../colorTokens';

type ThemeMode = 'light' | 'dark';

interface ColorTokensContextValue {
  tokens: ColorTokens;
  isDark: boolean;
  toggleTheme: () => void;
}

const ColorTokensContext = createContext<ColorTokensContextValue>({
  tokens: lightTokens,
  isDark: false,
  toggleTheme: () => {},
});

export function ColorTokensProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem('theme') as ThemeMode) || 'light';
  });

  // Sync data-theme attribute on <html> (used by OrderDelivery.css)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('theme', mode);
  }, [mode]);

  const toggleTheme = () => setMode(prev => prev === 'light' ? 'dark' : 'light');

  return (
    <ColorTokensContext.Provider value={{
      tokens: mode === 'dark' ? darkTokens : lightTokens,
      isDark: mode === 'dark',
      toggleTheme,
    }}>
      {children}
    </ColorTokensContext.Provider>
  );
}

export function useColorTokens() {
  return useContext(ColorTokensContext);
}
```

---

## Task 3: Wrap App + update OrderDelivery.css

### 3a — App.tsx

**File:** `src/App.tsx`

- [ ] Add import at top of file (after LanguageProvider import):

```typescript
import { ColorTokensProvider } from './contexts/ColorTokensContext';
```

- [ ] Wrap `<LanguageProvider>` with `<ColorTokensProvider>` (ColorTokensProvider goes **outside** LanguageProvider so it's available everywhere):

```tsx
return (
  <ColorTokensProvider>
    <LanguageProvider>
      {/* ... rest unchanged ... */}
    </LanguageProvider>
  </ColorTokensProvider>
);
```

### 3b — OrderDelivery.css

**File:** `src/Pages/OrderDelivery.css`

- [ ] Add CSS variable declarations at the top of the file (before `.order-delivery-page`):

```css
/* Light theme variables (default) */
:root {
  --od-page-bg: linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%);
  --od-accent: #4DCCCC;
  --od-accent-gradient: linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%);
  --od-accent-shadow: rgba(77, 204, 204, 0.4);
  --od-spinner: #4DCCCC;
  --od-active-label: #4DCCCC;
  --od-total-amount: #008B8B;
}

/* Dark theme overrides */
[data-theme="dark"] {
  --od-page-bg: #0d1b2a;
  --od-accent: #00b4d8;
  --od-accent-gradient: linear-gradient(135deg, #00b4d8 0%, #0077b6 100%);
  --od-accent-shadow: rgba(0, 180, 216, 0.4);
  --od-spinner: #00b4d8;
  --od-active-label: #00b4d8;
  --od-total-amount: #00b4d8;
}
```

- [ ] Replace hardcoded colors throughout the file with the variables:

```css
/* Replace these: */
.order-delivery-page { background: linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%); }
/* With: */
.order-delivery-page { background: var(--od-page-bg); }

/* Replace: */
.progress-step.active .step-icon { background: linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%); }
/* With: */
.progress-step.active .step-icon { background: var(--od-accent-gradient); }

/* Replace: */
.progress-step.active .step-label { color: #4DCCCC; }
/* With: */
.progress-step.active .step-label { color: var(--od-active-label); }

/* Replace: */
.progress-line.active { background: linear-gradient(90deg, #4DCCCC 0%, #008B8B 100%); }
/* With: */
.progress-line.active { background: var(--od-accent-gradient); }

/* Replace: */
.total-amount { color: #008B8B; }
/* With: */
.total-amount { color: var(--od-total-amount); }

/* Replace: */
.btn-confirm-simple { background: linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%); }
/* With: */
.btn-confirm-simple { background: var(--od-accent-gradient); }

/* Replace: */
.btn-confirm-simple:hover:not(:disabled) { box-shadow: 0 8px 20px rgba(77, 204, 204, 0.4); }
/* With: */
.btn-confirm-simple:hover:not(:disabled) { box-shadow: 0 8px 20px var(--od-accent-shadow); }

/* Replace: */
.btn-primary { background: linear-gradient(135deg, #4DCCCC 0%, #008B8B 100%); }
/* With: */
.btn-primary { background: var(--od-accent-gradient); }

/* Replace: */
.spinner { border-top-color: #4DCCCC; }
/* With: */
.spinner { border-top-color: var(--od-spinner); }
```

---

## Task 4: Update shared navigation components

### 4a — TopNavV0.tsx

**File:** `src/Components/TopNavV0.tsx`

- [ ] Add import:
```typescript
import { useColorTokens } from '../contexts/ColorTokensContext';
```

- [ ] Inside the component, add:
```typescript
const { tokens } = useColorTokens();
```

- [ ] Replace hardcoded nav styles:
```tsx
// background: 'rgba(255,255,255,0.92)' → tokens.navBg
// borderBottom: '1px solid rgba(0,0,0,0.07)' → `1px solid ${tokens.navBorder}`
// color: '#008B8B' (brand name) → tokens.primary
// background: 'rgba(77,204,204,0.12)' (user button) → tokens.primaryBg
// border: '1px solid rgba(77,204,204,0.3)' → `1px solid ${tokens.primaryBorder}`
// color: '#008B8B' (user button text) → tokens.primary
```

### 4b — BottomNavV0.tsx

**File:** `src/Components/BottomNavV0.tsx`

- [ ] Add import:
```typescript
import { useColorTokens } from '../contexts/ColorTokensContext';
```

- [ ] Inside the component, add:
```typescript
const { tokens } = useColorTokens();
```

- [ ] Replace hardcoded nav styles:
```tsx
// background: 'rgba(255,255,255,0.92)' → tokens.navBg
// borderTop: '1px solid rgba(0,0,0,0.07)' → `1px solid ${tokens.navBorder}`
// active circle bg: 'rgba(77,204,204,0.15)' → tokens.primaryBg
// active icon/label color: '#4DCCCC' → tokens.primary
// inactive icon/label color: '#aaaaaa' → tokens.muted
```

### 4c — LanguageSwitcher.tsx

**File:** `src/Components/LanguageSwitcher.tsx`

- [ ] Add import:
```typescript
import { useColorTokens } from '../contexts/ColorTokensContext';
```

- [ ] Inside the component (header variant), add:
```typescript
const { tokens } = useColorTokens();
```

- [ ] Replace colors in header variant:
```tsx
// container background: 'rgba(0,0,0,0.06)' → tokens.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
// active button background: 'white' → tokens.card
// active button color: '#008B8B' → tokens.primary
// inactive button color: '#999' → tokens.muted
```

Note: `useColorTokens` requires the component to be inside `ColorTokensProvider`. Since `LanguageSwitcher` is inside `TopNavV0` which is inside the provider, this is fine.

---

## Task 5: Update CustomerHome.tsx

**File:** `src/Pages/CustomerHome.tsx`

- [ ] Add import:
```typescript
import { useColorTokens } from '../contexts/ColorTokensContext';
```

- [ ] Remove the local `C` constant object (lines ~84–94)

- [ ] Inside the component, replace with:
```typescript
const { tokens: C, isDark } = useColorTokens();
```

Note: naming the tokens `C` means no other variable references in JSX need to change.

- [ ] Fix dark-mode-specific overrides (things that can't be expressed with tokens alone):

**Promo slideshow container** — currently hardcoded glass effect for light mode. Make it conditional:
```tsx
background: isDark
  ? 'linear-gradient(170deg, #020f28 0%, #031739 52%, #062451 100%)'
  : 'rgba(255,255,255,0.18)',
border: isDark ? 'none' : '1px solid rgba(255,255,255,0.35)',
backdropFilter: isDark ? 'none' : 'blur(8px)',
```

**QR code** — dark mode: transparent bg + white fg; light mode: #f5f5f5 bg + #333 fg:
```tsx
bgColor={isDark ? 'transparent' : '#f5f5f5'}
fgColor={isDark ? 'white' : '#333333'}
```

**QR code wrapper background**:
```tsx
background: isDark ? 'rgba(255,255,255,0.06)' : '#f5f5f5'
```

**Avatar ring** (if present) and other `isDark`-specific tweaks as encountered.

**Dot indicators** in slideshow — currently always white. Keep as white (visible on both dark and light promo container backgrounds).

---

## Task 6: Update MyAccount.tsx (+ add theme toggle)

**File:** `src/Pages/MyAccount.tsx`

- [ ] Add import:
```typescript
import { useColorTokens } from '../contexts/ColorTokensContext';
```

- [ ] Remove the local `COLOR` constant object (lines ~42–54)

- [ ] Inside the component body, add:
```typescript
const { tokens: COLOR, isDark, toggleTheme } = useColorTokens();
```

- [ ] Update `iconBox`, `menuRow`, `card`, `sectionLabel` — these are module-level constants that reference `COLOR`. Move them **inside the component** (after the `COLOR` assignment):
```typescript
const iconBox: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: COLOR.primaryBg,
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};
const menuRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '14px 16px', background: 'none', border: 'none',
  width: '100%', cursor: 'pointer', textAlign: 'left',
};
const card: React.CSSProperties = {
  background: COLOR.card,
  border: `1px solid ${COLOR.cardBorder}`,
  borderRadius: 16, overflow: 'hidden',
};
const sectionLabel: React.CSSProperties = {
  fontSize: 11, color: COLOR.muted,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  marginBottom: 8, paddingLeft: 4,
};
```

- [ ] Fix dark-mode-specific values:

**Avatar ring** — dark uses dark bg as ring color, light uses white:
```tsx
boxShadow: `0 0 0 4px ${isDark ? '#0d1b2a' : 'white'}, 0 4px 20px ${COLOR.primaryBg}`
```

**Glow blobs** — only show in dark mode:
```tsx
{isDark && (
  <>
    <div style={{ position:'absolute', top:0, left:0, right:0, height:160,
      background:'linear-gradient(135deg,rgba(0,180,216,0.15) 0%,transparent 60%)',
      pointerEvents:'none' }} />
    {/* ... other blobs ... */}
  </>
)}
```

**Logout button** (top-right circle):
```tsx
background: isDark ? 'rgba(30,40,55,0.7)' : 'rgba(255,255,255,0.7)'
```

**Input field**:
```tsx
background: COLOR.inputBg
```

- [ ] Add theme toggle row in the **Settings** card, above "Delivery Address":

```tsx
{/* Theme Toggle */}
<div style={{ borderBottom: `1px solid ${COLOR.divider}` }}>
  <div style={{ ...menuRow, cursor: 'default' }}>
    <div style={iconBox}>
      {isDark ? <Moon size={18} color={COLOR.primary} /> : <Sun size={18} color={COLOR.primary} />}
    </div>
    <span style={{ flex: 1, color: COLOR.text, fontWeight: 500, fontSize: 15 }}>
      {isDark ? 'Dark Mode' : 'Light Mode'}
    </span>
    {/* Toggle switch */}
    <button
      onClick={toggleTheme}
      style={{
        width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
        background: isDark ? COLOR.primary : 'rgba(0,0,0,0.15)',
        position: 'relative', transition: 'background 0.25s',
      }}
    >
      <span style={{
        position: 'absolute', top: 3,
        left: isDark ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%',
        background: 'white',
        transition: 'left 0.25s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
      }} />
    </button>
  </div>
</div>
```

- [ ] Add `Moon` and `Sun` to the lucide-react import line.

---

## Task 7: Update OrderHistory, PlaceOrder, BuyVouchers

These three pages all follow the same pattern: they import `theme` from `../theme` and use `theme.gradientPrimary` as page background, `white` for cards, `theme.text` / `theme.textMuted` for text.

For each file:

- [ ] Add import:
```typescript
import { useColorTokens } from '../contexts/ColorTokensContext';
```

- [ ] Inside the component, add:
```typescript
const { tokens } = useColorTokens();
```

- [ ] Replace occurrences:

| Was | Becomes |
|-----|---------|
| `background: theme.gradientPrimary` (page wrapper) | `background: tokens.pageBg` |
| `background: 'white'` (cards) | `background: tokens.card` |
| `boxShadow: '0 4px 20px rgba(0,0,0,0.12)'` | keep as-is (works on both themes) |
| `color: theme.text` | `color: tokens.text` |
| `color: theme.textMuted` | `color: tokens.muted` |
| `background: theme.gradientPrimary` (buttons) | `background: tokens.gradientPrimary` |
| `background: theme.gradientSuccess` (pay button) | `background: tokens.gradientSuccess` |
| `color: theme.primary` | `color: tokens.primary` |
| `border: \`2px solid ${theme.primary}\`` | `border: \`2px solid ${tokens.primary}\`` |
| `background: rgba(255,255,255,0.2)` (back button on gradient bg) | keep as-is |

**OrderHistory-specific:** The summary banner `background: 'white'` → `tokens.card`. The bank transfer modal is white — keep as-is (always light modal is fine for a modal).

---

## Task 8: Update CustomerLogin + BranchSelection

### CustomerLogin.tsx

Same pattern as Task 7. Additional specifics:

- [ ] Page wrapper: `background: theme.gradientPrimary` → `tokens.pageBg`
- [ ] Card: `background: 'white'` → `tokens.card`
- [ ] Input label: `color: '#333'` → `tokens.text`
- [ ] Input border on focus: keep `theme.primary` → `tokens.primary`
- [ ] Header section inside card: `background: theme.gradientPrimary` → `tokens.gradientPrimary`
- [ ] Language button area: `background: '#f8f9fa'` → `tokens.inputBg`

### BranchSelection.tsx

- [ ] Page wrapper: `background: theme.gradientPrimary` → `tokens.pageBg`
- [ ] Unselected branch card: `background: 'rgba(255,255,255,0.15)'` — keep (glass effect on gradient bg, works on dark too)
- [ ] Selected branch card: `background: 'white'` → `tokens.card`
- [ ] Selected branch card border: `border: \`2px solid ${theme.primary}\`` → `tokens.primary`
- [ ] Section label text: `color: 'rgba(255,255,255,0.7)'` — keep (these are on top of the gradient bg)
- [ ] Branch name selected: `color: theme.primary` → `tokens.primary`
- [ ] Branch address selected: `color: '#555'` → `tokens.text`

---

## Commit Strategy

After each task, commit:
```bash
git add <changed files>
git commit -m "feat(theme): <what was done>"
```

Suggested commits:
1. `feat(theme): add color tokens and ColorTokensContext`
2. `feat(theme): wrap app with ColorTokensProvider, add CSS vars to OrderDelivery.css`
3. `feat(theme): update nav components to use color tokens`
4. `feat(theme): update CustomerHome to use color tokens`
5. `feat(theme): update MyAccount with color tokens and theme toggle`
6. `feat(theme): update OrderHistory, PlaceOrder, BuyVouchers`
7. `feat(theme): update CustomerLogin and BranchSelection`
