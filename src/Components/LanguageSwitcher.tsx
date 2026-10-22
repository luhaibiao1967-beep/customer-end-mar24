// src/Components/LanguageSwitcher.tsx
import React from 'react';
import { type Language, useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';

interface LanguageSwitcherProps {
  variant?: 'header' | 'inline';
}

const LANGUAGE_OPTIONS: Array<{ code: Language; shortLabel: string; nameKey: string }> = [
  { code: 'id', shortLabel: 'ID', nameKey: 'lang.indonesian' },
  { code: 'en', shortLabel: 'EN', nameKey: 'lang.english' },
  { code: 'zh', shortLabel: '中文', nameKey: 'lang.chinese' },
];

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'header' }) => {
  const { language, setLanguage, t } = useLanguage();
  const { tokens, isDark } = useColorTokens();

  if (variant === 'inline') {
    return (
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}>
        {LANGUAGE_OPTIONS.map((option) => {
          const active = language === option.code;
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => setLanguage(option.code)}
              aria-pressed={active}
              aria-label={t(option.nameKey)}
              title={t(option.nameKey)}
              style={{
                minWidth: option.code === 'zh' ? '58px' : '44px',
                padding: '8px 12px',
                background: active ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.2)',
                color: 'white',
                border: active ? 'none' : '2px solid white',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: active ? 'bold' : 'normal',
                cursor: 'pointer',
                transition: 'all 0.3s',
              }}
            >
              {option.shortLabel}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '2px',
      background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      padding: '3px',
      borderRadius: '8px',
      maxWidth: '100%',
    }}>
      {LANGUAGE_OPTIONS.map((option) => {
        const active = language === option.code;
        return (
          <button
            key={option.code}
            type="button"
            onClick={() => setLanguage(option.code)}
            aria-pressed={active}
            aria-label={t(option.nameKey)}
            title={t(option.nameKey)}
            style={{
              minWidth: option.code === 'zh' ? '42px' : '32px',
              padding: '3px 7px',
              background: active ? tokens.card : 'transparent',
              color: active ? tokens.primary : tokens.muted,
              border: 'none',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: active ? 700 : 400,
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: active ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            {option.shortLabel}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
