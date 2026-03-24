// src/Components/LanguageSwitcher.tsx
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useColorTokens } from '../contexts/ColorTokensContext';

interface LanguageSwitcherProps {
  variant?: 'header' | 'inline';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'header' }) => {
  const { language, setLanguage } = useLanguage();
  const { tokens, isDark } = useColorTokens();

  if (variant === 'inline') {
    return (
      <div style={{
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
      }}>
        <button
          onClick={() => setLanguage('id')}
          style={{
            padding: '8px 16px',
            background: language === 'id' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.2)',
            color: 'white',
            border: language === 'id' ? 'none' : '2px solid white',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: language === 'id' ? 'bold' : 'normal',
            cursor: 'pointer',
            transition: 'all 0.3s',
          }}
        >
          ID
        </button>
        <button
          onClick={() => setLanguage('en')}
          style={{
            padding: '8px 16px',
            background: language === 'en' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.2)',
            color: 'white',
            border: language === 'en' ? 'none' : '2px solid white',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: language === 'en' ? 'bold' : 'normal',
            cursor: 'pointer',
            transition: 'all 0.3s',
          }}
        >
          EN
        </button>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      gap: '2px',
      background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
      padding: '3px',
      borderRadius: '8px',
    }}>
      <button
        onClick={() => setLanguage('id')}
        style={{
          padding: '3px 8px',
          background: language === 'id' ? tokens.card : 'transparent',
          color: language === 'id' ? tokens.primary : tokens.muted,
          border: 'none',
          borderRadius: '5px',
          fontSize: '11px',
          fontWeight: language === 'id' ? 700 : 400,
          cursor: 'pointer',
          transition: 'all 0.2s',
          boxShadow: language === 'id' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
        }}
      >
        ID
      </button>
      <button
        onClick={() => setLanguage('en')}
        style={{
          padding: '3px 8px',
          background: language === 'en' ? tokens.card : 'transparent',
          color: language === 'en' ? tokens.primary : tokens.muted,
          border: 'none',
          borderRadius: '5px',
          fontSize: '11px',
          fontWeight: language === 'en' ? 700 : 400,
          cursor: 'pointer',
          transition: 'all 0.2s',
          boxShadow: language === 'en' ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
        }}
      >
        EN
      </button>
    </div>
  );
};

export default LanguageSwitcher;
