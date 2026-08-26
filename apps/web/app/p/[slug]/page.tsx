import { PortfolioPage } from '../../../src/screens/PortfolioPage';

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
