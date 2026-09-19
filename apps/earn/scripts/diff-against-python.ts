import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startReplay } from './replay-kamino';

const PYTHON_FROM = process.env.EARN_PYTHON_FROM ?? 'origin/main~1';

function pythonEarnFrom(rev: string): { directory: string; drop: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'earn-python-'));
  execFileSync('git', ['worktree', 'add', '--detach', directory, rev], { stdio: 'ignore' });
  return {
    directory: join(directory, 'apps', 'earn'),
    drop: () => {
      execFileSync('git', ['worktree', 'remove', '--force', directory], { stdio: 'ignore' });
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const PATHS = [
  '/health',
  '/v1/lend/pools',
  '/v1/lend/pools?limit=2&sort=tvl_usd',
  '/v1/lend/pools?sort=name',
  '/v1/lend/pools?kind=reserve&token=PYUSD',
  '/v1/lend/pools?min_apy=0.04',
  '/v1/lend/tokens',
  '/v1/lend/tokens?token=pyusd',
  '/v1/lend/pools/sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK',
  '/v1/lend/pools/sol:kamino:reserve:d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q',
  '/v1/lend/pools/sol:kamino:vault:CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd',
  '/v1/lend/pools/sol:kamino:vault:NOPE',
  '/v1/lend/pools?cursor=nonsense',
  '/v1/lend/pools?network=ethereum',
  '/v1/lend/pools?sort=whatever',
];

const IGNORED = new Set(['as_of', 'age_s']);

const SCIENTIFIC_ZERO = /^0E-\d+$/;

const waitFor = async (url: string, seconds = 60): Promise<void> => {
  for (let tick = 0; tick < seconds * 4; tick++) {
    try {
      const answered = await fetch(`${url}/health`);
      if (answered.status === 200) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} never became healthy`);
};

const settled = (value: unknown): unknown => {
  if (typeof value === 'string' && SCIENTIFIC_ZERO.test(value)) return '0';
  if (Array.isArray(value)) return value.map(settled);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !IGNORED.has(key))
        .map(([key, inner]) => [key, settled(inner)]),
    );
  }
  if (typeof value === 'string' && /^0\.0+$/.test(value)) return '0';
  return value;
};

async function bodies(base: string, path: string) {
  const answered = await fetch(`${base}${path}`);
  return { status: answered.status, body: settled(await answered.json()) };
}

function differences(left: unknown, right: unknown, at = ''): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return [`${at || '.'}: python=${JSON.stringify(left)} ts=${JSON.stringify(right)}`];
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].flatMap((key) =>
    differences(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key],
      `${at}.${key}`,
    ),
  );
}

async function main(): Promise<void> {
  console.log(
    'as_of and age_s move between runs and are skipped; an exact zero is compared as a\n' +
      'number, because python quantizes it to "0E-9" at nine places and this does not.\n',
  );
  const replay = await startReplay();
  const env = {
    ...process.env,
    EARN_KAMINO_API: replay.url,
    EARN_STARTUP_GRACE_S: '30',
    EARN_REFRESH_INTERVAL_S: '3600',
  };
  const older = pythonEarnFrom(PYTHON_FROM);
  console.log(`python earn from ${PYTHON_FROM}, node earn from this tree\n`);
  const python = spawn('uv', ['run', 'python', '-m', 'earn.api.serve'], {
    cwd: older.directory,
    env: { ...env, PORT: '8131' },
    stdio: 'ignore',
  });
  const node = spawn('npx', ['tsx', 'src/main.ts'], {
    env: { ...env, PORT: '8132' },
    stdio: 'ignore',
  });
  const stop = async (child: ChildProcess) => {
    child.kill('SIGTERM');
  };

  try {
    await Promise.all([waitFor('http://127.0.0.1:8131'), waitFor('http://127.0.0.1:8132')]);
    let wrong = 0;
    for (const path of PATHS) {
      const [was, now] = await Promise.all([
        bodies('http://127.0.0.1:8131', path),
        bodies('http://127.0.0.1:8132', path),
      ]);
      const found =
        was.status === now.status
          ? differences(was.body, now.body)
          : [`status: python=${was.status} ts=${now.status}`];
      if (found.length === 0) {
        console.log(`same  ${path}`);
        continue;
      }
      wrong++;
      console.log(`DIFF  ${path}`);
      for (const line of found.slice(0, 6)) console.log(`        ${line}`);
    }

    type Listed = { meta: { next_cursor: string | null } };
    const first = (await (
      await fetch('http://127.0.0.1:8131/v1/lend/pools?limit=1')
    ).json()) as Listed;
    const mirrored = (await (
      await fetch('http://127.0.0.1:8132/v1/lend/pools?limit=1')
    ).json()) as Listed;
    const cursorsMatch = first.meta.next_cursor === mirrored.meta.next_cursor;
    console.log(
      `${cursorsMatch ? 'same' : 'DIFF'}  the cursor itself: ${first.meta.next_cursor} / ${mirrored.meta.next_cursor}`,
    );
    if (!cursorsMatch) wrong++;

    console.log(wrong === 0 ? '\nidentical on every path' : `\n${wrong} path(s) differ`);
    process.exitCode = wrong === 0 ? 0 : 1;
  } finally {
    await Promise.all([stop(python), stop(node)]);
    await replay.stop();
    older.drop();
  }
}

void main();
