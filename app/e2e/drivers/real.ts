/**
 * Real host-side implementations for a live run: an allowlisted command runner
 * (only the cocod counterparty; args timed out) and a filesystem artifact sink
 * (per-step screenshots + AX under an ignored run dir). Simulator-only sessions
 * use these after lane checks; funded/live command effects remain disabled.
 */
import { chmodSync, closeSync, mkdirSync, openSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { CommandRunner, CommandResult, ArtifactSink } from './driver';
import type { Sink } from '../reporting/reporters';
import { ALLOWED_COMMANDS } from '../schema/capabilities';
import { redactString } from '../core/redact';

export class RealCommandRunner implements CommandRunner {
  async run(command: string[], timeoutMs: number): Promise<CommandResult> {
    const bin = command[0];
    if (!(ALLOWED_COMMANDS as readonly string[]).includes(bin)) {
      throw new Error(`command not allowlisted: ${redactString(bin)}`);
    }
    const proc = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      if (code !== 0)
        throw new Error(
          `command failed (${code}): ${redactString(command.join(' '))}\n${redactString(stderr || stdout).slice(0, 200)}`
        );
      return { code, stdout: stdout.trim() };
    } finally {
      clearTimeout(timer);
    }
  }
}

export class FileArtifactSink implements ArtifactSink {
  private base: string;
  constructor(base: string) {
    this.base = resolve(base);
    mkdirSync(this.base, { recursive: true, mode: 0o700 });
    chmodSync(this.base, 0o700);
  }
  write(rel: string, _kind: 'screenshot' | 'ax' | 'log', data: Uint8Array | string): string {
    const path = resolve(this.base, rel);
    const fromBase = relative(this.base, path);
    if (!fromBase || fromBase.startsWith('..') || isAbsolute(fromBase))
      throw new Error('artifact path resolves outside run directory');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    writeFileSync(path, data, { mode: 0o600 });
    chmodSync(path, 0o600);
    return path;
  }
}

/** Append-only transcript sink with secret-bearing run permissions. */
export class SecureAppendSink implements Sink {
  #fd: number;
  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    chmodSync(dirname(path), 0o700);
    this.#fd = openSync(path, 'a', 0o600);
    chmodSync(path, 0o600);
  }
  write(value: string): void {
    writeSync(this.#fd, value);
  }
  close(): void {
    if (this.#fd < 0) return;
    closeSync(this.#fd);
    this.#fd = -1;
  }
}
