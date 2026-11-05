import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../../..');

const flatten = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, nested]) => flatten(nested, `${prefix}${key}.`))
    : [prefix.slice(0, -1)];

const localeKeys = (lng: string): string[] =>
  flatten(
    JSON.parse(readFileSync(path.join(root, 'locales', lng, 'translation.json'), 'utf8')),
  ).sort();

// Application source only: tests and test helpers may mention keys that do not exist on purpose
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' || fullPath === path.join(root, 'src', 'test')
        ? []
        : sourceFiles(fullPath);
    }
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [fullPath] : [];
  });

const KEY_LITERAL = /['"`]((?:error|auth|user|validation|upload|success)\.[a-z_]+)['"`]/g;

describe('translations', () => {
  it('en and tr define the same keys', () => {
    expect(localeKeys('tr')).toEqual(localeKeys('en'));
  });

  it('every translation key referenced in src exists in en', () => {
    const known = new Set(localeKeys('en'));
    const used = sourceFiles(path.join(root, 'src')).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(KEY_LITERAL)].map((match) => match[1]),
    );

    const missing = [...new Set(used)].filter((key) => !known.has(key)).sort();

    expect(missing).toEqual([]);
  });
});
