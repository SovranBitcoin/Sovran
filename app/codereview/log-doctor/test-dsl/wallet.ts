/**
 * @fileoverview Sovran Test DSL — wallet (cocod) integration.
 *
 * Shells out to the `cocod` CLI on the test host. cocod is a Cashu wallet
 * daemon (Bun-based, /Users/kelbie/.bun/bin/cocod) that wraps
 * @cashu/coco-core. The DSL `wallet ...` verbs map directly to its
 * subcommands.
 *
 * Verified output formats (from cocod --help and live runs):
 *
 *   cocod ping               → "pong"  (single line)
 *   cocod balance            → JSON: {"<mintUrl>": {"sats": <int>}, ...}
 *   cocod npc address        → "npub1...@npubx.cash"  (single line)
 *   cocod mints list         → one URL per line
 *   cocod send cashu <amt>   → "cashuB..." token (last line)
 *   cocod receive bolt11 <amt> → "lnbc..." invoice (last line)
 *
 * Bun emits a `warn: moduleSuffixes is not supported yet` warning to
 * STDERR when run from this workspace (because of tsconfig.json). We
 * always capture stdout separately and ignore stderr unless cocod
 * exits non-zero, in which case stderr is the error context.
 *
 * cocod must be running as a daemon (`cocod daemon`). The executor
 * pings once at startup; if it fails, the runner errors clearly.
 */

import { spawnSync } from 'child_process';
import path from 'node:path';
import type { WalletStep } from './ast';
import { interpolateString } from './interpolate';

const COCOD_BIN = process.env.COCOD_BIN || 'cocod';

/**
 * Build the environment for cocod without changing the test runner's own HOME.
 * cocod currently stores its mnemonic, database, socket, and pid under
 * `$HOME/.cocod`; the explicit Sovran variable gives device runs a dedicated
 * counterparty wallet while leaving Xcode/WDA and developer tooling on the
 * real home directory.
 */
export function cocodProcessEnv(
  base: Record<string, string | undefined> = process.env
): Record<string, string | undefined> {
  const requestedHome = base.SOVRAN_TEST_COCOD_HOME?.trim();
  if (!requestedHome) return base;

  const home = path.resolve(requestedHome);
  const configDir = path.join(home, '.cocod');
  return {
    ...base,
    HOME: home,
    COCOD_SOCKET: base.COCOD_SOCKET || path.join(configDir, 'cocod.sock'),
    COCOD_PID: base.COCOD_PID || path.join(configDir, 'cocod.pid'),
  };
}

// ─── Spawn helper ──────────────────────────────────────────────────────────

interface CocodResult {
  /** Exit code from cocod. 0 = success. */
  exitCode: number;
  /** Captured stdout, with trailing whitespace trimmed. */
  stdout: string;
  /** Captured stderr, with trailing whitespace trimmed. */
  stderr: string;
}

/**
 * Synchronously run `cocod <args>` and capture both streams.
 *
 * Uses `spawnSync` so test scripts (which are also synchronous step
 * dispatch) don't have to bridge async — wallet steps block the test
 * runner just like tap/wait do, which is the desired semantics.
 */
function runCocod(args: string[]): CocodResult {
  const result = spawnSync(COCOD_BIN, args, {
    encoding: 'utf-8',
    // Inherit the runner environment, optionally isolating only cocod's HOME.
    env: cocodProcessEnv() as NodeJS.ProcessEnv,
  });
  if (result.error) {
    // Most common: ENOENT — cocod not installed or not on PATH.
    throw new Error(
      `wallet: failed to spawn '${COCOD_BIN}': ${result.error.message}\n` +
        `Install cocod (npm i -g cocod) or set COCOD_BIN to its path.`
    );
  }
  return {
    exitCode: result.status ?? -1,
    stdout: (result.stdout ?? '').trimEnd(),
    stderr: (result.stderr ?? '').trimEnd(),
  };
}

// ─── Daemon health check ──────────────────────────────────────────────────

/**
 * Verify that the cocod daemon is running and reachable. Called once at
 * the start of any test run that uses `wallet ...` commands. Returns
 * silently on success; throws a clear, actionable error otherwise.
 */
export function pingCocod(): void {
  const result = runCocod(['ping']);
  if (result.exitCode !== 0 || !result.stdout.includes('pong')) {
    throw new Error(
      `wallet: cocod daemon not reachable.\n` +
        `Start it with: cocod daemon\n` +
        `Then re-run this test.\n` +
        (result.stderr ? `\ncocod stderr:\n${result.stderr}` : '')
    );
  }
}

