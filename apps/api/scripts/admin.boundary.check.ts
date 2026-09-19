/**
 * The admin used to be a separate service, and a separate service cannot be
 * imported by accident. This is what replaces that: it reads the imports under
 * apps/api/src and fails if the fence around src/admin has been stepped over.
 *
 * Three rules, the same three the module's comment states:
 *   - nothing outside src/admin imports anything inside it, except the one
 *     line in app.module.ts that mounts it;
 *   - nothing inside src/admin imports a sibling feature of the api;
 *   - the module exports nothing, so there is no provider to inject elsewhere.
 *
 * Run with `npm run -w apps/api check:boundary`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..', 'src');
const ADMIN = join(SRC, 'admin');
const MOUNT = join(SRC, 'app.module.ts');

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

/** Where a relative import lands, as a path under src; absolute specifiers stay as they are. */
const target = (file: string, specifier: string): string =>
  specifier.startsWith('.') ? resolve(file, '..', specifier) : specifier;

const problems: string[] = [];
const say = (file: string, message: string) =>
  problems.push(`${relative(resolve(__dirname, '..', '..', '..'), file)}: ${message}`);

for (const file of files(SRC)) {
  const inside = file.startsWith(ADMIN + '/');

  for (const specifier of importsOf(file)) {
    const path = target(file, specifier);

    if (!inside && path.startsWith(ADMIN + '/')) {
      // app.module.ts mounts it — that is the one line allowed to know it is there
      if (file !== MOUNT) say(file, `reaches into admin (${specifier})`);
      else if (!specifier.endsWith('admin/admin.module')) say(file, `mounts more than the module (${specifier})`);
    }

    if (inside && path.startsWith(SRC + '/') && !path.startsWith(ADMIN + '/')) {
      say(file, `depends on the api outside admin (${specifier})`);
    }
  }
}

const module_ = readFileSync(join(ADMIN, 'admin.module.ts'), 'utf8');
if (/exports\s*:/.test(module_)) {
  say(join(ADMIN, 'admin.module.ts'), 'exports something — nothing may leave this module');
}

for (const problem of problems) console.log(`FAIL  ${problem}`);
console.log(problems.length ? `\n${problems.length} crossing(s) of the admin boundary` : 'ok    the admin boundary holds');
process.exit(problems.length ? 1 : 0);
