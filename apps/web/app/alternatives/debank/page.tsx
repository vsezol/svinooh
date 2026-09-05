import type { Metadata } from 'next';
import { CheckedNote, CompareTable, Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'DeBank alternative — svinooh';
const DESCRIPTION =
  'DeBank is EVM-only — 72 chains, none of them Solana, TRON or Bitcoin. svinooh tracks the same wallet-and-DeFi picture and adds all three, in portfolios private by default.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/alternatives/debank' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/alternatives/debank' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function DebankAlternativePage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH VS · DEBANK"
        title="A DeBank alternative for more than EVM"
        lead="DeBank is the reference for EVM DeFi, and it is free — but its chain list is EVM only: no Solana, no TRON, no Bitcoin. svinooh counts those three next to every EVM network, in one portfolio that is private by default."
      />

      <Section title="Where the two differ">
        <P>
          On an EVM address the two show a similar picture. svinooh's case is everything around it: one portfolio that
          mixes EVM wallets with Solana, TRON and Bitcoin addresses; visibility you choose — private by default,
          shareable by link, public only if you list it; and Telegram alerts when an LP leaves its range, a health factor
          sinks, or a TRON delegation unlocks.
        </P>
        <P>
          DeBank's own strengths are real: unusually wide EVM protocol coverage and a social layer built on public wallet
          profiles. If everything you own is EVM and a public profile suits you, it remains a fine free choice — plenty
          of people run both.
        </P>
      </Section>

      <Section title="Side by side">
        <CompareTable
          other="DeBank"
          rows={[
            { label: 'Chains', ours: 'EVM + Solana, TRON, Bitcoin', theirs: 'EVM only — 72 chains' },
            { label: 'Solana', ours: 'Tracked, ~118 DeFi platforms', theirs: 'Not supported' },
            { label: 'TRON', ours: 'Tracked, incl. Stake 2.0', theirs: 'Not supported' },
            { label: 'Bitcoin', ours: 'Tracked', theirs: 'Not supported' },
            { label: 'Privacy', ours: 'Private by default, share by link', theirs: 'Profiles are public by address' },
            { label: 'Telegram alerts', ours: 'Range, health, borrow APY, TRON', theirs: '—' },
            { label: 'Price', ours: 'Free · Pro $10/mo', theirs: 'Free' },
          ]}
        />
        <CheckedNote>
          DeBank's chain list checked against its public API on September 5, 2026 — 72 chains, all EVM. Details can
          change; svinooh is not affiliated with DeBank.
        </CheckedNote>
      </Section>

      <Faq
        items={[
          {
            q: 'Is DeBank really EVM-only?',
            a: 'As of September 2026 its public chain list contains 72 networks and every one of them is EVM — no Solana, TRON or Bitcoin entry. That is the gap svinooh closes.',
          },
          {
            q: 'Which sees more DeFi positions on EVM?',
            a: 'Coverage on EVM is comparable — svinooh aggregates from the major position indexes rather than keeping its own protocol list, and refines concentrated-liquidity and lending positions with on-chain reads. Outside EVM there is no comparison to make: DeBank stops, svinooh keeps counting.',
          },
          {
            q: 'Does svinooh have DeBank’s social features?',
            a: 'No. svinooh has no profiles, follows or feeds — it shows positions, not people. Nothing about a portfolio’s owner is ever public, which is the opposite of a social product and deliberately so.',
          },
          {
            q: 'Can I run both?',
            a: 'Yes, and many people should: DeBank for EVM research and its social graph, svinooh for the one portfolio that also holds your Solana, TRON and Bitcoin — with alerts watching it.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