// ─── DSL wallet verb dispatch ──────────────────────────────────────────────

/**
 * Execute one `wallet ...` step. The executor calls this with the parsed
 * AST node and the current variable map (for `${var}` interpolation in
 * arg literals). Returns the value to bind to `step.as` if any, or
 * undefined.
 *
 * Throws on failure with a message that includes cocod's stderr — test
 * authors should be able to debug from the runner output alone.
 */
export function executeWallet(
  step: WalletStep,
  vars: Record<string, string>
): { boundValue?: string; resolvedArgs: string[] } {
  // Resolve positional arguments — interpolate `$var` references.
  const resolvedArgs = step.args.map((arg) => {
    if (arg.kind === 'var') {
      const value = vars[arg.name];
      if (value === undefined) {
        const bound = Object.keys(vars).join(', ') || 'none';
        throw new Error(`wallet: undefined variable '${arg.name}' (bound: ${bound})`);
      }
      return value;
    }
    // Literal — also interpolate ${var} so test authors can mix:
    //   wallet send cashu 100
    //   wallet receive cashu "${prefix}-${suffix}"
    return interpolateString(arg.kind === 'literal' ? arg.value : '', vars);
  });

  const cocodArgs = [...step.command, ...resolvedArgs];
  const result = runCocod(cocodArgs);

  if (result.exitCode !== 0) {
    throw new Error(
      `wallet: cocod ${cocodArgs.join(' ')} exited ${result.exitCode}\n` +
        (result.stderr ? `stderr:\n${result.stderr}` : '(no stderr)')
    );
  }

  // Per-verb output parsing.
  const verb = step.command.join(' ');
  const boundValue = parseCocodOutput(verb, result.stdout);

  if (step.as && boundValue === undefined) {
    throw new Error(
      `wallet: '${verb}' produced no parseable output to bind to $${step.as}\n` +
        `stdout:\n${result.stdout}`
    );
  }

  return { boundValue, resolvedArgs };
}

// ─── Per-verb output parsers ───────────────────────────────────────────────

/**
 * Extract the meaningful return value from cocod's stdout, per verb.
 * Returns undefined if the verb doesn't produce a bindable value.
 *
 * The `verb` argument is the joined subcommand path (e.g. "send cashu",
 * "mints add", "x-cashu parse").
 */
function parseCocodOutput(verb: string, stdout: string): string | undefined {
  const lines = stdout.split('\n').filter((l) => l.length > 0);

  switch (verb) {
    case 'balance':
      return parseBalance(stdout);

    case 'send cashu':
    case 'send': {
      // Extract the cashuA.../cashuB... token from the output.
      const match = /cashu[AB][A-Za-z0-9_-]+/.exec(stdout);
      return match ? match[0] : undefined;
    }

    case 'send bolt11':
      // No bindable output — exit 0 = success.
      return undefined;

    case 'receive cashu':
      // Confirmation/result — return whatever's on the last line.
      return lines.length > 0 ? lines[lines.length - 1] : undefined;

    case 'receive bolt11': {
      // Extract the lnbc... invoice from the output.
      const match = /lnbc[a-z0-9]+/i.exec(stdout);
      return match ? match[0] : undefined;
    }

    case 'mints add':
      return undefined;

    case 'mints list':
      return lines.join('\n');

    case 'mints info':
      // JSON output — pass through for assertion.
      return stdout;

    case 'npc address':
      // Single-line `npub1...@npubx.cash`.
      return lines.length > 0 ? lines[lines.length - 1] : undefined;

    case 'npc username':
      return undefined;

    case 'x-cashu parse':
    case 'x-cashu handle':
      // Pass through stdout — let the test author assert on the result.
      return stdout;

    case 'history':
      return stdout;

    case 'status':
    case 'ping':
      return stdout;

    default:
      // Unknown verb — pass through stdout so the user can assert on it.
      return stdout || undefined;
  }
}

/**
 * Parse the JSON balance output. cocod prints
 *   {"https://mint.example/Bitcoin": {"sats": 100}, ...}
 *
 * The DSL `wallet balance as $bal` should bind a single integer
 * representing total sats across all mints.
 */
function parseBalance(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as Record<string, Record<string, number>>;
    let totalSats = 0;
    for (const mintUrl of Object.keys(parsed)) {
      const mintBalances = parsed[mintUrl] || {};
      const sats = mintBalances['sats'];
      if (typeof sats === 'number') totalSats += sats;
    }
    return String(totalSats);
  } catch {
    // Fallback: try to extract a bare integer from the output.
    const m = /(\d+)/.exec(stdout);
    return m ? m[1] : undefined;
  }
}
