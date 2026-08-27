import puppeteer, { Browser } from 'puppeteer';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { config } from '../config';

/**
 * One browser for the whole service, one page per scan. Two engines behind the
 * same interface (getBrowser / closeBrowser), chosen by SCANNER_ENGINE:
 *
 * - **lightpanda** (default): a headless browser built from scratch in Zig,
 *   driven over CDP just like Chrome. On our DeBank workload it boots the same
 *   SPA, makes the same signed requests and reads the same total, at ~2.5-3x
 *   less RAM and a touch faster — measured, not assumed. We run it as a long-
 *   lived `lightpanda serve` child and CONNECT to it.
 * - **chrome**: puppeteer-launched Chromium, the fallback that has always worked.
 *
 * Either way, EVM scan concurrency is hard-capped at one (see the browserLock in
 * evm-browser.ts): two headless scans at once choke each other and SILENTLY
 * return $0. Scale is horizontal — more replicas of this service, not more tabs.
 */
const logger = new Logger('Browser');

let browserPromise: Promise<Browser> | null = null;
// Only set for the lightpanda engine: the `serve` process we own and must reap.
let lightpandaProc: ChildProcess | null = null;

function launchChrome(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: config.puppeteerExecutablePath || undefined,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      ...(config.chromeNoSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  });
}

/** Binary lookup: explicit path, then bundled next to the service, then PATH. */
function resolveLightpandaBin(): string {
  if (config.lightpandaPath) return config.lightpandaPath;
  const candidates = [
    // dist/scanners -> apps/scanner-evm/bin ; src/scanners -> apps/scanner-evm/bin
    resolve(__dirname, '..', '..', 'bin', 'lightpanda'),
    resolve(process.cwd(), 'apps', 'scanner-evm', 'bin', 'lightpanda'),
    '/usr/local/bin/lightpanda',
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return 'lightpanda';
}

async function waitForCdp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`lightpanda CDP endpoint ${url} not ready: ${lastErr}`);
}

async function launchLightpanda(): Promise<Browser> {
  const bin = resolveLightpandaBin();
  const host = config.lightpandaHost;
  const port = config.lightpandaPort;
  logger.log(`starting lightpanda: ${bin} serve --host ${host} --port ${port}`);

  // Own process group (detached) so we can reap the whole tree, and a piped
  // stderr so we can read the bound address and surface fatal errors.
  const proc = spawn(bin, ['serve', '--host', host, '--port', String(port)], {
    stdio: ['ignore', 'ignore', 'pipe'],
    detached: true,
  });
  lightpandaProc = proc;
  proc.on('error', (e) => logger.error(`lightpanda spawn failed: ${e.message}`));
  proc.on('exit', (code, signal) => {
    logger.warn(`lightpanda exited (code=${code} signal=${signal})`);
    if (lightpandaProc === proc) lightpandaProc = null;
  });
  // Persistent drain: keep the stderr pipe empty (a full pipe would block
  // lightpanda) and log anything fatal.
  proc.stderr?.on('data', (d: Buffer) => {
    for (const line of d.toString().split('\n')) {
      const t = line.trim();
      if (t.includes('$level=fatal') || t.includes('$level=error')) logger.error(`lightpanda: ${t}`);
    }
  });

  // lightpanda prints `... $msg="server running" address=HOST:PORT` once bound.
  // Read the ACTUAL address from there: with --port 0 it is OS-assigned, and
  // either way it guarantees we connect to the server WE spawned, never a
  // stale one a crashed predecessor left on a fixed port.
  const endpoint = await new Promise<string>((resolve, reject) => {
    let buf = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
      fn();
    };
    const onData = (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/address=([\d.]+:\d+)/);
      if (m) finish(() => resolve(m[1]));
    };
    const onExit = () => finish(() => reject(new Error('lightpanda exited before it was ready')));
    const timer = setTimeout(() => finish(() => reject(new Error('lightpanda did not report a listen address in 15s'))), 15_000);
    proc.stderr?.on('data', onData);
    proc.once('exit', onExit);
  });

  await waitForCdp(`http://${endpoint}/json/version`, 10_000);
  // CONNECT, not launch: the browser here is the serve process we just spawned.
  return puppeteer.connect({
    browserURL: `http://${endpoint}`,
    protocolTimeout: config.evmTimeoutMs,
  });
}

/** SIGKILL the lightpanda process group and wait for it to actually die. */
async function killLightpanda(): Promise<void> {
  const proc = lightpandaProc;
  lightpandaProc = null;
  if (!proc) return;
  await new Promise<void>((res) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      res();
    };
    proc.once('exit', finish);
    try {
      // Negative pid => the whole group (we spawned it detached).
      if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
      else proc.kill('SIGKILL');
    } catch {
      try {
        proc.kill('SIGKILL');
      } catch {
        finish();
      }
    }
    setTimeout(finish, 2_000);
  });
}

function launch(): Promise<Browser> {
  return config.scannerEngine === 'chrome' ? launchChrome() : launchLightpanda();
}

export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const browser = await browserPromise;
      if (browser.connected) return browser;
      // Dead connection. For chrome close() reaps Chromium; for lightpanda we
      // drop the socket and kill the serve process ourselves, below.
      await browser.close().catch(() => {});
    } catch {
      // the previous launch itself failed — fall through and retry
    }
    browserPromise = null;
    await killLightpanda();
  }
  browserPromise = launch();
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  try {
    if (pending) {
      const browser = await pending;
      // chrome: close() ends the process we launched. lightpanda: disconnect the
      // CDP socket, then kill the serve process (close() would try to drive a
      // browser we merely connected to).
      if (config.scannerEngine === 'chrome') await browser.close();
      else await browser.disconnect();
    }
  } catch {
    // already closed or never came up
  }
  await killLightpanda();
}
