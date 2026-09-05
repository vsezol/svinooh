import type { Metadata } from 'next';
import { Cta, Faq, P, PageIntro, Section } from '../../../src/components/marketing/Blocks';
import { MarketingShell } from '../../../src/components/marketing/Shell';

const TITLE = 'Bitcoin portfolio tracker — svinooh';
const DESCRIPTION =
  'Any Bitcoin address, confirmed balance plus pending, priced live — counted in the same total as your EVM, Solana and TRON positions.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: '/chains/bitcoin' },
  openGraph: { type: 'website', siteName: 'svinooh', title: TITLE, description: DESCRIPTION, url: '/chains/bitcoin' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

export default function BitcoinPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="SVINOOH · BITCOIN"
        title="Bitcoin, counted with everything else"
        lead="BTC rarely lives where your DeFi does, so DeFi dashboards mostly ignore it — and your actual net worth is off by however much you hold. svinooh reads any Bitcoin address and puts it in the same total as your EVM, Solana and TRON positions."
      />

      <Section title="What gets counted">
        <P>
          The address's confirmed balance plus whatever is still sitting in the mempool, priced live. Add as many
          addresses as you use — legacy or bech32 — next to wallets from the other three families, and the portfolio is
          one number instead of four tabs.
        </P>
        <P>
          That is deliberately all it is. Bitcoin's job in a portfolio is to be counted correctly, not decorated — no
          invented yield, no wrapper products pretending to be the real thing.
        </P>
      </Section>

      <Faq
        items={[
          {
            q: 'Are Ordinals, Runes or Lightning tracked?',
            a: 'No — plain BTC balances only. If inscriptions are your thing, keep a specialized explorer beside svinooh; the balance itself still counts here.',
          },
          {
            q: 'Can I add an xpub?',
            a: 'No — svinooh tracks addresses. Add each address you use; they sit side by side in one portfolio.',
          },
          {
            q: 'Is Bitcoin tracking free?',
            a: 'Yes — Bitcoin, Solana and TRON tracking are all in the free tier. Pro lifts general limits, not chains.',
          },
        ]}
      />

      <Cta />
    </MarketingShell>
  );
}
