#!/usr/bin/env bun
/** One owned device/session per platform. No existing wallet is reset. */
import { join } from 'node:path';
const platform = process.argv[2] ?? 'both';
if (process.argv.length > 3 || !['ios', 'android', 'both'].includes(platform)) {
  process.stderr.write('Usage: bun run shots:store [ios|android|both]\n');
  process.exit(2);
}
let failed = false;
for (const driver of platform === 'both'
  ? ['sim', 'android']
  : [platform === 'ios' ? 'sim' : 'android']) {
  const child = Bun.spawn(
    [
      'bun',
      join(import.meta.dir, '..', 'cli.ts'),
      'run',
      '--driver',
      driver,
      '--suite',
      'store-screenshots',
      '--evidence',
      'screenshots',
      '--no-record',
      '--i-approve-destructive-reset',
    ],
    {
      cwd: join(import.meta.dir, '..', '..'),
      stdout: 'inherit',
      stderr: 'inherit',
      stdin: 'inherit',
    }
  );
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    child.kill('SIGINT');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const code = await child.exited;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
  if (interrupted) process.exit(130);
  if (code !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
