import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, renderHook } from '@testing-library/react-native';

import { setBootMorphCompleted, setBootSplashHandoff } from '@/shared/lib/qrButtonAnchor';
import { useQRButtonReveal } from '@/shared/ui/composed/QRButton/useQRButtonReveal';

const BOOT_MORPH_FAILSAFE_MS = 1500;

describe('useQRButtonReveal', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setBootMorphCompleted(false);
    setBootSplashHandoff(false);
  });

  afterEach(() => {
    jest.useRealTimers();
    setBootMorphCompleted(false);
    setBootSplashHandoff(false);
  });

  it('hides the button pre-morph WITH the opacity transition attached', () => {
    const { result } = renderHook(() => useQRButtonReveal());
    // The transition props are the self-heal contract: opacity must be a
    // committed React prop animated declaratively, so a dropped UI-thread
    // tick can never strand the button at a stale mid-fade value.
    expect(result.current.opacity).toBe(0);
    expect(result.current.transitionProperty).toContain('opacity');
  });

  it('reveals the moment the splash handoff starts (under the opaque overlay)', () => {
    // The overlay's geometry tween covers the button rect for its whole run,
    // so revealing at handoff is invisible — and it makes the final swap
    // independent of the gate's JS completion timer, which fires late on a
    // congested boot thread.
    const { result } = renderHook(() => useQRButtonReveal());
    act(() => setBootSplashHandoff(true));
    expect(result.current.opacity).toBe(1);
    expect(result.current.transitionProperty).toContain('opacity');
  });

  it('reveals when the boot morph completes', () => {
    const { result } = renderHook(() => useQRButtonReveal());
    act(() => setBootMorphCompleted(true));
    expect(result.current.opacity).toBe(1);
    expect(result.current.transitionProperty).toContain('opacity');
  });

  it('reveals via the failsafe when the morph never completes', () => {
    const { result } = renderHook(() => useQRButtonReveal());
    act(() => jest.advanceTimersByTime(BOOT_MORPH_FAILSAFE_MS));
    expect(result.current.opacity).toBe(1);
  });

  it('re-hides and re-arms the failsafe on a profile-switch morph reset', () => {
    const { result } = renderHook(() => useQRButtonReveal());
    act(() => setBootMorphCompleted(true));
    expect(result.current.opacity).toBe(1);

    act(() => setBootMorphCompleted(false));
    expect(result.current.opacity).toBe(0);

    act(() => jest.advanceTimersByTime(BOOT_MORPH_FAILSAFE_MS));
    expect(result.current.opacity).toBe(1);
  });

  it('never reintroduces the clobberable shared-value fade idiom', () => {
    // A withTiming-driven reveal settled into a static style is exactly the
    // idiom that stranded the button dim (Fabric prop diff no-op against a
    // JS-side style already claiming opacity 1). Pin the declarative CSS
    // transition instead.
    const source = readFileSync(
      join(__dirname, '../shared/ui/composed/QRButton/useQRButtonReveal.ts'),
      'utf8'
    );
    // Guard the code, not the prose — the docblock legitimately names the
    // old idiom when explaining why it was removed.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toContain('transitionProperty');
    expect(code).not.toContain('withTiming');
    expect(code).not.toContain('useSharedValue');
  });
});
