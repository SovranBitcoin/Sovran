/**
 * Pins the approval controller's pure defer/advance decisions: when the
 * sheet auto-opens (only for non-parked requests), how parked ids are pruned
 * as the queue drains, and what a sheet close means for the remaining batch
 * (defer + toast, silent defer for "View All", nothing when the queue is
 * empty). Also pins the one-shot toast-suppression handshake.
 */

/* eslint-disable import/first */

// The controller module reaches the popup engine (heroui-native) at import
// time; the pure helpers under test don't touch it — repo convention is to
// mock the surface (see sendMemoSheet.test.ts) instead of transforming it.
jest.mock('@/shared/lib/popup', () => ({
  popup: jest.fn(),
  showActionSheet: jest.fn(),
}));

import {
  consumeSignerDeferToastSuppression,
  suppressSignerDeferToastOnce,
} from '@/features/nostrSigner/hooks/signerApprovalCoordination';
import {
  hasOpenableRequest,
  pruneDeferredIds,
  signerSheetCloseOutcome,
} from '@/features/nostrSigner/hooks/useSignerApprovalController';

const requests = (...ids: string[]) => ids.map((id) => ({ id }));

describe('hasOpenableRequest', () => {
  it('is false for an empty queue', () => {
    expect(hasOpenableRequest([], new Set())).toBe(false);
  });

  it('is true when any request is not parked', () => {
    expect(hasOpenableRequest(requests('a', 'b'), new Set(['a']))).toBe(true);
  });

  it('is false when every pending request was deferred', () => {
    expect(hasOpenableRequest(requests('a', 'b'), new Set(['a', 'b']))).toBe(false);
  });

  it('a new arrival un-parks the flow', () => {
    const deferred = new Set(['a', 'b']);
    expect(hasOpenableRequest(requests('a', 'b', 'c'), deferred)).toBe(true);
  });
});

describe('pruneDeferredIds', () => {
  it('drops ids whose requests left the queue', () => {
    const next = pruneDeferredIds(new Set(['a', 'b', 'c']), requests('b'));
    expect([...next]).toEqual(['b']);
  });

  it('returns empty once the queue drains', () => {
    expect(pruneDeferredIds(new Set(['a']), []).size).toBe(0);
  });
});

describe('signerSheetCloseOutcome', () => {
  it('queue empty → nothing to defer', () => {
    expect(signerSheetCloseOutcome(0, false)).toBe('none');
    expect(signerSheetCloseOutcome(0, true)).toBe('none');
  });

  it('dismiss with remaining requests → defer + toast', () => {
    expect(signerSheetCloseOutcome(3, false)).toBe('defer-toast');
  });

  it('View All close → defer silently', () => {
    expect(signerSheetCloseOutcome(3, true)).toBe('defer-silent');
  });
});

describe('defer-toast suppression handshake', () => {
  it('is one-shot', () => {
    expect(consumeSignerDeferToastSuppression()).toBe(false);
    suppressSignerDeferToastOnce();
    expect(consumeSignerDeferToastSuppression()).toBe(true);
    expect(consumeSignerDeferToastSuppression()).toBe(false);
  });
});
