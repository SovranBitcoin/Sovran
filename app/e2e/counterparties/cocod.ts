/**
 * cocod is a black-box SAT-only counterparty, never the wallet-engine oracle.
 * Preflight makes it deterministic: pin an explicit `COCOD_BIN` (or resolve
 * `which` but record which one — never a silent fall-through between the two
 * global installs), reject an unexpected version, feature-detect the capability
 * surface from `--help`, and require an isolated test HOME (never personal
 * `~/.cocod`). Pure helpers take an injected `exec`/`env`/`which` so this is
 * fully testable without a real binary.
 */
import { join } from 'node:path';

export const COCOD_ALLOWED_VERSIONS = new Set(['0.0.16']);

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Exec = (args: string[]) => ExecResult;

export interface CocodPreflight {
  bin: string;
  source: 'env' | 'path';
  version: string;
  home: string;
  capabilities: Set<string>;
}

export function parseVersion(stdout: string): string {
  const m = stdout.match(/\b(\d+\.\d+\.\d+)\b/);
  if (!m)
    throw new Error(`could not parse cocod version from ${JSON.stringify(stdout.slice(0, 40))}`);
  return m[1];
}

export function resolveCocodBin(
  env: Record<string, string | undefined>,
  which: (cmd: string) => string | null
): {
  bin: string;
  source: 'env' | 'path';
} {
  if (env.COCOD_BIN) return { bin: env.COCOD_BIN, source: 'env' };
  const found = which('cocod');
  if (!found) throw new Error('cocod not found — set COCOD_BIN to an explicit absolute path');
  return { bin: found, source: 'path' };
}

/** Map cocod `--help` output to the closed capability tokens. Always includes
 *  unit.sat (cocod is SAT-oriented) and never unit.usd. */
export function detectCapabilities(topHelp: string, sub: Record<string, string>): Set<string> {
  const has = (t: string, word: string) => new RegExp(`(^|\\s)${word}(\\s|$)`, 'm').test(t);
  const caps = new Set<string>(['unit.sat']);
  if (has(topHelp, 'status')) caps.add('cocod.status');
  if (has(topHelp, 'balance')) caps.add('cocod.balance');
  // Deliberately never expose history as a runnable capability: cocod 0.0.16
  // prints raw proof secrets in that command's output.
  if (has(topHelp, 'x-cashu')) caps.add('cocod.x-cashu');
  if (has(sub.send ?? '', 'cashu')) caps.add('cocod.send.cashu');
  if (has(sub.send ?? '', 'bolt11')) caps.add('cocod.send.bolt11');
  if (has(sub.receive ?? '', 'cashu')) caps.add('cocod.receive.cashu');
  if (has(sub.receive ?? '', 'bolt11')) caps.add('cocod.receive.bolt11');
  if (has(sub.mints ?? '', 'add')) caps.add('cocod.mints.add');
  if (has(sub.mints ?? '', 'list')) caps.add('cocod.mints.list');
  if (has(sub.mints ?? '', 'info')) caps.add('cocod.mints.info');
  if (has(sub.npc ?? '', 'address')) caps.add('cocod.npc.address');
  if (has(sub.npc ?? '', 'username')) caps.add('cocod.npc.username');
  return caps;
}

function assertIsolatedHome(env: Record<string, string | undefined>): string {
  const personal = env.HOME ? join(env.HOME, '.cocod') : '~/.cocod';
  // This cocod build exposes no home-isolation env var, so ~/.cocod is the only
  // wallet. Using it requires an EXPLICIT acknowledgement that it is a dedicated
  // low-value test counterparty (not a personal wallet) — never a silent default.
  if (env.SOVRAN_ALLOW_DEFAULT_COCOD === '1') return personal;
  const home = env.SOVRAN_TEST_COCOD_HOME || env.COCOD_TEST_HOME;
  if (!home)
    throw new Error(
      'set SOVRAN_TEST_COCOD_HOME to an isolated cocod home, or SOVRAN_ALLOW_DEFAULT_COCOD=1 to acknowledge ~/.cocod is the dedicated test counterparty'
    );
  if (home === personal) throw new Error('refusing ~/.cocod without SOVRAN_ALLOW_DEFAULT_COCOD=1');
  return home;
}

export function preflight(deps: {
  exec: Exec;
  env: Record<string, string | undefined>;
  which: (cmd: string) => string | null;
  allowedVersions?: Set<string>;
}): CocodPreflight {
  const allowed = deps.allowedVersions ?? COCOD_ALLOWED_VERSIONS;
  const { bin, source } = resolveCocodBin(deps.env, deps.which);
  const version = parseVersion(deps.exec([bin, '--version']).stdout);
  if (!allowed.has(version)) {
    throw new Error(
      `unexpected cocod version ${version} at ${bin} (allowed: ${[...allowed].join(', ')})`
    );
  }
  const home = assertIsolatedHome(deps.env);
  const capabilities = detectCapabilities(deps.exec([bin, '--help']).stdout, {
    send: deps.exec([bin, 'send', '--help']).stdout,
    receive: deps.exec([bin, 'receive', '--help']).stdout,
    mints: deps.exec([bin, 'mints', '--help']).stdout,
    npc: deps.exec([bin, 'npc', '--help']).stdout,
  });
  return { bin, source, version, home, capabilities };
}
