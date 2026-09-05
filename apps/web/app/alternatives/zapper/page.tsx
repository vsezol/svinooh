import type { Metadata } from 'next';
import { CheckedNote, Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'Zapper alternative — svinooh';
const DESCRIPTION =
  'Zapper shut down on August 3, 2026. svinooh does the job it did — paste an address, see every DeFi position — across EVM networks plus Solana, TRON and Bitcoin.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/alternatives/zapper' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/alternatives/zapper' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function ZapperAlternativePage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH VS · ZAPPER"
        title="The Zapper alternative that counts everything"
        lead="Zapper wound down on August 3, 2026 — site, apps and API. svinooh does the job it did: paste an address, see every position at its net value. And it counts what most successors still miss: Solana, TRON and Bitcoin, next to every EVM network."
      />

      <Section title="What happened to Zapper">
        <P>
          After nearly seven years and around two million monthly users, Zapper announced an orderly wind-down and went
          offline on August 3, 2026 — the dashboard, the mobile apps and the API together. Portfolios were not migrated
          anywhere. Everyone who tracked DeFi there is choosing a new tracker.
        </P>
      </Section>

      <Section title="Moving takes one paste">
        <P>
          There is nothing to import and no account to make. Open svinooh, paste the same address you watched on Zapper,
          and the portfolio is there: tokens, LP, staking, lending and farming, each position carrying its supply, reward
          and borrow legs. Sign in with Telegram or X when you want several wallets in one portfolio, Telegram alerts, or
          a portfolio kept private behind a link.
        </P>
      </Section>

      <Section title="Where Zapper users land">
        <P>
          Different people used Zapper for different things, so the honest map has three arrows. Tracking DeFi positions
          — svinooh does that, and adds Solana, TRON and Bitcoin to the EVM picture. NFT galleries — svinooh does not
          track NFTs; a wallet like Zerion covers those. Swapping from inside the dashboard — svinooh is watch-only by
          design and will stay that way.
        </P>
      </Section>

      <Faq
        items={[
          {
            q: 'Is svinooh free like Zapper was?',
            a: 'Yes — one portfolio with five wallets, a week of chart history and your first ten Telegram alerts are free. Pro removes the limits for $10 a month (first month $5), prepaid in crypto with no auto-renew.',
          },
          {
            q: 'Do I need to connect a wallet or sign anything?',
            a: 'No. svinooh is watch-only: you paste addresses, it reads public on-chain data. No keys, no signatures, no wallet connection at any point.',
          },
          {
            q: 'Does svinooh cover the DeFi positions Zapper showed?',
            a: 'Yes — LP, staking, lending, farming and deposits are counted at net value, with supply, reward and borrow legs listed per position, range bands for concentrated liquidity, and health factors on loans.',
          },
          {
            q: 'What about NFTs?',
            a: 'svinooh does not track NFTs. If NFT portfolios were your main Zapper use, a wallet like Zerion covers them; svinooh focuses on fungible positions and DeFi.',
          },
        ]}
      />

      <CheckedNote>
        Zapper's shutdown as reported by the project and press, checked September 5, 2026. svinooh is not affiliated with
        Zapper.
      </CheckedNote>

      <Cta />
    </MarketingShell>
  );
}
