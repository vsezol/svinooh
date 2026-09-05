import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EVM_CHAINS, evmChain } from '../../../src/lib/evm-chains';
import { Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

/**
 * One template, twelve networks — but the sentences that make each page worth
 * indexing live in evm-chains.ts, per chain. Static folders (solana, tron,
 * bitcoin, hyperliquid, evm) win over this segment, so it only ever renders
 * the EVM networks it declares.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return EVM_CHAINS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const c = evmChain(slug);
  if (!c) return {};
  const title = `${c.queryName ?? c.name} portfolio tracker — svinooh`;
  const description = `Track your ${c.name} portfolio at full value: wallet tokens and DeFi positions — LP, lending, staking, farming — with reward and borrow legs, beside every other chain you hold.`;
  return {
    title,
    description,
    alternates: { canonical: `/chains/${c.slug}` },
    openGraph: { type: 'website', siteName: 'svinooh', title, description, url: `/chains/${c.slug}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

const CHIP = {
  border: '1px solid var(--line)',
  background: 'var(--surf)',
  borderRadius: 'var(--r-full)',
  padding: '7px 16px',
  fontSize: 'var(--fs-tag)',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap' as const,
  textDecoration: 'none',
  color: 'var(--text)',
};

export default async function EvmChainPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = evmChain(slug);
  if (!c) notFound();

  // Neighbours in the list make the "more chains" row — every page links four
  // siblings, so the set is one connected mesh rather than twelve dead ends
  const idx = EVM_CHAINS.findIndex((x) => x.slug === c.slug);
  const related = [1, 2, 3, 4].map((o) => EVM_CHAINS[(idx + o) % EVM_CHAINS.length]);

  return (
    <MarketingShell>
      <PageIntro
        eyebrow={`SVINOOH · ${c.name.toUpperCase()}`}
        title={`Track your ${c.name} portfolio at full value`}
        lead={`${c.intro} Paste an address and every ${c.name} position lands in one portfolio — tokens and DeFi, counted at net value, next to everything you hold on other chains.`}
      />

      <Section title={`What gets counted on ${c.name}`}>
        <P>
          Wallet tokens, and then the part balance checkers skip: positions. Lending, liquidity pools, deposits, staking
          and farming, each carrying its supply, reward and borrow legs — rewards inside the position's value, debt
          subtracting from it, so the total is what the money is actually worth.
        </P>
        <P>{c.holdings}</P>
      </Section>

      {c.onchainChecks ? (
        <Section title="Checked against the chain itself">
          <P>
            On {c.name}, two refinements come straight from the contracts: a Uniswap V3 position's band is read from the
            pool's own tick — in range or out is a fact, not a guess — and Aave V3 loans carry a health factor and
            borrow rate read on-chain. Telegram can ping you the moment a range breaks or a health factor sinks below
            your line.
          </P>
        </Section>
      ) : null}

      <Section title="One address, every network">
        <P>
          An EVM address is one paste: svinooh scans it across sixty-plus networks at once — {c.name} included — and
          folds the result into the same portfolio as your Solana, TRON and Bitcoin. How the whole EVM family works is
          on <Link href="/chains/evm">its own page</Link>.
        </P>
      </Section>

      <Faq
        items={[
          { q: `Which ${c.name} protocols are covered?`, a: c.faqProtocols },
          {
            q: `Is ${c.name} tracking free?`,
            a: 'Yes — chains are never the paywall. The free plan is one portfolio, five wallets, a week of chart history and ten Telegram alerts; Pro lifts those limits for $10 a month.',
          },
          {
            q: 'Do I need to connect a wallet?',
            a: 'No. svinooh is watch-only: paste the address and it reads public on-chain data — no keys, no signatures, ever.',
          },
          ...(c.onchainChecks
            ? [
                {
                  q: `Are LP ranges on ${c.name} reliable?`,
                  a: 'Uniswap V3 bands are read from the pool itself rather than inferred, so the in-range flag matches the chain — and the range alert fires on the actual crossing.',
                },
              ]
            : []),
        ]}
      />

      <nav aria-label="More chains" style={{ marginTop: 44 }}>
        <p
          className="mono"
          style={{ margin: '0 0 12px', fontSize: 'var(--fs-micro)', letterSpacing: 'var(--tr-micro)', color: 'var(--mut)' }}
        >
          MORE CHAINS
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {related.map((r) => (
            <Link key={r.slug} href={`/chains/${r.slug}`} className="mono row-hover" style={CHIP}>
              {r.name.toUpperCase()}
            </Link>
          ))}
          <Link href="/chains/evm" className="mono row-hover" style={CHIP}>
            ALL EVM
          </Link>
          <Link href="/chains" className="mono row-hover" style={CHIP}>
            ALL CHAINS
          </Link>
        </div>
      </nav>

      <Cta />
    </MarketingShell>
  );
}
