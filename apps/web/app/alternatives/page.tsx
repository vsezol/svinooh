import type { Metadata } from 'next';
import Link from 'next/link';
import { PageIntro, Cta } from '../../src/components/marketing/Blocks';
import { MarketingShell } from '../../src/components/marketing/Shell';

const TITLE = 'Alternatives and comparisons — svinooh';
const DESCRIPTION =
  'How svinooh compares to Zapper, DeBank, Zerion and CoinStats — honest, dated comparisons, including where the other tool is the better fit.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/alternatives' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/alternatives' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const PAGES = [
  {
    href: '/alternatives/zapper',
    name: 'Zapper alternative',
    line: 'Zapper shut down on August 3, 2026 — what carries over, and what to use instead.',
  },
  {
    href: '/alternatives/debank',
    name: 'DeBank alternative',
    line: 'DeBank is EVM-only. The same picture, plus Solana, TRON and Bitcoin.',
  },
  {
    href: '/alternatives/zerion',
    name: 'Zerion alternative',
    line: 'Zerion is a wallet with tracking inside; svinooh is watch-only — no keys, ever.',
  },
  {
    href: '/alternatives/coinstats',
    name: 'CoinStats alternative',
    line: 'CoinStats aggregates exchanges; svinooh counts the on-chain half at full value.',
  },
];

export default function AlternativesPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · COMPARISONS"
        title="How svinooh compares"
        lead="Side-by-side with the trackers people actually weigh it against. Every claim about somebody else's product carries the date we checked it — and where the other tool is the better fit, the page says so."
      />
      <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surf)' }}>
        {PAGES.map((p, i) => (
          <Link
            key={p.href}
            href={p.href}
            className="row-hover"
            style={{
              display: 'block',
              padding: '14px 18px',
              borderTop: i ? '1px solid var(--line)' : 'none',
              color: 'inherit',
              textDecoration: 'none',
            }}
          >
            <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)' }}>{p.name}</div>
            <div style={{ marginTop: 4, fontSize: 'var(--fs-note)', color: 'var(--mut)', lineHeight: 1.5 }}>{p.line}</div>
          </Link>
        ))}
      </div>
      <Cta />
    </MarketingShell>
  );
}
