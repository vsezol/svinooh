import { createServer } from 'node:http';
import { MARKETS, RESERVE_METRICS, VAULTS, VAULT_METRICS_PAGES } from '../test/fixtures/kamino';

export function startReplay(port = 0): Promise<{ url: string; stop: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://replay');
    const answer = (body: unknown) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === '/kvaults/vaults') return answer(VAULTS);
    if (url.pathname === '/kvaults/vaults/metrics') {
      const token = url.searchParams.get('paginationToken');
      return answer(token === 'page-2' ? VAULT_METRICS_PAGES[1] : VAULT_METRICS_PAGES[0]);
    }
    if (url.pathname === '/v2/kamino-market') return answer(MARKETS);
    if (url.pathname.startsWith('/kamino-market/')) {
      return answer(RESERVE_METRICS[url.pathname.split('/')[2]] ?? []);
    }
    response.writeHead(404).end('{}');
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const chosen = typeof address === 'object' && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${chosen}`,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

if (process.argv[1]?.endsWith('replay-kamino.ts')) {
  void startReplay(Number(process.env.PORT) || 8123).then(({ url }) =>
    console.log(`replaying kamino at ${url}`),
  );
}
