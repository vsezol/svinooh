'use client';

import { useEffect, useState } from 'react';

/**
 * Which theme is on, read from where it actually lives.
 *
 * The app keeps a context for this, and a kit component cannot have one: it is
 * mounted inside the portfolio app, inside the standalone chat, and inside
 * whatever page embeds the widget, and none of those share a provider. What
 * they do share is the attribute the theme is written to — every surface sets
 * `data-theme` on <html>, because that is what the stylesheet reads.
 *
 * So this watches the attribute. Components that draw with CSS need none of
 * this; it is for the ones that hand colours to something that cannot read a
 * stylesheet, which today means a canvas.
 */
export function useThemeName(): string {
  const [theme, setTheme] = useState<string>(
    () => (typeof document === 'undefined' ? 'dark' : document.documentElement.dataset.theme || 'dark'),
  );

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme || 'dark');
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => watch.disconnect();
  }, []);

  return theme;
}
