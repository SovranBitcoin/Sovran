/**
 * The simulator's command-line tool, called directly. Through `xcrun` every
 * call takes about 0.7 s to find the tool before it does anything; the tool
 * itself answers in under 0.1 s, and a story makes a handful of calls.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Where Xcode's own `simctl` wrapper hands over to.
const DIRECT =
  '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl';

/** The command and leading arguments that run `simctl`. */
export const SIMCTL: readonly [string, ...string[]] = existsSync(DIRECT)
  ? [DIRECT]
  : ['xcrun', 'simctl'];

export function simctl(...args: string[]): string {
  return execFileSync(SIMCTL[0], [...SIMCTL.slice(1), ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
