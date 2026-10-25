// A subpath, not the barrel: the kit's index pulls in pieces that only make
// sense inside the Next app, and this bundle is not that app.
import { Stat, StatGrid } from '@svinooh/ui/Stat';
import { useDesktop } from '../../app/useDesktop';
import type { StatsBlock } from '../../app/types';

/**
 * Readings under an answer, in the kit's own card.
 *
 * Not its own drawing of one: the portfolio's headline figures and these are
 * the same object, and the two versions had already drifted a shade of
 * background apart.
 *
 * Two columns on a phone and four on a desktop, said rather than inferred —
 * auto-fit would reflow four readings into one column the moment the panel
 * narrowed, and four readings are a row you scan across.
 */
export default function StatsBlockView({ block }: { block: StatsBlock }) {
  const desktop = useDesktop();
  return (
    <StatGrid columns={desktop ? 4 : 2}>
      {block.items.map((item, i) => (
        <Stat
          key={i}
          label={item.label}
          value={item.value}
          delta={item.sub}
          tone={item.tone === 'up' ? 'up' : item.tone === 'down' ? 'down' : 'flat'}
        />
      ))}
    </StatGrid>
  );
}
