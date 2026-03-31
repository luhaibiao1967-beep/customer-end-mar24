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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('theme', mode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', mode === 'dark' ? '#0d1b2a' : '#7ec8d4');
    }
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
