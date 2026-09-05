import type { Metadata } from 'next';
import { Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'Hyperliquid portfolio tracker — svinooh';
const DESCRIPTION =
  'Your whole Hyperliquid account — perps margin, spot, staked HYPE and vault equity — counted inside your full portfolio, from the same EVM address.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chains/hyperliquid' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/chains/hyperliquid' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function HyperliquidPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · HYPERLIQUID"
        title="Hyperliquid, counted at full account value"
        lead="Hyperliquid balances are exactly what most trackers silently skip: money parked in an app rather than sitting in the wallet. svinooh reads the account behind the same EVM address you already track — perps margin, spot, staked HYPE and vault equity, one honest number inside your total."
      />

      <Section title="The undercount problem">
        <P>
          A tracker that only reads wallet token balances misses app deposits entirely, and Hyperliquid is where that
          hurts most. On one of the wallets we test against, the Hyperliquid account holds $3,512 of a $27,485 portfolio
          — skip it and the total is quietly thirteen percent short, with nothing on the page admitting it.
        </P>
      </Section>

      <Section title="What's included">
        <P>
          The account's full value: perps margin, spot balances, staked HYPE and vault equity, taken together. It is the
          account's worth, not a trade blotter — svinooh answers how much is there; the exchange itself answers which
          trades. HyperEVM balances ride the EVM side of the same address, and overlapping rows are deduplicated so
          nothing is counted twice.
        </P>
      </Section>

      <Faq
        items={[
          {
            q: 'Do I need a Hyperliquid API key?',
            a: 'No. The account value is read from public data by address — the same watch-only rule as everywhere else in svinooh: no keys, no signatures.',
          },
          {
            q: 'Are individual perp positions listed?',
            a: 'No — the account is counted at its full value as one position. For managing trades, the exchange is the right screen; for whether your net worth is right, this one is.',
          },
          {
            q: 'Is HyperEVM covered too?',
            a: 'Yes — tokens and DeFi positions on HyperEVM come in through the EVM family for the same address, separately from the exchange account, with overlap removed.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
