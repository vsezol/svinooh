import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT = resolve(here, 'dist/client');
const PORT = Number(process.env.PORT || 4173);

// Where to read the landing from. Inside Railway the private address avoids a
// trip out to the internet and back; VITE_API_URL is the public one the browser
// was built with, and works as a fallback anywhere.
const API = (process.env.API_INTERNAL_URL || process.env.VITE_API_URL || '').replace(/\/+$/, '');

// How long a rendered landing is reused. It shows a public portfolio's balance,
// which moves on the scanner's schedule, not on ours — a minute-old figure is
// honest and costs the API two requests a minute instead of two per visitor.
const CACHE_MS = 60_000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

const [template, ssr] = await Promise.all([
  readFile(join(CLIENT, 'index.html'), 'utf8'),
  import('./dist/server/entry-server.mjs'),
]);

/**
 * Applies the visitor's saved theme before anything is painted. It has to be
 * inline and it has to run first: the server has no idea which theme they keep,
 * so without this a light-theme visitor gets a dark page for one frame.
 */
const THEME_SCRIPT = `<script>try{var t=localStorage.getItem('svinooh_theme');if(t==='light'){document.documentElement.dataset.theme='light'}}catch(e){}</script>`;

const get = async (path) => {
  const res = await fetch(`${API}/api${path}`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

let cached = null; // { html, at }
let inFlight = null;

async function render() {
  const data = await ssr.loadLandingData(get);
  const html = template
    .replace('</head>', `${THEME_SCRIPT}</head>`)
    .replace(
      '<div id="root"></div>',
      `<div id="root">${ssr.renderLanding(data)}</div>${ssr.serializePreload(data)}`,
    );
  cached = { html, at: Date.now() };
  return html;
}

/**
 * Never makes a visitor wait for the API. A fresh copy is served straight away;
 * a stale one is served straight away and refreshed behind them; only the very
 * first visitor after a deploy waits, and if the API is unreachable even they
 * get the page — as the plain shell the browser fills in, which is what every
 * page did before this server existed.
 */
async function landing() {
  const fresh = cached && Date.now() - cached.at < CACHE_MS;
  if (!fresh && !inFlight) {
    inFlight = render()
      .catch((err) => {
        console.warn(`[ssr] falling back to the client shell: ${err.message}`);
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  if (fresh) return cached.html;
  if (cached) return cached.html; // stale, refreshing behind this response
  return (await inFlight) ?? template;
}

async function sendFile(res, path) {
  const body = await readFile(path);
  const ext = extname(path);
  res.writeHead(200, {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    // Asset names carry a content hash, so they can be cached forever; anything
    // else might be replaced in place by the next deploy
    'cache-control': path.includes('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300',
  });
  res.end(body);
}

createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = decodeURIComponent(url.pathname);

      if (path === '/' || path === '/index.html') {
        const html = await landing();
        res.writeHead(200, {
          'content-type': TYPES['.html'],
          // Shared caches may hold it for a minute; the visitor's own browser
          // should ask again, or a signed-in one would keep seeing the
          // signed-out page it was handed
          'cache-control': 'no-cache, private',
        });
        res.end(html);
        return;
      }

      const file = join(CLIENT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      if (file.startsWith(CLIENT) && (await stat(file).catch(() => null))?.isFile()) {
        await sendFile(res, file);
        return;
      }

      // A path that names a file and isn't one is missing, not a route — an
      // <img> should get a 404, not a page of HTML
      if (extname(path)) {
        res.writeHead(404, { 'content-type': TYPES['.txt'] });
        res.end('Not found');
        return;
      }

      // Any other route is the client's business (/p/:slug and friends)
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' });
      res.end(template);
    } catch (err) {
      console.error(`[web] ${req.method} ${req.url}: ${err instanceof Error ? err.stack : err}`);
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal error');
    }
  })();
}).listen(PORT, '0.0.0.0', () => {
  console.log(`web up on :${PORT} — landing rendered server-side from ${API || '(no API url set)'}`);
});
