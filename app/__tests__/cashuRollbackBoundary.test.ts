/**
 * @jest-environment node
 *
 * Characterization of the app's `attemptRollback`: which Coco send call it makes
 * for each operation state, and what it returns. Only the Coco manager is fake.
 */

import { attemptRollback } from '@/shared/lib/cashu/utils';

type SendState = 'init' | 'prepared' | 'executing' | 'pending' | 'finalized' | 'rolled_back';

function createManager(operation: { id: string; state: SendState } | null) {
  const send = {
    get: jest.fn(async () => operation),
    cancel: jest.fn(async () => undefined),
    reclaim: jest.fn(async () => undefined),
  };
  return {
    send,
    manager: { ops: { send } } as unknown as Parameters<typeof attemptRollback>[0],
  };
}

beforeEach(() => {
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('attemptRollback', () => {
  it('cancels a prepared send and reports success', async () => {
    const { manager, send } = createManager({ id: 'op-1', state: 'prepared' });

    await expect(attemptRollback(manager, 'op-1')).resolves.toBe(true);

    expect(send.get).toHaveBeenCalledWith('op-1');
    expect(send.cancel).toHaveBeenCalledWith('op-1');
    expect(send.reclaim).not.toHaveBeenCalled();
  });

  it.each(['pending', 'executing'] as const)(
    'reclaims a %s send instead of cancelling it',
    async (state) => {
      const { manager, send } = createManager({ id: 'op-2', state });

      await expect(attemptRollback(manager, 'op-2')).resolves.toBe(true);

      expect(send.reclaim).toHaveBeenCalledWith('op-2');
      expect(send.cancel).not.toHaveBeenCalled();
    }
  );

  it.each(['finalized', 'rolled_back', 'init'] as const)(
    'touches nothing and reports failure for a %s send',
    async (state) => {
      const { manager, send } = createManager({ id: 'op-3', state });

      await expect(attemptRollback(manager, 'op-3')).resolves.toBe(false);

      expect(send.cancel).not.toHaveBeenCalled();
      expect(send.reclaim).not.toHaveBeenCalled();
    }
  );

  it('touches nothing and reports failure for an operation Coco does not know', async () => {
    const { manager, send } = createManager(null);

    await expect(attemptRollback(manager, 'missing')).resolves.toBe(false);

    expect(send.cancel).not.toHaveBeenCalled();
    expect(send.reclaim).not.toHaveBeenCalled();
  });

  it('reports failure instead of rejecting when the reclaim throws', async () => {
    const { manager, send } = createManager({ id: 'op-4', state: 'pending' });
    send.reclaim.mockRejectedValueOnce(new Error('mint unreachable'));

    // QUIRK: the error is logged and flattened to false, so a caller cannot tell "mint
    // unreachable" from "nothing to roll back". A fix that surfaces the error should change
    // this assertion on purpose.
    await expect(attemptRollback(manager, 'op-4')).resolves.toBe(false);
  });

  it('reports failure instead of rejecting when reading the operation throws', async () => {
    const { manager, send } = createManager({ id: 'op-5', state: 'prepared' });
    send.get.mockRejectedValueOnce(new Error('database is locked'));

    // QUIRK: same flattening as above.
    await expect(attemptRollback(manager, 'op-5')).resolves.toBe(false);
    expect(send.cancel).not.toHaveBeenCalled();
  });
});
