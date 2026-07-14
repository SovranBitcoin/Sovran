import { describe, expect, test } from 'bun:test';

import { dirtyFromPorcelain } from './git';

describe('dirtyFromPorcelain', () => {
  test('clean tree is not dirty', () => {
    expect(dirtyFromPorcelain('')).toBe(false);
    expect(dirtyFromPorcelain('\n\n')).toBe(false);
  });

  test('modified product file is dirty', () => {
    expect(dirtyFromPorcelain(' M app/features/wallet/screens/WalletScreen.tsx\n')).toBe(true);
  });

  test('artifacts-only changes are ignored', () => {
    expect(
      dirtyFromPorcelain(
        '?? app/e2e/artifacts/run-2026-07-13T04-29-34-798Z-0f50b991/\n M app/e2e/artifacts/metro.log\n'
      )
    ).toBe(false);
  });

  test('artifacts changes mixed with product changes are dirty', () => {
    expect(dirtyFromPorcelain('?? app/e2e/artifacts/run-x/\n M app/e2e/cli.ts\n')).toBe(true);
  });

  test('rename counts as dirty unless both sides are artifacts', () => {
    expect(dirtyFromPorcelain('R  app/e2e/cli.ts -> app/e2e/cli2.ts\n')).toBe(true);
    expect(dirtyFromPorcelain('R  app/e2e/artifacts/a.log -> app/e2e/artifacts/b.log\n')).toBe(
      false
    );
  });
});
