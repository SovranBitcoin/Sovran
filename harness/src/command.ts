import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/** Each trusted check owns a POSIX process group, including ordinary descendants.
 * Deliberately detached grandchildren are outside the trusted-host contract. */
export async function runCommand(argv: string[], cwd: string, stdout: string, stderr: string, timeoutMs: number) {
  const executable = argv[0];
  if (!executable) throw new Error('Empty command');
  if (process.platform === 'win32') throw new Error('Process-group supervision requires a POSIX host');
  const out = openSync(stdout, 'wx', 0o600), err = openSync(stderr, 'wx', 0o600);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const child = spawn(executable, argv.slice(1), { cwd, detached: true,
      stdio: ['ignore', out, err], env: { ...process.env, CI: '1' } });
    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
    };
    timer = setTimeout(() => { timedOut = true; killGroup(); }, timeoutMs);
    const result = await new Promise<{ exit: number; reason: string }>(resolve => {
      child.once('error', error => resolve({ exit: 127, reason: `Launch failed: ${error.message}` }));
      child.once('close', (code, signal) => resolve({ exit: code ?? 128, reason: timedOut ? 'Timed out' : signal ? `Signal ${signal}` : `Exit ${code}` }));
    });
    // A successful parent must not leave a background writer behind either.
    killGroup();
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    closeSync(out); closeSync(err);
  }
}
