import { describe, expect, test } from 'bun:test';
import { bundledJavaScriptIsCurrent } from './native-build';

describe('a bundled test build carries its JavaScript', () => {
  const built = { gitSha: 'a'.repeat(40), gitDirty: false };

  test('it stands for a clean tree at the commit it was built from', () => {
    expect(bundledJavaScriptIsCurrent(built, 'a'.repeat(40), false)).toBe(true);
  });

  test('a later commit needs a new build', () => {
    expect(bundledJavaScriptIsCurrent(built, 'b'.repeat(40), false)).toBe(false);
  });

  test('uncommitted changes now need a new build', () => {
    expect(bundledJavaScriptIsCurrent(built, 'a'.repeat(40), true)).toBe(false);
  });

  test('a build made from uncommitted changes is never reused', () => {
    expect(bundledJavaScriptIsCurrent({ ...built, gitDirty: true }, 'a'.repeat(40), false)).toBe(
      false
    );
  });
});
