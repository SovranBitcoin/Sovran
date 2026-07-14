import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const E2E_DIR = dirname(new URL(import.meta.url).pathname);
const APP_DIR = resolve(E2E_DIR, '..');
const REPO_DIR = resolve(APP_DIR, '..');
const LEDGER_PATH = join(APP_DIR, 'docs', 'testing-coverage-ledger.md');
const ledger = readFileSync(LEDGER_PATH, 'utf8');

describe('testing coverage ledger contract', () => {
  it('keeps every explicitly cited TypeScript test path resolvable', () => {
    const citedPaths = [
      ...new Set(
        [...ledger.matchAll(/`((?:app|wallet)\/[^`\n]+?\.(?:ts|tsx))`/g)].map((match) => match[1])
      ),
    ];

    expect(citedPaths.length).toBeGreaterThanOrEqual(40);
    expect(citedPaths.filter((path) => !existsSync(join(REPO_DIR, path)))).toEqual([]);
  });

  it('tracks every state-machine section 11 contract exactly once', () => {
    const sections = [...ledger.matchAll(/^\| 11\.(\d+)\s/gm)].map((match) => Number(match[1]));
    expect(sections).toEqual(Array.from({ length: 16 }, (_, index) => index + 1));
  });

  it('keeps every exact priority test name anchored in a cited source file', () => {
    const stableSection = ledger.slice(
      ledger.indexOf('## Stable requirement traceability'),
      ledger.indexOf('## JSON scenario inventory')
    );
    const citedPaths = [
      ...new Set(
        [...stableSection.matchAll(/`((?:app|wallet)\/[^`\n]+?\.(?:ts|tsx))`/g)].map(
          (match) => match[1]
        )
      ),
    ];
    const citedSources = citedPaths.map((path) => readFileSync(join(REPO_DIR, path), 'utf8'));
    const exactNames = [...stableSection.matchAll(/(?:test|table case) `([^`]+)`/g)].map(
      (match) => match[1]
    );

    expect(exactNames.length).toBeGreaterThanOrEqual(10);
    expect(
      exactNames.filter((name) => !citedSources.some((source) => source.includes(name)))
    ).toEqual([]);
  });

  it('uses unique stable IDs for priority and named-backlog requirements', () => {
    const stableSection = ledger.slice(
      ledger.indexOf('## Stable requirement traceability'),
      ledger.indexOf('## JSON scenario inventory')
    );
    const backlogSection = ledger.slice(
      ledger.indexOf('## Mint, multi-unit, split, offline, and proximity'),
      ledger.indexOf('## Nostr/social and accessibility')
    );
    const ids = [...`${stableSection}\n${backlogSection}`.matchAll(/^\| `([^`]+)`/gm)].map(
      (match) => match[1]
    );

    expect(ids.length).toBeGreaterThanOrEqual(25);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('indexes every authored scenario and labels fake execution as non-product proof', () => {
    const scenarioIds = Array.from(
      new Bun.Glob('scenarios/*.json').scanSync({ cwd: E2E_DIR, absolute: true }),
      (path) => JSON.parse(readFileSync(path, 'utf8')).id as string
    );

    for (const id of scenarioIds) expect(ledger).toContain(`\`${id}\``);
    expect(ledger).toContain('fake-driver orchestration provide no product proof');
  });
});
