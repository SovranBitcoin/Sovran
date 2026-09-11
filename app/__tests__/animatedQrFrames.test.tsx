/** @jest-environment node */
import { Buffer } from 'buffer';
import { useLayoutEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Platform } from 'react-native';
import { URDecoder, UREncoder } from '@gandlaf21/bc-ur';
import { useAnimatedQrFrames } from '@/shared/hooks/useAnimatedQrFrames';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let mockFocused = true;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    ReactActual.useEffect(() => (mockFocused ? effect() : undefined), [effect, mockFocused]);
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), error: jest.fn() },
}));

type FrameOptions = Parameters<typeof useAnimatedQrFrames>[0];
type Frames = ReturnType<typeof useAnimatedQrFrames>;
const ADDRESS_A = 'cashuA' + 'a'.repeat(700);
const ADDRESS_B = 'cashuB' + 'b'.repeat(500);
let commits: Frames[];
let options: FrameOptions;
let renderer: TestRenderer.ReactTestRenderer;
let listeners: Map<string, (...args: never[]) => void>;
function Probe(props: FrameOptions) {
  const frames = useAnimatedQrFrames(props);
  useLayoutEffect(() => {
    commits.push(frames);
  });
  return null;
}
function update(patch: Partial<FrameOptions> = {}) {
  options = { ...options, ...patch };
  act(() => renderer.update(<Probe {...options} />));
}
function last() {
  return commits[commits.length - 1];
}
function emit(event: string, value?: string) {
  act(() => {
    const listener = listeners.get(event) as ((state?: string) => void) | undefined;
    listener?.(value);
  });
}

describe.each(['ios', 'android'] as const)('%s QR lifecycle', (platform) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', platform);
    jest.useFakeTimers();
    commits = [];
    listeners = new Map();
    mockFocused = true;
    AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((event, listener) => {
      if (platform === 'ios' && (event === 'focus' || event === 'blur')) {
        throw new Error('RCTAppState does not support appStateFocusChange');
      }
      listeners.set(event, listener);
      return {
        remove: () => {
          listeners.delete(event);
        },
      };
    });
    options = { address: ADDRESS_A, animated: true, fragmentSize: 150, intervalMs: 200 };
    act(() => {
      renderer = TestRenderer.create(<Probe {...options} />);
    });
  });
  afterEach(() => {
    act(() => renderer.unmount());
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('round-trips real UR fragments to the exact original payload', () => {
    const decoder = new URDecoder();
    for (const part of last().parts) decoder.receivePart(part);
    expect(decoder.isComplete()).toBe(true);
    expect(Buffer.from(decoder.resultUR().decodeCBOR()).toString()).toBe(ADDRESS_A);
  });

  it('never commits a previous payload frame after the address changes or clears', () => {
    const previousParts = last().parts;
    commits = [];
    update({ address: ADDRESS_B });
    expect(commits.every((frame) => !previousParts.includes(frame.qrData ?? ''))).toBe(true);
    const decoder = new URDecoder();
    last().parts.forEach((part) => decoder.receivePart(part));
    expect(Buffer.from(decoder.resultUR().decodeCBOR()).toString()).toBe(ADDRESS_B);
    commits = [];
    update({ address: '' });
    expect(commits.every((frame) => !frame.qrData)).toBe(true);
  });

  it('cycles without repeating UR encoding, pauses in background and on Android blur, and resumes', () => {
    const encode = jest.spyOn(UREncoder.prototype, 'encodeWhole');
    const first = last().qrData;
    act(() => jest.advanceTimersByTime(200));
    expect(last().qrData).not.toBe(first);
    expect(encode).not.toHaveBeenCalled();
    for (const [pause, resume, state, resumedState] of [
      ['change', 'change', 'background', 'active'],
      ['change', 'change', 'inactive', 'active'],
      ...(platform === 'android' ? [['blur', 'focus', undefined, undefined]] : []),
    ]) {
      emit(pause!, state);
      const count = commits.length;
      expect(jest.getTimerCount()).toBe(0);
      act(() => jest.advanceTimersByTime(2000));
      expect(commits).toHaveLength(count);
      emit(resume!, resumedState);
      expect(jest.getTimerCount()).toBe(1);
      act(() => jest.advanceTimersByTime(200));
      expect(commits.length).toBeGreaterThan(count);
    }
  });

  it('stops timers and subscriptions on route blur and restores one timer on focus', () => {
    mockFocused = false;
    update();
    expect(jest.getTimerCount()).toBe(0);
    expect(listeners.size).toBe(0);
    mockFocused = true;
    update();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('uses a static address immediately and does not encode or cycle', () => {
    const encode = jest.spyOn(UREncoder.prototype, 'encodeWhole');
    commits = [];
    update({ animated: false, address: 'lnbc-test' });
    expect(commits.every((frame) => frame.qrData === 'lnbc-test')).toBe(true);
    expect(encode).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('replaces density fragments without committing an old frame or out-of-range index', () => {
    act(() => jest.advanceTimersByTime(800));
    const oldParts = last().parts;
    commits = [];
    update({ fragmentSize: 500 });
    expect(commits.every((frame) => !oldParts.includes(frame.qrData ?? ''))).toBe(true);
    expect(last().qrData).toBe(last().parts[0]);
  });

  it.each([50, 100, 150])(
    'preserves UTF-8 bytes at the %i-byte fragment preset',
    (fragmentSize) => {
      const address = 'QR fixture: café 日本語 🟠 '.repeat(30);
      update({ address, fragmentSize });
      const decoder = new URDecoder();
      for (const part of last().parts) {
        expect(part.length).toBeLessThan(2000);
        decoder.receivePart(part);
      }
      expect(decoder.isComplete()).toBe(true);
      expect(Buffer.from(decoder.resultUR().decodeCBOR()).toString()).toBe(address);
    }
  );

  it('does not retain a scannable old payload after an encoding failure and can recover', () => {
    const encode = jest.spyOn(UREncoder.prototype, 'encodeWhole').mockImplementationOnce(() => {
      throw new Error('fixture encoding failure');
    });
    commits = [];
    update({ address: ADDRESS_B });
    expect(commits.every((frame) => !frame.qrData)).toBe(true);
    expect(last().encodingError).toBe('fixture encoding failure');
    expect(last().encodingPending).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    encode.mockRestore();
    update({ fragmentSize: 100 });
    expect(last().encodingError).toBeNull();
    expect(last().qrData).toBeTruthy();
    expect(jest.getTimerCount()).toBe(1);
  });

  it('changes playback speed without re-encoding the payload', () => {
    const encode = jest.spyOn(UREncoder.prototype, 'encodeWhole');
    const parts = last().parts;
    update({ intervalMs: 400 });
    expect(last().parts).toBe(parts);
    const first = last().qrData;
    act(() => jest.advanceTimersByTime(399));
    expect(last().qrData).toBe(first);
    act(() => jest.advanceTimersByTime(1));
    expect(last().qrData).not.toBe(first);
    expect(encode).not.toHaveBeenCalled();
  });
});
