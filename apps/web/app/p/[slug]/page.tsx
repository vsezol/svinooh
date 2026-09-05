import type { Metadata } from 'next';
import { PortfolioPage } from '../../../src/screens/PortfolioPage';

/**
 * The label on a shared link, not the portfolio itself. The slug is already in
 * the visitor's hand, so saying it back leaks nothing — the numbers still
 * render only in the browser, per the rule below. noindex, because a live
 * money page in a search index would be stale the minute it was cached, and
 * nobody arrives here by searching: a portfolio is reached by the link its
 * owner handed out.
 */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const title = `${slug} — portfolio on svinooh`;
  const description =
    'A live multi-chain portfolio on svinooh — tokens, LP, staking and lending across EVM, Solana, TRON and Bitcoin, counted at full value.';
  return {
    title,
    description,
    robots: { index: false, follow: true },
    alternates: { canonical: `/p/${slug}` },
    openGraph: { type: 'website', siteName: 'svinooh', title, description, url: `/p/${slug}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

/**
 * Rendered in the browser, deliberately. A portfolio is a live view of
 * somebody's money that changes with who is asking — there is nothing to
 * pre-render that would be right for the next visitor, and a privacy rule that
 * says never to hand one person's page to another.
 */
export default async function Portfolio({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PortfolioPage slug={slug} />;
}
