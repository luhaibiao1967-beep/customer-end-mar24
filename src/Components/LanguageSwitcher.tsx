// src/Components/LanguageSwitcher.tsx
import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

interface LanguageSwitcherProps {
  variant?: 'header' | 'inline';
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ variant = 'header' }) => {
  const { language, setLanguage } = useLanguage();

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
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: 1001,
      display: 'flex',
      gap: '8px',
      background: 'rgba(255,255,255,0.95)',
      padding: '8px',
      borderRadius: '12px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      backdropFilter: 'blur(10px)',
    }}>
      <button
        onClick={() => setLanguage('id')}
        style={{
          padding: '8px 16px',
          background: language === 'id' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
          color: language === 'id' ? 'white' : '#666',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: language === 'id' ? 'bold' : 'normal',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        🇮🇩 ID
      </button>
      <button
        onClick={() => setLanguage('en')}
        style={{
          padding: '8px 16px',
          background: language === 'en' ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'transparent',
          color: language === 'en' ? 'white' : '#666',
          border: 'none',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: language === 'en' ? 'bold' : 'normal',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
      >
        🇬🇧 EN
      </button>
    </div>
  );
};

export default LanguageSwitcher;
