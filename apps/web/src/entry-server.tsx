import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { loadLandingData, PRELOAD_KEY, type LandingData } from './lib/landing-data';
import { Landing } from './pages/Landing';

/**
 * The landing, rendered to HTML on the server.
 *
 * Only the landing: it is the page strangers and crawlers arrive on, and the
 * one whose content is the same for everybody. A portfolio page is a live view
 * of somebody's money that changes with who is asking, so it stays a client
 * render — there is nothing to gain and a privacy rule to trip over.
 *
 * The providers are here because the page uses them, not because they do
 * anything server-side: effects don't run, so AuthProvider renders a signed-out
 * tree, which is exactly what an anonymous first paint should be.
 */
export function renderLanding(data: LandingData): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location="/">
        <ThemeProvider>
          <AuthProvider>
            <Landing preloaded={data} />
          </AuthProvider>
        </ThemeProvider>
      </StaticRouter>
    </StrictMode>,
  );
}

/** `</script>` inside the data would end the tag early — that is the whole risk here */
export function serializePreload(data: LandingData): string {
  return `<script>window.${PRELOAD_KEY}=${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export { loadLandingData };
export type { LandingData };
