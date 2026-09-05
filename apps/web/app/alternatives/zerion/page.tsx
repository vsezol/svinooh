import type { Metadata } from 'next';
import { CheckedNote, CompareTable, Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'Zerion alternative — svinooh';
const DESCRIPTION =
  'Zerion is a wallet with tracking inside. svinooh is a watch-only tracker: no keys, no signing — every DeFi position across EVM, Solana, TRON and Bitcoin.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/alternatives/zerion' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/alternatives/zerion' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function ZerionAlternativePage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH VS · ZERION"
        title="A Zerion alternative that never asks for keys"
        lead="Zerion is a wallet first — a good one — with portfolio tracking built in. svinooh is the opposite shape: a watch-only tracker. You paste addresses instead of connecting anything, and it counts EVM, Solana, TRON and Bitcoin in one total."
      />

      <Section title="Wallet or watcher">
        <P>
          That distinction decides everything else. A wallet holds keys, signs transactions, swaps and bridges — tracking
          is one of its screens. svinooh holds nothing and signs nothing: it reads public chain data for any address you
          give it, including addresses that are not yours to sign for — a cold wallet, a treasury, a portfolio you
          advise on.
        </P>
        <P>
          The paid tiers split the same way. Zerion Premium is $99 a year and currently covers EVM networks only, with
          Solana marked as coming soon. svinooh Pro is $10 a month, first month $5 — and the non-EVM chains are not what
          it charges for: Solana, TRON and Bitcoin tracking sit in the free tier.
        </P>
      </Section>

      <Section title="Side by side">
        <CompareTable
          other="Zerion"
          rows={[
            { label: 'Shape', ours: 'Watch-only tracker', theirs: 'Wallet with tracking' },
            { label: 'Keys or signatures', ours: 'Never', theirs: 'It is a wallet' },
            { label: 'Chains tracked', ours: 'EVM + Solana, TRON, Bitcoin', theirs: 'EVM + Solana assets' },
            { label: 'TRON', ours: 'Tracked, incl. Stake 2.0', theirs: '—' },
            { label: 'Bitcoin', ours: 'Tracked', theirs: '—' },
            { label: 'NFTs', ours: '—', theirs: 'Yes' },
            { label: 'Swaps, bridging', ours: '—', theirs: 'Yes' },
            { label: 'Paid tier', ours: 'Pro — $10/mo, first month $5', theirs: 'Premium — $99/yr, EVM-only' },
          ]}
        />
        <CheckedNote>
          Zerion features and Premium pricing from zerion.io, September 5, 2026. Details can change; svinooh is not
          affiliated with Zerion.
        </CheckedNote>
      </Section>

      <Faq
        items={[
          {
            q: 'Is a watch-only tracker safer than tracking in a wallet?',
            a: 'It is a different shape of risk. svinooh never holds keys and never asks for a signature, so there is nothing to phish out of using it. A wallet like Zerion is as safe as your key hygiene — the tracking screen itself is not the risk.',
          },
          {
            q: 'Can svinooh track wallets I do not own?',
            a: 'Yes — any public address on a supported chain: paste it and svinooh builds the portfolio. That is something a wallet-based tracker is not built around.',
          },
          {
            q: 'Does svinooh do swaps or bridging?',
            a: 'No, and it will not — svinooh is read-only by design. When you want to act on a position, you do it in your wallet; svinooh is where you see whether you should.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
