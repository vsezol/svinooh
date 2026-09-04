import { IconButton } from '../ui';
import { useTheme } from '../lib/theme';

const SUN = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

const MOON = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" />
  </svg>
);

/**
 * Sun in the dark, moon in the light — the icon shows what you get by pressing
 * it, which is the convention everywhere and needs no label.
 *
 * Which icon shows is decided in CSS, off the `data-theme` on <html>, rather
 * than by this component. The server has no idea what theme a visitor keeps, so
 * a JavaScript choice here would render one icon into the HTML and swap it on
 * hydration; the attribute is set before the first paint, so CSS gets it right
 * the first time.
 */
export function ThemeToggle() {
  const { toggle } = useTheme();
  return (
    <IconButton label="Switch theme" onClick={toggle}>
      <span className="on-dark">{SUN}</span>
      <span className="on-light">{MOON}</span>
    </IconButton>
  );
}
