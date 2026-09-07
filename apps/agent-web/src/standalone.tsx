import { useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import type { MountOptions } from './app/types';
import { demoHistoryList, demoPortfolios, kitchenSink } from './demo/script';
import './styles/base.css';

const THEME_KEY = 'svinooh_theme';
const TOKEN_KEY = 'svinooh_token';

type Theme = 'dark' | 'light';

function readTheme(): Theme {
  // localStorage can throw in private mode / in-app browsers.
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Same convention as the main product: dark is the attribute-less default,
// light sets data-theme='light', and the key is shared so both surfaces agree
// on the choice. The attribute goes on BOTH html and body: the kit declares
// token values on `:root, body`, so body's own dark values would beat a
// light override inherited from html — body must match the light selector
// itself.
function applyTheme(theme: Theme): void {
  for (const node of [document.documentElement, document.body]) {
    if (theme === 'light') node.dataset.theme = 'light';
    else delete node.dataset.theme;
  }
}

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function isDemo(): boolean {
  return (
    new URLSearchParams(window.location.search).has('demo') ||
    /^\/demo(\/|$)/.test(window.location.pathname)
  );
}

function Standalone() {
  const demo = isDemo();
  const [theme, setTheme] = useState<Theme>(readTheme);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        // Blocked storage: the choice holds for this page view only.
      }
      return next;
    });
  }, []);

  const token = readToken();
  const opts: MountOptions = {
    // The page and the chat endpoint are served by the same agent service.
    agentUrl: window.location.origin,
    token,
    theme,
    variant: 'standalone',
    signedIn: demo || Boolean(token),
    portfolioSlug: demo ? 'main' : undefined,
    portfolios: demo ? demoPortfolios() : undefined,
  };

  return (
    <App
      {...opts}
      onToggleTheme={toggleTheme}
      demoConversation={demo ? kitchenSink() : undefined}
      demoHistoryList={demo ? demoHistoryList() : undefined}
    />
  );
}

applyTheme(readTheme());
const el = document.getElementById('root');
if (el) createRoot(el).render(<Standalone />);
