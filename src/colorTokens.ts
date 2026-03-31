// src/colorTokens.ts

export interface ColorTokens {
  pageBg: string;
  card: string;
  cardBorder: string;
  cardBlur: string;
  text: string;
  muted: string;
  divider: string;
  primary: string;
  primaryBg: string;
  primaryBorder: string;
  navBg: string;
  navBorder: string;
  inputBg: string;
  gradientPrimary: string;
  /** Voucher / order page top bar — bright cyan in both themes */
  topBarGradient: string;
  gradientSuccess: string;
  cardShadow: string;
}

export const lightTokens: ColorTokens = {
  /** Full-page fill; global #bg-layer is cyan gradient in light mode */
  pageBg: 'transparent',
  card: 'rgba(255,255,255,0.85)',
  // Cyan/teal outline so panels read clearly on busy backgrounds
  cardBorder: 'rgba(0, 150, 165, 0.55)',
  cardBlur: 'blur(6px)',
  text: '#191c1d',
  muted: '#52747a',
  divider: 'rgba(0,105,113,0.06)',
  primary: '#006971',
  primaryBg: 'rgba(0,168,181,0.12)',
  primaryBorder: 'rgba(0,168,181,0.45)',
  navBg: 'rgba(255,255,255,0.75)',
  navBorder: 'rgba(0, 150, 165, 0.4)',
  inputBg: '#f2f4f5',
  gradientPrimary: 'linear-gradient(135deg, #00A8B5, #0284C7)',
  topBarGradient: 'linear-gradient(135deg, #00A8B5, #0284C7)',
  gradientSuccess: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
  cardShadow: '0px 12px 32px rgba(0,105,113,0.12)',
};

export const darkTokens: ColorTokens = {
  pageBg: '#0d1b2a',
  card: 'rgba(22, 34, 50, 0.95)',
  cardBorder: 'rgba(56, 212, 233, 0.42)',
  cardBlur: 'none',
  text: 'rgba(255,255,255,0.92)',
  muted: 'rgba(255,255,255,0.45)',
  divider: 'rgba(255,255,255,0.07)',
  primary: '#00b4d8',
  primaryBg: 'rgba(0,180,216,0.12)',
  primaryBorder: 'rgba(56, 212, 233, 0.45)',
  navBg: 'rgba(14, 20, 28, 0.92)',
  navBorder: 'rgba(56, 212, 233, 0.35)',
  inputBg: 'rgba(255,255,255,0.06)',
  gradientPrimary: 'linear-gradient(135deg, #0a3d62 0%, #0c2461 100%)',
  topBarGradient: 'linear-gradient(135deg, #0891b2, #06b6d4)',
  gradientSuccess: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
  cardShadow: 'none',
};
