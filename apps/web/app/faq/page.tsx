import type { Metadata } from 'next';
import { Faq, PageIntro, Cta } from '../../src/components/marketing/Blocks';
import { MarketingShell } from '../../src/components/marketing/Shell';
import { PRODUCT_FAQ } from '@svinooh/content';

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

// The one page that answers in sentences — and what it says is what the
// assistant says, because both read PRODUCT_FAQ. A limit or a number that
// changes changes in one place, and in one commit.
const ITEMS = PRODUCT_FAQ;

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
