import { useEffect, useState } from 'react';

/**
 * Whether there is room for a desktop layout.
 *
 * A media query rather than a width: the widget is embedded in a panel as
 * often as it fills a window, and what matters is how much room this instance
 * has, not how big the screen is.
 */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return desktop;
}
