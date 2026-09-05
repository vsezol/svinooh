import type { Metadata } from 'next';
import { Faq, PageIntro, Cta } from '../../src/components/marketing/Blocks';
import { MarketingShell } from '../../src/components/marketing/Shell';

const TITLE = 'FAQ — svinooh';
const DESCRIPTION =
  'What svinooh tracks, what it costs, how fresh the numbers are, and what stays private — the questions people ask before pasting an address.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/faq' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/faq' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

// The one page that answers in sentences. Everything here is restated from
// what the product actually does — when a limit or a number changes, this page
// changes in the same commit.
const ITEMS = [
  {
    q: 'What is svinooh?',
    a: 'A crypto portfolio tracker for EVM networks, Solana, TRON and Bitcoin. It counts DeFi positions — tokens, LP, staking, lending, farming — at their net value, in one portfolio you can keep private, share by link, or list publicly.',
  },
  {
    q: 'Do I need to connect a wallet?',
    a: 'No. svinooh is watch-only: you paste addresses and it reads public on-chain data. No keys, no signatures, no wallet connection — which also means you can track addresses that are not yours to sign for, like a cold wallet or a treasury.',
  },
  {
    q: 'Which chains are supported?',
    a: 'Four families in one portfolio: every EVM network our data sources cover (Ethereum, Arbitrum, Base, BNB Chain, Polygon, Hyperliquid and dozens more), Solana with DeFi positions across roughly 118 platforms, TRON including Stake 2.0 staking and resources, and Bitcoin balances.',
  },
  {
    q: 'Is svinooh free?',
    a: 'Yes. The free plan is one portfolio, five wallets, seven days of chart history and your first ten Telegram alerts. Pro removes the limits for $10 a month, with the first month at $5.',
  },
  {
    q: 'How do I pay for Pro?',
    a: 'In crypto — stablecoins by default, any coin if you prefer. No card, and no auto-renew: a month is prepaid, and the Telegram bot reminds you before Pro ends. Stopping is simply not paying again.',
  },
  {
    q: 'How fresh are the numbers?',
    a: 'A portfolio being watched rescans its wallets about every five minutes, dropping to every half hour when nobody has looked for a day; opening the page puts it back on the fast tier. A sudden large drop is re-checked before it is believed, so a flaky source cannot paint a crash that did not happen.',
  },
  {
    q: 'Who can see my portfolio?',
    a: 'By default, only someone you hand the link to. Portfolios are private by default, shareable by link, and listed publicly only if you choose — and in every case the page shows the portfolio, never its owner: no name, no handle, nothing.',
  },
  {
    q: 'What alerts can I set?',
    a: 'Five kinds, delivered in Telegram: an LP leaving or re-entering its range, a health factor dropping below your threshold, a borrow APY climbing above it, and TRON resource events — a delegation to reclaim and incoming delegation changes.',
  },
  {
    q: 'Does svinooh track NFTs or exchange accounts?',
    a: 'No. There are no exchange integrations and no NFT tracking — svinooh keeps to fungible on-chain positions and does that thoroughly. If half your money sits on an exchange, pair it with an aggregator that syncs exchanges.',
  },
  {
    q: 'Is there a mobile app or an API?',
    a: 'svinooh is an installable web app — add it to your home screen and it behaves like an app, offline page included. There are no native apps and no public API today.',
  },
];

export default function FaqPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · FAQ"
        title="Questions, answered plainly"
        lead="What svinooh tracks, what it costs, how fresh the numbers are, and what stays private. If the answer isn't here, paste an address and see for yourself — trying it is free and needs no account."
      />
      <Faq items={ITEMS} />
      <Cta />
    </MarketingShell>
  );
}
