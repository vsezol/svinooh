import type { Metadata } from 'next';
import { Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'TRON portfolio tracker — svinooh';
const DESCRIPTION =
  'TRX, TRC20 tokens and Stake 2.0 staking with energy and bandwidth delegation — tracked live, with Telegram alerts when a delegation unlocks.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chains/tron' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/chains/tron' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function TronPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · TRON"
        title="The TRON tracker almost nobody built"
        lead="Portfolio trackers treat TRON as an afterthought, when they support it at all. svinooh counts TRX, priced TRC20 tokens and Stake 2.0 staking — including what you delegated out for energy and bandwidth — and pings you in Telegram when a delegation unlocks."
      />

      <Section title="What gets counted">
        <P>
          Liquid TRX and TRC20 tokens, priced live. Staked TRX under Stake 2.0 appears as its own staking position with a
          leg per resource — including stake you delegated out for someone else's energy or bandwidth, which is still
          your money. What others delegated to you is not counted, because it is not. And anything that cannot be priced
          is listed as unpriced rather than silently dropped, so the total never quietly lies by omission.
        </P>
      </Section>

      <Section title="Energy and bandwidth, watched">
        <P>
          TRON's resource system is half the reason to stake at all, so svinooh tracks it as a first-class thing: free
          and total energy and bandwidth, delegations out, and their unlock times — refreshed on its own schedule. Two
          Telegram alerts come with it: when an expired delegation is ready to reclaim, and when incoming delegations
          change.
        </P>
      </Section>

      <Faq
        items={[
          {
            q: 'Is TRON DeFi covered?',
            a: 'Balances and staking are. Positions inside TRON DeFi protocols such as JustLend are not parsed yet — when that changes, this page will say so.',
          },
          {
            q: 'Are TRC10 tokens counted?',
            a: 'They are detected but not priced — reliable TRC10 pricing barely exists — so they appear in the unpriced list instead of being invented into the total.',
          },
          {
            q: 'Does delegated stake count toward my total?',
            a: 'Stake you delegated out does, because it is still yours. Stake others delegated to you does not, because it is not — a distinction some explorers blur.',
          },
          {
            q: 'Is TRON tracking free?',
            a: 'Yes — TRON, Solana and Bitcoin tracking are all in the free tier. Pro lifts general limits, not chains.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
