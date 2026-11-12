/** @jest-environment node */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { caseSchema } from './releaseFixtures/cases';

const cli = (...args: string[]) =>
  spawnSync('bun', ['scripts/persistence.ts', ...args], {
    cwd: resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
  });
it('lists every old format, preserves public history ambiguity, and reports the real candidate', () => {
  const result = cli('status', '--json', '--version', '0.0.51');
  expect(result.status).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(data.summary).toMatchObject({ cases: 2, unmapped: 0 });
  expect(data.candidate).toMatch(/^[a-f0-9]{40}$/);
  expect(data.releases).toContainEqual(
    expect.objectContaining({
      id: 'apple:gb:0.0.51',
      mapping: { kind: 'version-candidates', epochs: ['E8', 'E9'] },
    })
  );
});
it('scaffolds a new case without writing or manufacturing a passing assertion', () => {
  const result = cli(
    'scaffold',
    '--epoch',
    'E19',
    '--store',
    'wallet-lifecycle',
    '--case',
    'new-case'
  );
  expect(result.status).toBe(0);
  const declaration = JSON.parse(result.stdout);
  expect(declaration).toMatchObject({
    id: 'new-case',
    epoch: 'E19',
    storageKey: 'wallet-lifecycle',
    preserve: { REPLACE_FIELD: 'REPLACE_WITH_HISTORICAL_INPUT' },
  });
  expect(caseSchema.safeParse(declaration).success).toBe(false);
});
it.each([
  ['check', '--case', 'absent'],
  ['status', '--version', '9.9.9'],
  ['status', '--typo'],
])('fails clearly rather than running zero tests: %j', (...args) => {
  const result = cli(...args);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/No persistence cases|Unknown or duplicate/);
});

it.each([
  'RELEASE_FIXTURE_FILE',
  'WRITE_UPGRADED_DISK',
  'WRITE_RELEASE_FIXTURE',
  'WRITE_E20_RECORDS',
])('refuses inherited legacy selection or writer controls: %s', (name) => {
  const result = spawnSync('bun', ['scripts/persistence.ts', 'check', '--case', 'baseline'], {
    cwd: resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, [name]: 'E19-0.1.2' },
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`Unset ${name}`);
});

it('does not relabel a historical report when the test process produces no new report', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'persistence-report-test-'));
  const report = resolve(directory, 'report.json');
  const historical = JSON.stringify({
    success: true,
    persistence: { candidate: 'old', cases: ['E19'] },
  });
  writeFileSync(report, historical);
  writeFileSync(resolve(directory, 'bun'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const bun = execFileSync('which', ['bun'], { encoding: 'utf8' }).trim();
  const result = spawnSync(
    bun,
    ['scripts/persistence.ts', 'check', '--epoch', 'E1', '--out', report],
    {
      cwd: resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    }
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('no fresh report');
  expect(readFileSync(report, 'utf8')).toBe(historical);
  expect(result.stdout).not.toContain('Machine-readable Jest report');
});
