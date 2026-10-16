import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Coordinators read results through Python's subprocess capture. There, console.log lost
// everything after the first 64 KiB of a large brief and the process still exited 0.
test('a large result reaches a Python subprocess reader whole', () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-cli-'));
  const select = (id: string) => ({ id, type: 'select', options: [{ id: 'high' }] });
  const filler = Array.from({ length: 3000 }, (_, i) => ({ id: `filler-model-${i}`, options: [select('reasoningEffort')] }));
  const request = join(dir, 'request.json');
  writeFileSync(request, JSON.stringify({ action: 'model-policy', catalog: { observedAt: new Date().toISOString(), providers: [
    { providerInstanceId: 'codex', driverKind: 'codex', canRunChildTask: true,
      models: [...['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra'].map(id => ({ id, options: [select('reasoningEffort')] })), ...filler] },
    { providerInstanceId: 'claudeAgent', driverKind: 'claudeAgent', canRunChildTask: true,
      models: ['claude-opus-5-5', 'claude-fable-5-1'].map(id => ({ id, options: [select('effort')] })) },
  ] } }));
  const reader = [
    'import json, subprocess, sys',
    'o = subprocess.run(sys.argv[1:], capture_output=True, text=True, timeout=60)',
    'print(json.dumps({"code": o.returncode, "length": len(o.stdout), "models": len(json.loads(o.stdout)["catalog"]["providers"][0]["models"])}))',
  ].join('\n');
  const result = Bun.spawnSync(['python3', '-c', reader, process.execPath, join(import.meta.dir, '../src/cli.ts'), request],
    { env: { ...process.env, SOVRAN_HARNESS_STATE: join(dir, 'state') } });
  expect(result.exitCode).toBe(0);
  const read = JSON.parse(result.stdout.toString());
  expect(read.code).toBe(0);
  expect(read.length).toBeGreaterThan(256 * 1024);
  expect(read.models).toBe(3003);
}, 90_000);
