import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileArtifactSink, SecureAppendSink } from './real';

describe('secure artifacts', () => {
  it('creates private directories/files and rejects traversal', () => {
    const base = mkdtempSync(join(tmpdir(), 'sovran-e2e-'));
    const sink = new FileArtifactSink(join(base, 'run'));
    const path = sink.write('scenario/evidence.ax.json', 'ax', '{}');
    expect(statSync(join(base, 'run')).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => sink.write('../escape.log', 'log', 'no')).toThrow(/outside run directory/);
  });

  it('writes a private append-only JSONL transcript', () => {
    const base = mkdtempSync(join(tmpdir(), 'sovran-e2e-'));
    const path = join(base, 'events.jsonl');
    const sink = new SecureAppendSink(path);
    sink.write('{"one":1}\n');
    sink.write('{"two":2}\n');
    sink.close();
    expect(readFileSync(path, 'utf8')).toBe('{"one":1}\n{"two":2}\n');
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
