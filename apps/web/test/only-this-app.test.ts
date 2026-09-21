import { strict as assert } from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, test } from 'node:test';

const HERE = resolve(import.meta.dirname, '..');

const IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

/**
 * The Dockerfile copies this app and the libs it is built from, and nothing
 * else. A relative import that climbs out of both compiles here, where the
 * whole repository is on disk, and fails in the image where it is not — so it
 * is caught here rather than in a deploy.
 */
const CARRIED = ['apps/web', 'libs/shared', 'libs/content', 'libs/ui'];

function sources(from: string): string[] {
  return readdirSync(from).flatMap((name) => {
    if (name === 'node_modules' || name === 'dist' || name === '.next') return [];
    const path = join(from, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const ROOT = resolve(HERE, '../..');

const escapes = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT)]
    .map(([, where]) => relative(ROOT, resolve(dirname(file), where)))
    .filter((path) => !CARRIED.some((carried) => path.startsWith(carried)));

describe('WhatTheImageCarries', () => {
  test('nothing in this app reaches into another one', () => {
    // This file carries a stray import inside a string, to prove the check can
    // fail. Reading itself would find it and it would be right.
    const strays = sources(HERE)
      .filter((file) => file !== import.meta.filename)
      .flatMap((file) => escapes(file).map((where) => `${relative(ROOT, file)} -> ${where}`));
    assert.deepEqual(strays, []);
  });

  test('it would notice one', () => {
    const planted = join(mkdtempSync(join(tmpdir(), 'stray-')), 'reaches-out.ts');
    writeFileSync(
      planted,
      "import { settledOf } from '../../../agent-web/src/components/blocks/DepositBlock';\n",
    );
    assert.equal(escapes(planted).length, 1, 'the check has to be able to fail');
  });
});
