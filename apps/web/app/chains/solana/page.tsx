import type { Metadata } from 'next';
import { CheckedNote, Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'Solana portfolio tracker — svinooh';
const DESCRIPTION =
  'Track Solana DeFi at full value: positions across ~118 platforms — Kamino, Meteora, MarginFi, Drift, Orca — with range bands, health factors and rewards.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chains/solana' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/chains/solana' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function SolanaPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · SOLANA"
        title="Track your Solana portfolio at full value"
        lead="Paste a Solana address and get more than token balances: DeFi positions across roughly 118 platforms — Kamino, Meteora, MarginFi, Drift, Orca and the rest — each with its supply, reward and borrow legs counted at net value."
      />

      <Section title="What gets counted">
        <P>
          Wallet tokens, and then the part balance-checkers skip: positions. Coverage comes from a position index running
          231 fetchers across roughly 118 Solana platforms, so new protocols appear as the index adds them rather than
          waiting on a hand-kept list. Loans carry a health factor on the classic scale; rewards sit inside each
          position's value, listed leg by leg; debt subtracts, the way debt should.
        </P>
        <P>
          Two refinements come straight from the chain: Orca and Meteora concentrated-liquidity positions are checked
          against the pool's own state, so the page can say in range or out of range with the band's actual bounds. And
          GM pools on GMX-Solana are priced from the protocol's indexer — a corner general indexes see but cannot price.
        </P>
      </Section>

      <Section title="Alerts that watch Solana">
        <P>
          The two alerts that matter on Solana DeFi work here: a Telegram ping the moment a concentrated-liquidity
          position crosses out of its range — or back in — and one when a loan's health factor drops below your
          threshold. Alerts belong to the portfolio's owner; a shared link never exposes them.
        </P>
      </Section>

      <Section title="The gap this closes">
        <P>
          Most DeFi trackers grew up on EVM and treat Solana as an afterthought: DeBank's chain list has no Solana entry
          at all, and Zerion's paid tier covers EVM networks only, with Solana marked as coming soon. On svinooh, Solana
          is not an add-on and not behind the paywall — it is one of the four families the tracker was built around.
        </P>
      </Section>

      <Faq
        items={[
          {
            q: 'Which Solana protocols are covered?',
            a: 'Coverage comes from a position index with 231 fetchers across roughly 118 platforms — Kamino, Meteora, MarginFi, Drift and Orca among them — rather than a fixed list, so it grows as the index does.',
          },
          {
            q: 'Do I need to connect Phantom or another wallet?',
            a: 'No. svinooh is watch-only: paste the address, and it reads public chain data. No keys, no signatures, no wallet connection.',
          },
          {
            q: 'Are LP ranges shown for Orca and Meteora?',
            a: 'Yes — in range or out, with the band bounds, read from the pool itself rather than inferred. Telegram can ping you on the crossing in either direction.',
          },
          {
            q: 'Is Solana tracking free?',
            a: 'Yes — Solana, TRON and Bitcoin tracking are all in the free tier. Pro lifts general limits like wallets per portfolio and chart history, not chains.',
          },
        ]}
      />

      <CheckedNote>
        Competitor chain support checked September 5, 2026: DeBank's public chain list is EVM-only; Zerion Premium is
        EVM-only with Solana listed as coming soon.
      </CheckedNote>

      <Cta />
    </MarketingShell>
  );
}
