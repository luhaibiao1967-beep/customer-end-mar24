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
  gradientSuccess: string;
  cardShadow: string;
}

export const lightTokens: ColorTokens = {
  pageBg: 'transparent',
  card: 'rgba(255,255,255,0.85)',
  cardBorder: 'rgba(255,255,255,0.30)',
  cardBlur: 'blur(6px)',
  text: '#191c1d',
  muted: '#52747a',
  divider: 'rgba(0,105,113,0.06)',
  primary: '#006971',
  primaryBg: 'rgba(0,168,181,0.12)',
  primaryBorder: 'rgba(0,168,181,0.35)',
  navBg: 'rgba(255,255,255,0.75)',
  navBorder: 'rgba(255,255,255,0.30)',
  inputBg: '#f2f4f5',
  gradientPrimary: 'linear-gradient(135deg, #00A8B5, #0284C7)',
  gradientSuccess: 'linear-gradient(135deg, #28a745 0%, #20c997 100%)',
  cardShadow: '0px 12px 32px rgba(0,105,113,0.12)',
};

export const darkTokens: ColorTokens = {
  pageBg: '#0d1b2a',
  card: 'rgba(22, 34, 50, 0.95)',
  cardBorder: 'rgba(255,255,255,0.08)',
  cardBlur: 'none',
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
  cardShadow: 'none',
};
