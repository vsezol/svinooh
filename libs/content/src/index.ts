/**
 * What the product says about itself.
 *
 * These answers were written once, for the page a person lands on before
 * pasting an address. They are now also what the assistant knows: the same
 * sentences, from the same array, so the product cannot tell somebody one
 * thing on a page and another thing in a chat.
 *
 * That is not tidiness, it is the fix for a real failure. Asked how to add a
 * wallet, the assistant described a Settings menu with a "Manage Wallets"
 * screen; asked which networks it covers, it offered Cosmos over IBC. Both
 * answers were confident, fluent, and invented, because the model had no facts
 * and a question does not wait for them. A model given nothing does not say
 * nothing.
 *
 * So when a limit or a number changes, it changes here, and both the page and
 * the assistant change with it in the same commit. Anything not written here
 * the assistant is told to admit it does not know — see the system prompt in
 * apps/agent/app/config.py.
 */

export interface FaqEntry {
  q: string;
  a: string;
}

export const PRODUCT_FAQ: readonly FaqEntry[] = [
  {
    q: 'What is svinooh?',
    a: 'A crypto portfolio tracker for EVM networks, Solana, TRON and Bitcoin. It counts DeFi positions — tokens, LP, staking, lending, farming — at their net value, in one portfolio you can keep private, share by link, or list publicly.',
  },
  {
    q: 'Do I need to connect a wallet?',
    a: 'No. svinooh is watch-only: you paste addresses and it reads public on-chain data. No keys, no signatures, no wallet connection — which also means you can track addresses that are not yours to sign for, like a cold wallet or a treasury.',
  },
  {
    q: 'How do I add a wallet?',
    a: 'Open your portfolio and paste the address into the field under the charts, then press Add wallet. That is the whole flow — there is no wallet connection step and no separate settings screen for it. The assistant can also create a first portfolio from addresses you give it in the chat, and will ask you to confirm before it does.',
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
    q: 'How do I sign in?',
    a: 'Through Telegram, from the app. The bot exists to let you in and to deliver alerts and billing reminders — it has no commands for managing portfolios or wallets, and everything else happens on the site.',
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
