import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { holdsPrivateMints, privateMintAddresses } from './privateMint';

describe("a simulator's own mints", () => {
  test('a simulator has the same two addresses every time, each on ports of its own', () => {
    const first = privateMintAddresses('3F2A-one');
    expect(privateMintAddresses('3F2A-one')).toEqual(first);
    const ports = first.flatMap((mint) => [mint.port, mint.tlsPort]);
    expect(new Set(ports).size).toBe(4);
    expect(first.map((mint) => mint.url)).toEqual(
      first.map((mint) => `https://localhost:${mint.tlsPort}`)
    );
    // Clear of the ports an invoice's mint is given and of the ones macOS hands out.
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(40_000);
      expect(port).toBeLessThan(49_152);
    }
  });

  test('a mint folder holds mints only once one has kept a database there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sovran-e2e-mints-'));
    try {
      expect(holdsPrivateMints(dir)).toBe(false);
      mkdirSync(join(dir, 'b'));
      writeFileSync(join(dir, 'b', 'cdk-mintd.sqlite'), '');
      expect(holdsPrivateMints(dir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
