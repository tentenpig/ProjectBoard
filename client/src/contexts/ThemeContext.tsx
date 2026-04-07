import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type ThemeName = 'ivory' | 'excel' | 'redmine';

interface ThemeContextType {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
  themes: { id: ThemeName; label: string }[];
}

const ThemeContext = createContext<ThemeContextType>(null!);

export function useTheme() {
  return useContext(ThemeContext);
}

const themes: { id: ThemeName; label: string }[] = [
  { id: 'ivory', label: '기본' },
  { id: 'excel', label: 'Excel' },
  { id: 'redmine', label: 'Redmine' },
];

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    return (localStorage.getItem('theme') as ThemeName) || 'ivory';
  });

  const setTheme = (t: ThemeName) => {
    localStorage.setItem('theme', t);
    setThemeState(t);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes }}>
      {children}
    </ThemeContext.Provider>
  );
}
