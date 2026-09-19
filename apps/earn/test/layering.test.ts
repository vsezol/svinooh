import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const ROOT = join(process.cwd(), 'src');

const LAYERS: Record<string, string[]> = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  api: ['domain', 'application', 'infrastructure', 'api'],
};

const FORBIDDEN: Record<string, string[]> = {
  domain: ['@nestjs', 'express'],
  application: ['@nestjs/core', 'express'],
  infrastructure: ['@nestjs/core', 'express'],
  api: [],
};

function* sources(directory: string, layer?: string): Generator<{ layer: string; file: string }> {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sources(path, layer ?? entry);
      continue;
    }
    if (layer && entry.endsWith('.ts')) yield { layer, file: path };
  }
}

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map((match) => match[1]);

describe('TheDependencyArrow', () => {
  test('a layer imports only inwards', () => {
    for (const { layer, file } of sources(ROOT)) {
      const allowed = LAYERS[layer];
      if (!allowed) continue;
      for (const imported of importsOf(file)) {
        const reached = /\.\.\/(domain|application|infrastructure|api)\//.exec(imported)?.[1];
        if (reached && !allowed.includes(reached)) {
          assert.fail(`${file.replace(ROOT, 'src')} reaches ${reached}, which ${layer} may not`);
        }
      }
    }
  });

  test('a layer stays out of frameworks it has no business knowing', () => {
    for (const { layer, file } of sources(ROOT)) {
      for (const imported of importsOf(file)) {
        for (const banned of FORBIDDEN[layer] ?? []) {
          assert.ok(
            !imported.startsWith(banned),
            `${file.replace(ROOT, 'src')} imports ${imported}, which ${layer} may not`,
          );
        }
      }
    }
  });

  test('the domain is reachable without a web framework', async () => {
    const { permits } = await import('../src/domain/catalog');
    assert.equal(typeof permits, 'function');
  });
});
