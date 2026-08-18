import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import {
  COCOD_ALLOWED_VERSIONS,
  preflight,
  type CocodPreflight,
  type Exec,
} from '../counterparties/cocod';
import {
  createCocodCounterparty,
  type CocodCommandExecutor,
  type CocodCommandResult,
  type CocodCounterparty,
} from '../funded/cocod';

export const CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT =
  'I_ACKNOWLEDGE_USING_CURRENT_DOT_COCOD_WALLET' as const;

const DEFAULT_TIMEOUT_MS = 60_000;
const PREFLIGHT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

interface CocodProcessOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export type CocodProcessRunner = (
  bin: string,
  args: readonly string[],
  options: CocodProcessOptions
) => Promise<CocodCommandResult>;

export interface LiveCocodMetadata {
  readonly bin: string;
  readonly source: CocodPreflight['source'];
  readonly version: string;
  readonly home: string;
}

export interface LiveCocodBoundary {
  readonly metadata: LiveCocodMetadata;
  readonly capabilities: ReadonlySet<string>;
  readonly execute: CocodCommandExecutor;
  readonly cocod: CocodCounterparty;
}

interface CurrentCocodOptions {
  /** Deliberate consent to use the currently configured ~/.cocod wallet. */
  readonly currentWalletAcknowledgement: typeof CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly syncExec?: Exec;
  readonly which?: (cmd: string) => string | null;
  readonly runProcess?: CocodProcessRunner;
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('invalid cocod process timeout');
  }
}

function findOnPath(cmd: string, env: Record<string, string | undefined>): string | null {
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, cmd);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue looking without surfacing path details from the host environment.
    }
  }
  return null;
}

function createSyncExec(env: NodeJS.ProcessEnv): Exec {
  return (argv) => {
    const [bin, ...args] = argv;
    if (!bin) throw new Error('cocod preflight command failed');
    const result = spawnSync(bin, args, {
      encoding: 'utf8',
      env,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
      timeout: PREFLIGHT_TIMEOUT_MS,
    });
    if (result.error || result.signal || result.status !== 0) {
      throw new Error('cocod preflight command failed');
    }
    return {
      code: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };
}

const runSpawnedProcess: CocodProcessRunner = (bin, args, options) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let child: ReturnType<typeof spawn>;

    const finishFailure = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('cocod process failed'));
    };

    const append = (current: string, chunk: Buffer): string | null => {
      if (Buffer.byteLength(current) + chunk.byteLength > MAX_OUTPUT_BYTES) return null;
      return current + chunk.toString('utf8');
    };

    try {
      child = spawn(bin, [...args], {
        env: options.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      reject(new Error('cocod process failed'));
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finishFailure();
    }, options.timeoutMs);

    const childStdout = child.stdout;
    const childStderr = child.stderr;
    if (!childStdout || !childStderr) {
      child.kill('SIGKILL');
      finishFailure();
      return;
    }

    childStdout.on('data', (chunk: Buffer) => {
      const next = append(stdout, chunk);
      if (next === null) {
        child.kill('SIGKILL');
        finishFailure();
        return;
      }
      stdout = next;
    });
    childStderr.on('data', (chunk: Buffer) => {
      const next = append(stderr, chunk);
      if (next === null) {
        child.kill('SIGKILL');
        finishFailure();
        return;
      }
      stderr = next;
    });
    child.once('error', finishFailure);
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });

function createSafeExecutor(
  checked: CocodPreflight,
  env: NodeJS.ProcessEnv,
  runProcess: CocodProcessRunner
): CocodCommandExecutor {
  return async (args, options) => {
    if (args.some((arg) => arg.toLowerCase() === 'history')) {
      throw new Error('cocod history is disabled');
    }
    assertTimeout(options.timeoutMs);
    try {
      const result = await runProcess(checked.bin, args, {
        env,
        timeoutMs: options.timeoutMs,
      });
      if (
        !Number.isSafeInteger(result.code) ||
        typeof result.stdout !== 'string' ||
        typeof result.stderr !== 'string'
      ) {
        throw new Error('invalid process result');
      }
      return result;
    } catch {
      throw new Error('cocod process failed');
    }
  };
}

/**
 * Performs the installed-binary/version/capability checks synchronously and
 * returns a process-pinned typed boundary. It does not itself prove the wallet
 * is unlocked; normal funded execution should use connectUnlockedCurrentCocod.
 */
export function preflightCurrentCocod(options: CurrentCocodOptions): LiveCocodBoundary {
  if (options.currentWalletAcknowledgement !== CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT) {
    throw new Error('current cocod wallet acknowledgement required');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertTimeout(timeoutMs);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    SOVRAN_ALLOW_DEFAULT_COCOD: '1',
  };

  let checked: CocodPreflight;
  try {
    checked = preflight({
      exec: options.syncExec ?? createSyncExec(env),
      env,
      which: options.which ?? ((cmd) => findOnPath(cmd, env)),
      allowedVersions: COCOD_ALLOWED_VERSIONS,
    });
  } catch {
    throw new Error('cocod preflight failed');
  }

  const execute = createSafeExecutor(checked, env, options.runProcess ?? runSpawnedProcess);
  const cocod = createCocodCounterparty({ execute, timeoutMs });
  return {
    metadata: Object.freeze({
      bin: checked.bin,
      source: checked.source,
      version: checked.version,
      home: checked.home,
    }),
    capabilities: new Set(checked.capabilities),
    execute,
    cocod,
  };
}

/** A connected boundary is returned only when the current cocod wallet reports UNLOCKED. */
export async function connectUnlockedCurrentCocod(
  options: CurrentCocodOptions
): Promise<LiveCocodBoundary> {
  const boundary = preflightCurrentCocod(options);
  if ((await boundary.cocod.status()) !== 'UNLOCKED') {
    throw new Error('cocod current wallet is not unlocked');
  }
  return boundary;
}
