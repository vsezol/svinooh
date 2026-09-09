import { Eyebrow } from '../ui';
/**
 * The networks we track, drifting past slowly. A static row of four badges
 * couldn't say "50+ chains" — a marquee can show a couple of dozen names and
 * still imply the rest.
 *
 * The list is rendered twice and the track is translated by exactly half its
 * width, so the loop has no visible seam. The mask fades both ends instead of
 * cutting names in half at the edge.
 *
 * It draws its own band — the padding above and below, and the rule under it —
 * because that rule is what divides the landing's opening from the rest of the
 * page. A divider belongs to the thing that divides, not to whatever happens
 * to sit next to it.
 */
const CHAINS = [
  'ETHEREUM',
  'ARBITRUM',
  'SOLANA',
  'BASE',
  'BITCOIN',
  'OP MAINNET',
  'BNB CHAIN',
  'POLYGON',
  'TRON',
  'AVALANCHE',
  'HYPERLIQUID',
  'BERACHAIN',
  'SCROLL',
  'LINEA',
  'ZKSYNC',
  'BLAST',
  'MANTLE',
  'SONIC',
  'GNOSIS',
  'CELO',
  'MODE',
  'ZORA',
  'SEI',
  'PLASMA',
];

export function ChainMarquee() {
  return (
    <div className="shell" style={{ paddingTop: 'clamp(40px,6vw,64px)', paddingBottom: 'clamp(40px,6vw,64px)', borderBottom: '1px solid var(--line)' }}>
      {/* Tracked a shade wider than the kit's default, which is what the
          landing's eyebrows are set at — see SectionEyebrow, the other four. */}
      <Eyebrow style={{ textAlign: 'center', letterSpacing: '0.18em' }}>
        EVERY NETWORK WE TRACK · 50+ CHAINS
      </Eyebrow>
      <div
        style={{
          overflow: 'hidden',
          marginTop: 14,
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)',
          maskImage: 'linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, width: 'max-content', animation: 'svmarquee 55s linear infinite' }}>
          {[0, 1].map((copy) => (
            <div key={copy} style={{ display: 'flex', gap: 8 }} aria-hidden={copy === 1}>
              {CHAINS.map((chain) => (
                <span
                  key={chain}
                  className="mono"
                  style={{
                    border: '1px solid var(--line)',
                    background: 'var(--surf)',
                    borderRadius: 'var(--r-full)',
                    padding: '7px 16px',
                    fontSize: 'var(--fs-tag)',
                    letterSpacing: '0.06em',
                    color: 'var(--mut)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {chain}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
