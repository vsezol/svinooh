import Link from 'next/link';
// Straight from the module, not the barrel: the barrel would drag every
// client-only control into a server page's import graph
import { ButtonLink } from '../../ui/Button';
import { Logo } from '../Logo';
import { SiteFooter } from '../SiteFooter';
import { ThemeToggle } from '../ThemeToggle';

/**
 * The frame around every marketing page: the landing's header, a reading
 * column, the shared footer. Rendered whole on the server — these pages exist
 * for readers and crawlers alike, and neither should wait on a bundle.
 */
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        className="shell app-header"
        style={{ minHeight: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <Link href="/" aria-label="svinooh home" style={{ color: 'inherit', textDecoration: 'none' }}>
          <Logo size={19} />
        </Link>
        <div style={{ display: 'flex', gap: 8 }}>
          <ButtonLink size="sm" variant="quiet" href="/pro">
            Pro
          </ButtonLink>
          <ThemeToggle />
          <ButtonLink size="sm" href="/">
            Create portfolio
          </ButtonLink>
        </div>
      </header>
      {/* The shell's 1120px is a dashboard's width; prose reads at 760 */}
      <main
        className="shell"
        style={{ flex: 1, width: '100%', maxWidth: 760, padding: 'clamp(28px,5vw,56px) clamp(14px,3.5vw,28px) 64px' }}
      >
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
