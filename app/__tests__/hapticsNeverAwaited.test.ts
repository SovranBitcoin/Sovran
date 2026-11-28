/**
 * @jest-environment node
 *
 * A press handler fires its haptic and acts in the same tick: awaiting the
 * haptic bridge first serialises a native round-trip in front of every copy,
 * mint change and balance flip. `EnhancedHaptics` swallows its own errors,
 * so `void` is always safe.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SCANNED = ['app', 'features', 'shared'];
const OWNERS = new Set(['shared/ui/primitives/Haptics.tsx', 'shared/ui/primitives/Pressable.tsx']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

it('never awaits a haptic before the action it accompanies', () => {
  const offenders = SCANNED.flatMap((dir) => sourceFiles(join(ROOT, dir)))
    .map((path) => relative(ROOT, path))
    .filter((path) => !OWNERS.has(path))
    .filter((path) => /await\s+EnhancedHaptics\./.test(readFileSync(join(ROOT, path), 'utf8')));
  expect(offenders).toEqual([]);
});
