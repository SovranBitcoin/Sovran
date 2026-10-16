/**
 * @jest-environment node
 *
 * The frame-drop sampler is opt-in. Without its env flag, importing the logger
 * must arm nothing — and stopping a sampler that never started must be safe.
 */

import { stopFrameDropMonitor } from '@/shared/lib/logger';

describe('UI-thread frame-drop sampler', () => {
  it('is not armed without EXPO_PUBLIC_FRAME_DROP_MONITOR, and stop is idempotent', () => {
    expect(process.env.EXPO_PUBLIC_FRAME_DROP_MONITOR).toBeUndefined();
    expect(() => stopFrameDropMonitor()).not.toThrow();
    expect(() => stopFrameDropMonitor()).not.toThrow();
  });
});
