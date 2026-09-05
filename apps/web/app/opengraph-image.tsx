import { ImageResponse } from 'next/og';

export const alt = 'svinooh — every DeFi position, no exceptions';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ACC = '#2bd576';

/**
 * The card a pasted link unfurls into, drawn the way the header draws the
 * wordmark — "svin", two circle eyes, "h" — on the app's own dark ground.
 * Set in the renderer's default face rather than Manrope: satori would need
 * the font file shipped alongside, and a share card is not worth a font
 * pipeline. Eye geometry is the logo's (0.56em wide, 0.135em of rim),
 * restated in pixels because em is not a unit satori borders understand.
 */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#08090c',
          color: '#edeff4',
          padding: '68px 88px 60px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', fontSize: 58, fontWeight: 800, letterSpacing: '-0.03em' }}>svin</div>
          <div style={{ display: 'flex', width: 32, height: 32, border: `8px solid ${ACC}`, borderRadius: 999, marginLeft: 4, marginTop: 14 }} />
          <div style={{ display: 'flex', width: 32, height: 32, border: `8px solid ${ACC}`, borderRadius: 999, marginLeft: -8, marginTop: 14 }} />
          <div style={{ display: 'flex', fontSize: 58, fontWeight: 800, letterSpacing: '-0.03em', marginLeft: 3 }}>h</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.06 }}>
            Every DeFi position.
          </div>
          <div style={{ display: 'flex', fontSize: 92, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.06, color: ACC }}>
            No exceptions.
          </div>
        </div>
        <div style={{ display: 'flex', fontSize: 25, letterSpacing: '0.14em', color: '#9aa1af' }}>
          TOKENS · LP · STAKING · LENDING — 50+ CHAINS
        </div>
      </div>
    ),
    size,
  );
}
