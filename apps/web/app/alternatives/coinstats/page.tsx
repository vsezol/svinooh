import type { Metadata } from 'next';
import { CheckedNote, CompareTable, Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'CoinStats alternative — svinooh';
const DESCRIPTION =
  'CoinStats aggregates exchange accounts; svinooh counts what happens on-chain — LP, staking, lending and farming at net value across EVM, Solana, TRON and Bitcoin.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/alternatives/coinstats' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/alternatives/coinstats' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function CoinStatsAlternativePage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH VS · COINSTATS"
        title="A CoinStats alternative for the on-chain half"
        lead="CoinStats is built around exchange accounts — hundreds of integrations, one total. svinooh is built for the money that lives on-chain: DeFi positions with their supply, reward and borrow legs, counted at net value across EVM, Solana, TRON and Bitcoin."
      />

      <Section title="Different money, different tracker">
        <P>
          If most of your funds sit on Binance or Coinbase, CoinStats' exchange sync is the right tool, and svinooh does
          not imitate it: there are no exchange integrations here, and no API keys to hand over.
        </P>
        <P>
          If your funds sit in LPs, lending markets and staking contracts, the picture flips. svinooh's position model is
          a DeFi one: range bands on concentrated liquidity with a Telegram ping on the crossing, health factors on
          loans, borrow legs subtracting from the total the way a debt should — and TRON staking with resource
          delegation, which almost nobody counts at all.
        </P>
      </Section>

      <Section title="Side by side">
        <CompareTable
          other="CoinStats"
          rows={[
            { label: 'Built around', ours: 'On-chain DeFi positions', theirs: 'Exchanges + wallets' },
            { label: 'Exchange accounts', ours: '—', theirs: '300+ integrations' },
            { label: 'Credentials needed', ours: 'None — addresses only', theirs: 'Read-only exchange API keys' },
            { label: 'TRON staking', ours: 'Tracked, with resource alerts', theirs: '—' },
            { label: 'Price', ours: 'Free · Pro $10/mo', theirs: 'Free tier · Premium from ~$14/mo' },
          ]}
        />
        <CheckedNote>
          CoinStats details from its public materials and independent reviews, September 2026. Details can change;
          svinooh is not affiliated with CoinStats.
        </CheckedNote>
      </Section>

      <Faq
        items={[
          {
            q: 'Does svinooh connect to Binance or Coinbase?',
            a: 'No. svinooh reads public on-chain data only — no exchange integrations, no API keys. If you need exchange balances and on-chain funds in one view, CoinStats or a similar aggregator is the better fit for that half.',
          },
          {
            q: 'What does svinooh count that balance trackers miss?',
            a: 'Positions rather than just tokens: LP shares with their underlying legs and range bands, staking, lending with debt subtracted at net value, farming rewards listed per position — and the chains most trackers skip, like TRON with Stake 2.0 and delegated resources.',
          },
          {
            q: 'Why no exchange support?',
            a: 'Focus. Exchange sync is a different product with different risks — credentials, rate limits, per-exchange quirks. svinooh spends that effort on counting on-chain positions other trackers miss.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
