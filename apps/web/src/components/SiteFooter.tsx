import Link from 'next/link';

/**
 * One footer for every page. The links are the crawl paths between the app
 * and the pages that explain it — a site whose pages don't link each other
 * is, to a crawler, that many separate one-page sites. The tagline is the
 * entity line: the same sentence everywhere the product introduces itself.
 */
const LINKS = [
  { href: '/pro', label: 'PRO' },
  { href: '/alternatives', label: 'ALTERNATIVES' },
  { href: '/chains', label: 'CHAINS' },
  { href: '/faq', label: 'FAQ' },
];

export function SiteFooter() {
  return (
    <footer style={{ textAlign: 'center', padding: '0 20px 28px' }}>
      <nav
        aria-label="Site"
        style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', paddingBottom: 12 }}
      >
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="mono"
            style={{ fontSize: 'var(--fs-micro)', letterSpacing: '0.12em', color: 'var(--mut)', textDecoration: 'none' }}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="mono" style={{ fontSize: 'var(--fs-micro)', color: 'var(--mut)' }}>
        © 2026 svinooh — crypto portfolio tracker across EVM, Solana, TRON and Bitcoin
      </div>
    </footer>
  );
}
