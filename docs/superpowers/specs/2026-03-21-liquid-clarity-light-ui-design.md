# Liquid Clarity Light UI — Design Spec
Date: 2026-03-21
Status: Approved

## Overview

Apply the "Liquid Clarity" design system (from `DESIGN.md`) to the VividAqua customer app's **light mode only**. The approach is token-first: update `lightTokens` in `colorTokens.ts` so all pages that consume `useColorTokens()` inherit the new palette automatically. Dark mode is untouched.

Because `pageBg` changes from a dark teal gradient to flat `#F8FAFC`, several pages have **hardcoded white text** that was designed against the old dark background — these become invisible and must be fixed. All such fixes are included in scope.

---

## Scope

- `src/colorTokens.ts` — update `lightTokens` values (15 fields)
- `index.html` — add Plus Jakarta Sans + Manrope via Google Fonts
- `src/Pages/BuyVouchers.tsx` — fix 4 hardcoded white elements
- `src/Pages/PlaceOrder.tsx` — fix 2 hardcoded white elements (back button + h1)
- `src/Pages/OrderHistory.tsx` — fix 2 hardcoded white elements (back button + h1)
- `src/Pages/OrderDelivery.tsx` — fix 2 hardcoded white elements (back button + h1)
- `src/Pages/BranchSelection.tsx` — fix 3 hardcoded white elements (loading state, back button, h1)

Dark mode (`darkTokens`) is **not modified**. No layout, spacing, or logic changes.

---

## 1. colorTokens.ts — lightTokens

| Field | Old Value | New Value | Reason |
|-------|-----------|-----------|--------|
| `pageBg` | multi-stop teal radial gradient | `'#F8FAFC'` | Flat slate-50 background per spec |
| `card` | `rgba(255,255,255,0.68)` | `'#ffffff'` | Pure white card per spec |
| `cardBorder` | `rgba(255,255,255,0.55)` | `'rgba(0,105,113,0.08)'` | Ghost border fallback at 8% brand opacity |
| `cardBlur` | `blur(16px)` | `'none'` | Glassmorphism reserved for nav/modals only |
| `text` | `#1a2e2e` | `'#191c1d'` | Spec `on_surface` token |
| `muted` | `#4a6868` | `'#52747a'` | Brand-tinted muted grey |
| `divider` | `rgba(0,0,0,0.07)` | `'rgba(0,105,113,0.06)'` | Brand-tinted near-invisible divider |
| `primary` | `#008B8B` | `'#006971'` | Spec "Lake Green" active color |
| `primaryBg` | `rgba(77,204,204,0.15)` | `'rgba(0,168,181,0.10)'` | Matches new primary |
| `primaryBorder` | `rgba(77,204,204,0.4)` | `'rgba(0,168,181,0.30)'` | Matches new primary |
| `navBg` | `rgba(255,255,255,0.78)` | `'rgba(255,255,255,0.92)'` | Cleaner nav with heavier blur |
| `navBorder` | `rgba(255,255,255,0.5)` | `'transparent'` | No-Line rule: no visible borders |
| `inputBg` | `rgba(255,255,255,0.5)` | `'#f2f4f5'` | Spec `surface_container_low` |
| `gradientPrimary` | `linear-gradient(135deg, #4DCCCC, #008B8B)` | `'linear-gradient(135deg, #00A8B5, #0284C7)'` | Spec Signature Gradient |
| `gradientSuccess` | `linear-gradient(135deg, #28a745 0%, #20c997 100%)` | unchanged | No change needed |

---

## 2. index.html — Typography

Add inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800;900&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  body { font-family: 'Manrope', sans-serif; }
  h1, h2, h3, h4, h5, h6 { font-family: 'Plus Jakarta Sans', sans-serif; }
</style>
```

---

## 3. Hardcoded White Fixes (all pages)

All fixes follow the same pattern: replace white-on-dark-gradient elements with token-based colors for the light white background.

### BuyVouchers.tsx (4 fixes)

| Element | Old | New |
|---------|-----|-----|
| Page title h1 (line 291) | `color: 'white'` | `color: tokens.text` |
| Section labels "💧" / "🛍️" (lines 319, 400) | `color: 'rgba(255,255,255,0.7)'` | `color: tokens.muted` |
| Back button (line 290) | `bg: rgba(255,255,255,0.2)`, `color: 'white'`, `border: '2px solid white'` | `bg: tokens.primaryBg`, `color: tokens.primary`, `border: \`1px solid ${tokens.primaryBorder}\`` |
| Bottom info note (line 451) | `bg: rgba(255,255,255,0.15)`, `color: rgba(255,255,255,0.9)` | `bg: tokens.primaryBg`, `color: tokens.muted` |

### PlaceOrder.tsx (2 fixes)

| Element | Old | New |
|---------|-----|-----|
| Back button (line 512) | `bg: rgba(255,255,255,0.2)`, `color: 'white'`, `border: '2px solid white'` | `bg: tokens.primaryBg`, `color: tokens.primary`, `border: \`1px solid ${tokens.primaryBorder}\`` |
| Page title h1 (line 516) | `color: 'white'` | `color: tokens.text` |

### OrderHistory.tsx (2 fixes)

| Element | Old | New |
|---------|-----|-----|
| Back button (line 302) | `bg: rgba(255,255,255,0.2)`, `color: 'white'`, `border: '2px solid white'` | `bg: tokens.primaryBg`, `color: tokens.primary`, `border: \`1px solid ${tokens.primaryBorder}\`` |
| Page title h1 (line 305) | `color: 'white'` | `color: tokens.text` |

### OrderDelivery.tsx (2 fixes)

| Element | Old | New |
|---------|-----|-----|
| Back button (line 195) | `bg: rgba(255,255,255,0.2)`, `color: 'white'`, `border: '2px solid rgba(255,255,255,0.4)'` | `bg: tokens.primaryBg`, `color: tokens.primary`, `border: \`1px solid ${tokens.primaryBorder}\`` |
| Page title h1 (line 199) | `color: 'white'` | `color: tokens.text` |

### BranchSelection.tsx (3 fixes)

| Element | Old | New |
|---------|-----|-----|
| Loading state container (line 171) | `color: 'white'` on div | `color: tokens.text` |
| Loading spinner border (line 175) | `border: '4px solid rgba(255,255,255,0.3)'` | `border: \`4px solid ${tokens.primaryBorder}\`` |
| Back button (line 194–206) | `bg: rgba(255,255,255,0.2)`, `color: 'white'` | `bg: tokens.primaryBg`, `color: tokens.primary` |
| Page title h1 (line 211) | `color: 'white'` | `color: tokens.text` |

---

## Constraints

- Dark mode (`darkTokens`) is not modified.
- No page layout changes (grid, spacing, border-radius) are in scope.
- No new fields are added to the `ColorTokens` interface.
- Font loading via CDN requires internet access at runtime.
