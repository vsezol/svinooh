import type { Metadata } from 'next';
import Link from 'next/link';
import { Cta, P, PageIntro, Section } from '../../src/components/marketing/Blocks';
import { MarketingShell } from '../../src/components/marketing/Shell';

const TITLE = 'Supported chains — svinooh';
const DESCRIPTION =
  'One portfolio across four chain families: every EVM network, Solana with ~118 DeFi platforms, TRON with Stake 2.0 and resources, and Bitcoin.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chains' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/chains' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// The same four families the lead names, in the same order a paste is
// detected. EVM's row points down the page — its story is the network list —
// while the other three link out to their own pages.
const FAMILIES = [
  {
    href: '#evm',
    name: 'EVM',
    line: 'Every network the position indexes cover — sixty-plus, Ethereum to Berachain. The full list is below.',
  },
  {
    href: '/chains/solana',
    name: 'Solana',
    line: 'DeFi positions across ~118 platforms — Kamino, Meteora, MarginFi, Drift, Orca — with ranges and health factors.',
  },
  {
    href: '/chains/tron',
    name: 'TRON',
    line: 'TRX, TRC20 and Stake 2.0 staking with energy and bandwidth delegation — plus Telegram alerts on both.',
  },
  {
    href: '/chains/bitcoin',
    name: 'Bitcoin',
    line: 'Address balances, confirmed and pending, counted in the same total as everything else.',
  },
];

const EVM_NETWORKS = [
  'Ethereum',
  'Arbitrum',
  'Base',
  'OP Mainnet',
  'BNB Chain',
  'Polygon',
  'Avalanche',
  'Hyperliquid',
  'Berachain',
  'Scroll',
  'Linea',
  'zkSync',
  'Blast',
  'Mantle',
  'Sonic',
  'Gnosis',
  'Celo',
  'Mode',
  'Zora',
  'Sei',
  'Plasma',
];

export default function ChainsPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · CHAINS"
        title="Every network we track"
        lead="Four chain families in one portfolio: EVM, Solana, TRON and Bitcoin. Paste an address from any of them — svinooh tells which family it belongs to on its own — and the positions land in the same total."
      />

      <Section title="The families">
        <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', background: 'var(--surf)' }}>
          {FAMILIES.map((f, i) => (
            <Link
              key={f.href}
              href={f.href}
              className="row-hover"
              style={{
                display: 'block',
                padding: '14px 18px',
                borderTop: i ? '1px solid var(--line)' : 'none',
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <div style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-body)' }}>{f.name}</div>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-note)', color: 'var(--mut)', lineHeight: 1.5 }}>{f.line}</div>
            </Link>
          ))}
        </div>
      </Section>

      <Section title="EVM networks" id="evm">
        <P>
          EVM coverage follows the position indexes svinooh reads from, so it is broad by construction — sixty-plus
          networks in practice — rather than a hand-kept allowlist. The ones people ask about:
        </P>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {EVM_NETWORKS.map((n) => (
            <span
              key={n}
              className="mono"
              style={{
                border: '1px solid var(--line)',
                background: 'var(--surf)',
                borderRadius: 'var(--r-full)',
                padding: '7px 16px',
                fontSize: 'var(--fs-tag)',
                letterSpacing: '0.06em',
                color: 'var(--mut)',
                whiteSpace: 'nowrap',
              }}
            >
              {n.toUpperCase()}
            </span>
          ))}
        </div>
        <P>
          One EVM corner earns its own page: <Link href="/chains/hyperliquid">Hyperliquid</Link> — the full account
          value most trackers silently skip, read from the same address as your wallet.
        </P>
      </Section>

      <Cta />
    </MarketingShell>
  );
}
