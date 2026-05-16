import { attemptRollback } from '@/shared/lib/cashu/utils';

jest.mock('@cashu/coco-core', () => ({
  getDecodedToken: jest.fn(),
}));

jest.mock('@/shared/lib/logger', () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('attemptRollback', () => {
  it('retries a send reclaim when coco left the operation rolling_back', async () => {
    const manager = {
      ops: {
        send: {
          get: jest.fn(async () => ({ id: 'op-1', state: 'rolling_back' })),
          cancel: jest.fn(),
          reclaim: jest.fn(async () => undefined),
        },
      },
    };

    await expect(attemptRollback(manager as never, 'op-1')).resolves.toBe(true);

    expect(manager.ops.send.reclaim).toHaveBeenCalledWith('op-1');
    expect(manager.ops.send.cancel).not.toHaveBeenCalled();
  });
});
