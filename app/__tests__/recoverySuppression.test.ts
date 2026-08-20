/**
 * @jest-environment node
 */

import {
  beginRecoverySuppression,
  deferWhileRecovering,
  endRecoverySuppression,
  isRecoverySuppressed,
} from '@/shared/lib/cashu/recoverySuppression';

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  cashuLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

afterEach(() => {
  // Module singleton — leaving it suppressed would break the next test file.
  if (isRecoverySuppressed()) endRecoverySuppression();
});

describe('recovery suppression', () => {
  it('runs refreshes immediately when no recovery is in flight', () => {
    const refresh = jest.fn();
    expect(deferWhileRecovering('mints', refresh)).toBe(false);
    expect(refresh).not.toHaveBeenCalled(); // caller runs it, not us
  });

  it('coalesces a storm of events into one refresh per subscriber', () => {
    const mints = jest.fn();
    const keysets = jest.fn();
    beginRecoverySuppression();

    // What a 100-mint deep probe looks like: hundreds of mint:* events.
    for (let i = 0; i < 200; i += 1) {
      expect(deferWhileRecovering('mints', mints)).toBe(true);
      expect(deferWhileRecovering('keysets', keysets)).toBe(true);
    }
    expect(mints).not.toHaveBeenCalled();
    expect(keysets).not.toHaveBeenCalled();

    endRecoverySuppression();
    expect(mints).toHaveBeenCalledTimes(1);
    expect(keysets).toHaveBeenCalledTimes(1);
  });

  it('replays the most recent callback for a key', () => {
    const stale = jest.fn();
    const fresh = jest.fn();
    beginRecoverySuppression();
    deferWhileRecovering('mints', stale);
    deferWhileRecovering('mints', fresh);
    endRecoverySuppression();

    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('does not replay anything a second time', () => {
    const refresh = jest.fn();
    beginRecoverySuppression();
    deferWhileRecovering('mints', refresh);
    endRecoverySuppression();
    endRecoverySuppression();

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps flushing when one subscriber throws', () => {
    const bad = jest.fn(() => {
      throw new Error('subscriber blew up');
    });
    const good = jest.fn();
    beginRecoverySuppression();
    deferWhileRecovering('bad', bad);
    deferWhileRecovering('good', good);

    expect(() => endRecoverySuppression()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('drops anything still pending from a previous run when a new one starts', () => {
    const abandoned = jest.fn();
    beginRecoverySuppression();
    deferWhileRecovering('mints', abandoned);
    // A second run begins without the first ever ending (screen remounted).
    beginRecoverySuppression();
    endRecoverySuppression();

    expect(abandoned).not.toHaveBeenCalled();
  });
});
