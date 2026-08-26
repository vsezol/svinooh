/**
 * The networks we track, drifting past slowly. A static row of four badges
 * couldn't say "50+ chains" — a marquee can show a couple of dozen names and
 * still imply the rest.
 *
 * The list is rendered twice and the track is translated by exactly half its
 * width, so the loop has no visible seam. The mask fades both ends instead of
 * cutting names in half at the edge.
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
    <div style={{ maxWidth: 1120, width: '100%', margin: '0 auto', padding: '0 clamp(14px,3.5vw,28px) 8px' }}>
      <div className="eyebrow" style={{ textAlign: 'center' }}>
        EVERY NETWORK WE TRACK · 50+ CHAINS
      </div>
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
                    borderRadius: 999,
                    padding: '7px 16px',
                    fontSize: 11,
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
