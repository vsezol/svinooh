import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'dark' | 'light';
const KEY = 'svinooh_theme';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState>({ theme: 'dark', toggle: () => {} });

function initial(): Theme {
  const saved = localStorage.getItem(KEY);
  return saved === 'light' ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    // Both elements: <html> paints the area body doesn't cover (overscroll, and
    // any gap below a short page), and it resolves --bg from its own scope — so
    // a light override that only lands on <body> leaves the page edges dark.
    document.body.dataset.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
