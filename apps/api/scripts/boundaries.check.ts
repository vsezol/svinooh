/**
 * The admin and the scan pipeline used to be services of their own, and a
 * separate service cannot be imported by accident. This is what replaces that:
 * it reads the imports under apps/api/src and fails if a fence has been stepped
 * over.
 *
 * Per fence, three rules:
 *   - only its declared doors may be imported from outside it;
 *   - inside it, nothing imports the api outside its own directory, except the
 *     neighbours it declares here;
 *   - `exports` on the module says no more than it is allowed to.
 *
 * Run with `npm run -w apps/api check:boundary`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', 'src');
const REPO = resolve(__dirname, '..', '..', '..');

interface Fence {
  /** Directory under src/ that is fenced off */
  dir: string;
  /**
   * What the rest of the api may import from it, as paths under the fence.
   * The module file itself is always a door — app.module.ts mounts it.
   */
  doors: string[];
  /** Directories under src/ this fence is allowed to reach into */
  neighbours: string[];
  /** Providers the module may export, by name. Empty: it exports nothing. */
  exports: string[];
}

const FENCES: Fence[] = [
  { dir: 'admin', doors: ['admin.module'], neighbours: [], exports: [] },
  {
    dir: 'wallet',
    // "scan this wallet now" is the whole of what the api may ask of it
    doors: ['wallet.module', 'scan-requests.service'],
    // The writer tells the collector what it stored — the one direction
    // between these two, and it points this way
    neighbours: ['alerts'],
    exports: ['ScanRequests'],
  },
  {
    dir: 'alerts',
    doors: ['alerts.module', 'collector.service'],
    neighbours: [],
    exports: ['AlertsCollector'],
  },
  {
    dir: 'earn',
    // The yield catalog and the transactions into it, once a service of its
    // own. EarnApi is the HTTP surface without the HTTP; problems.ts is how a
    // caller tells "you can fix this" from "earn cannot answer right now".
    doors: ['earn.module', 'earn.api', 'api/problems'],
    neighbours: [],
    exports: ['EarnApi'],
  },
];

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

/** Where a relative import lands, as an absolute path; package names stay as they are. */
const target = (file: string, specifier: string): string =>
  specifier.startsWith('.') ? resolve(file, '..', specifier) : specifier;

const problems: string[] = [];
const say = (file: string, message: string) =>
  problems.push(`${relative(REPO, file)}: ${message}`);

const under = (path: string, dir: string): boolean => path.startsWith(join(SRC, dir) + '/');

/**
 * src/config.ts is the app's environment — the one file every module is allowed
 * to read, fenced or not. It is what the process was started with, not another
 * feature to depend on.
 */
const SHARED = [join(SRC, 'config')];

for (const file of files(SRC)) {
  const home = FENCES.find((fence) => under(file, fence.dir));

  for (const specifier of importsOf(file)) {
    const path = target(file, specifier);
    if (!path.startsWith(SRC + '/')) continue; // a lib, or a package

    const fence = FENCES.find((f) => under(path, f.dir));
    if (fence && fence !== home) {
      const door = relative(join(SRC, fence.dir), path);
      if (!fence.doors.includes(door)) {
        say(file, `reaches past the ${fence.dir} fence (${specifier}) — its doors are ${fence.doors.join(', ')}`);
      }
    }

    if (
      home &&
      !under(path, home.dir) &&
      !SHARED.includes(path) &&
      !home.neighbours.some((n) => under(path, n))
    ) {
      say(file, `${home.dir} depends on the api outside itself (${specifier})`);
    }
  }
}

for (const fence of FENCES) {
  const module_ = readFileSync(join(SRC, fence.dir, `${fence.doors[0]}.ts`), 'utf8');
  const exported = /exports:\s*\[([^\]]*)\]/.exec(module_);
  const names = (exported?.[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  for (const name of names) {
    if (!fence.exports.includes(name)) {
      say(
        join(SRC, fence.dir, `${fence.doors[0]}.ts`),
        `exports ${name}, which is not one of its declared doors (${fence.exports.join(', ') || 'nothing leaves this module'})`,
      );
    }
  }
}

for (const problem of problems) console.log(`FAIL  ${problem}`);
console.log(
  problems.length
    ? `\n${problems.length} crossing(s): ${FENCES.map((f) => f.dir).join(', ')}`
    : `ok    the fences hold: ${FENCES.map((f) => f.dir).join(', ')}`,
);
process.exit(problems.length ? 1 : 0);
