/**
 * @jest-environment node
 *
 * `threadFixedItemSize` feeds LegendList deterministic heights for the
 * content-free skeleton / sort-tabs rows so they don't snap from the generic
 * estimate on first paint. Dynamic rows (target, replies) stay unmeasured.
 */

import {
  REPLY_SORT_TABS_FIXED_HEIGHT,
  TARGET_SKELETON_FIXED_HEIGHT,
  threadFixedItemSize,
} from '@/features/feed/lib/threadListLayout';

describe('threadFixedItemSize', () => {
  it('reserves the fixed sort-tabs height for the reply-sort-tabs row', () => {
    expect(threadFixedItemSize({ type: 'reply-sort-tabs' })).toBe(REPLY_SORT_TABS_FIXED_HEIGHT);
  });

  it('reserves the fixed target-skeleton height', () => {
    expect(threadFixedItemSize({ type: 'target-skeleton' })).toBe(TARGET_SKELETON_FIXED_HEIGHT);
  });

  it('returns a finite, positive height for a reply-skeleton', () => {
    const height = threadFixedItemSize({ type: 'reply-skeleton', skeletonIndex: 0 });
    expect(typeof height).toBe('number');
    expect(height).toBeGreaterThan(0);
  });

  it('leaves dynamic rows (target, replies) unmeasured so LegendList measures them', () => {
    expect(threadFixedItemSize({ type: 'target' })).toBeUndefined();
    expect(threadFixedItemSize({ type: 'reply' })).toBeUndefined();
  });
});
