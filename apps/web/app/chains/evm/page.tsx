import type { Metadata } from 'next';
import Link from 'next/link';
import { EVM_CHAINS } from '../../../src/lib/evm-chains';
import { Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'EVM portfolio tracker — svinooh';
const DESCRIPTION =
  'One 0x address, sixty-plus networks: how svinooh counts EVM DeFi — position shapes, net values, on-chain checks, and app balances like Hyperliquid.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chains/evm' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/chains/evm' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const CHIP = {
  border: '1px solid var(--line)',
  background: 'var(--surf)',
  borderRadius: 'var(--r-full)',
  padding: '7px 16px',
  fontSize: 'var(--fs-tag)',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap' as const,
  textDecoration: 'none',
};

// Networks the family covers beyond the ones with their own page
const UNLINKED = ['Mantle', 'Blast', 'Gnosis', 'Celo', 'Mode', 'Zora', 'Sei', 'Plasma'];

export default function EvmPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · EVM"
        title="One address, sixty-plus networks"
        lead="The EVM family is svinooh's widest net. Paste one 0x address and it is scanned across every network the position indexes cover — sixty-plus in practice — with DeFi positions counted at net value on each, in the same portfolio as your Solana, TRON and Bitcoin."
      />

      <Section title="Coverage by construction">
        <P>
          svinooh does not keep a hand-curated chain list that goes stale the week a new L2 launches. EVM coverage
          follows the position indexes it reads from, and those cover sixty-plus networks today — Ethereum, the major
          L2s, and the long tail behind them. If the indexes see a network, its positions count; when they add one,
          svinooh grows with them, no release required.
        </P>
        <P>
          The same rule covers protocols. There is no per-protocol allowlist to fall off: lending markets, DEX pools,
          farms and staking contracts appear as the indexes report them, which in practice means the well-known venues
          on every chain and most of the obscure ones.
        </P>
      </Section>

      <Section title="What a position looks like">
        <P>
          Four shapes: lending, liquidity pools, deposits, and staking — with locked, vesting and farming positions
          folding into the staked shape. Each carries its legs: supply, reward, borrow. A position's value is the net of
          them — rewards sit inside it rather than inflating the total twice, and borrow legs are negative, the way debt
          is. Scam tokens are filtered out; dust under a cent stays in the total but out of your way.
        </P>
      </Section>

      <Section title="Verified on-chain where it matters most">
        <P>
          On Ethereum, Arbitrum, Base and Polygon, two refinements come straight from the contracts: a Uniswap V3
          position's band is read from the pool's own tick — in range or out is a fact, not an inference — and Aave V3
          loans carry a health factor and borrow rate read on-chain. These reads never invent a position; they sharpen
          one the indexes already found, and they are what the range and health-factor Telegram alerts fire from.
        </P>
      </Section>

      <Section title="App balances count too">
        <P>
          Money parked inside an app is still your money, and it is exactly what wallet-only trackers skip. The loudest
          example gets <Link href="/chains/hyperliquid">its own page</Link>: on one of the wallets we test against, the
          Hyperliquid account holds $3,512 of a $27,485 portfolio — thirteen percent that would silently vanish from a
          token-list tracker.
        </P>
      </Section>

      <Section title="The networks">
        <P>The ones people search for have their own pages; the family does not stop at them.</P>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EVM_CHAINS.map((c) => (
            <Link key={c.slug} href={`/chains/${c.slug}`} className="mono row-hover" style={{ ...CHIP, color: 'var(--text)' }}>
              {c.name.toUpperCase()}
            </Link>
          ))}
          <Link href="/chains/hyperliquid" className="mono row-hover" style={{ ...CHIP, color: 'var(--text)' }}>
            HYPERLIQUID
          </Link>
          {UNLINKED.map((n) => (
            <span key={n} className="mono" style={{ ...CHIP, color: 'var(--mut)' }}>
              {n.toUpperCase()}
            </span>
          ))}
        </div>
      </Section>

      <Faq
        items={[
          {
            q: 'Is my network supported?',
            a: 'If the position indexes cover it, yes — the family is sixty-plus networks, and the list above is what people ask about, not a ceiling. Paste the address; the scan answers faster than a spec sheet.',
          },
          {
            q: 'Do I add each network separately?',
            a: 'No. One EVM address is one paste — svinooh scans it across all covered networks at once and folds everything into one portfolio.',
          },
          {
            q: 'How current are the numbers?',
            a: 'A watched portfolio rescans about every five minutes, easing off to half-hourly when nobody has looked for a day. A sudden large drop is re-checked before it is believed.',
          },
          {
            q: 'Is EVM tracking free?',
            a: 'Yes — chains are never the paywall. The free plan is one portfolio, five wallets, a week of chart history and ten Telegram alerts; Pro lifts those limits for $10 a month.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
