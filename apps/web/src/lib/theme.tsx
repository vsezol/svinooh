import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type Theme = 'dark' | 'light';
const KEY = 'svinooh_theme';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState>({ theme: 'dark', toggle: () => {} });

/**
 * On the server there is no storage and no visitor — the HTML is rendered dark
 * and the inline script in it applies the saved theme before the first paint,
 * so nothing flashes and nothing shifts. Here we read what that script decided,
 * which is also what makes the client's first render match the server's.
 */
function initial(): Theme {
  try {
    if (document.documentElement.dataset.theme === 'light') return 'light';
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);

  useEffect(() => {
    // Both elements: <html> paints the area body doesn't cover (overscroll, and
    // any gap below a short page), and it resolves --bg from its own scope — so
    // a light override that only lands on <body> leaves the page edges dark.
    document.body.dataset.theme = theme;
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* no storage — the theme still applies, it just won't be remembered */
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
