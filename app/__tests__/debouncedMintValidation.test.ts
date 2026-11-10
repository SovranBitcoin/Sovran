/**
 * @jest-environment node
 *
 * `useDebouncedMintValidation`, behind the Add Mint field: what each typed
 * value turns into (idle, checking, valid with the mint's info, invalid with a
 * reason), when the mint's /v1/info is asked and with what, what a stale answer
 * for an older value does, and what clearing, reset and unmount cancel.
 *
 * The real hook and URL normalizer run with fake timers. `fetchMintInfo` (the
 * app's own /v1/info client) is replaced by deferred answers the test settles.
 */
import { act, renderHook } from '@testing-library/react-native';
import { err, ok, type Result } from 'neverthrow';
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { useDebouncedMintValidation } from '@/features/mint/hooks/useDebouncedMintValidation';

type Answer = Result<GetInfoResponse, Error>;
const mockCalls: { url: string; signal: AbortSignal; settle: (answer: Answer) => void }[] = [];
jest.mock('@/shared/lib/apiClient', () => ({
  fetchMintInfo: (url: string, controls: { signal: AbortSignal }) =>
    new Promise((resolve) => {
      mockCalls.push({ url, signal: controls.signal, settle: resolve });
    }),
}));
jest.mock('@/shared/lib/logger', () => {
  const log: Record<string, unknown> = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const named: Record<string, unknown> = {
    mintUrlLogFields: () => ({}),
    redactError: (e: unknown) => e,
  };
  return new Proxy(named, { get: (target, key: string) => (key in target ? target[key] : log) });
});

function info(name: string): GetInfoResponse {
  const partial = { name };
  return partial as unknown as GetInfoResponse;
}
const infoA = info('Mint A');
const infoB = info('Mint B');
const IDLE = { isValid: null, isLoading: false, error: null };

async function settle(index: number, answer: Answer) {
  await act(async () => {
    mockCalls[index]!.settle(answer);
  });
}
function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

describe('one typed value', () => {
  it('starts idle and asks nothing for an empty or blank value', () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    expect(result.current).toMatchObject({ url: '', validationState: IDLE, mintInfo: null });

    act(() => result.current.setUrl('   '));
    advance(1_000);

    expect(result.current.validationState).toEqual(IDLE);
    expect(mockCalls).toHaveLength(0);
  });

  it('shows checking at once, asks the normalized https URL after 800 ms of quiet, and is valid with the info', async () => {
    const { result } = renderHook(() => useDebouncedMintValidation());

    act(() => result.current.setUrl('Mint.A.com'));
    expect(result.current.url).toBe('Mint.A.com');
    expect(result.current.validationState).toEqual({
      isValid: null,
      isLoading: true,
      error: null,
    });
    advance(799);
    expect(mockCalls).toHaveLength(0);
    advance(1);
    expect(mockCalls.map((c) => c.url)).toEqual(['https://mint.a.com']);

    await settle(0, ok(infoA));

    expect(result.current.validationState).toEqual({
      isValid: true,
      isLoading: false,
      error: null,
    });
    expect(result.current.mintInfo).toBe(infoA);
  });

  it('restarts the wait on every keystroke and asks once, for the last value', () => {
    const { result } = renderHook(() => useDebouncedMintValidation());

    act(() => result.current.setUrl('mint.a'));
    advance(500);
    act(() => result.current.setUrl('mint.a.c'));
    advance(500);
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);

    expect(mockCalls.map((c) => c.url)).toEqual(['https://mint.a.com']);
  });

  it('honours a custom wait', () => {
    const { result } = renderHook(() => useDebouncedMintValidation(200));

    act(() => result.current.setUrl('mint.a.com'));
    advance(200);

    expect(mockCalls).toHaveLength(1);
  });

  it.each([
    ['unreachable', err(new Error('timeout'))],
    ['answering with no info', ok(null as unknown as GetInfoResponse)],
  ])('a mint %s is invalid: not accessible or invalid', async (_, answer) => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);

    await settle(0, answer);

    expect(result.current.validationState).toEqual({
      isValid: false,
      isLoading: false,
      error: 'Mint not accessible or invalid',
    });
    expect(result.current.mintInfo).toBeNull();
  });

  it('a value that is not a URL is invalid without asking anything', () => {
    const { result } = renderHook(() => useDebouncedMintValidation());

    act(() => result.current.setUrl('not a mint'));
    advance(800);

    expect(mockCalls).toHaveLength(0);
    expect(result.current.validationState).toEqual({
      isValid: false,
      isLoading: false,
      error: 'Invalid URL format',
    });
  });
});

describe('a newer value while an older one is being checked', () => {
  it('aborts the older request and ignores its late answer', async () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);
    act(() => result.current.setUrl('mint.b.com'));
    advance(800);

    expect(mockCalls[0]!.signal.aborted).toBe(true);
    expect(mockCalls[1]!.signal.aborted).toBe(false);

    await settle(1, ok(infoB));
    await settle(0, ok(infoA));

    expect(result.current.mintInfo).toBe(infoB);
    expect(result.current.validationState).toEqual({
      isValid: true,
      isLoading: false,
      error: null,
    });
  });

  it('keeps the previous valid result and info while the next value waits and is checked', async () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);
    await settle(0, ok(infoA));

    act(() => result.current.setUrl('mint.a.comx'));
    advance(800);

    // QUIRK (D4): for the wait and the whole request, a different URL reads as
    // valid and carries mint A's info; the screen offers it as a valid mint.
    expect(result.current.url).toBe('mint.a.comx');
    expect(result.current.validationState).toEqual({ isValid: true, isLoading: true, error: null });
    expect(result.current.mintInfo).toBe(infoA);
  });

  it('a value that is not a URL does not abort the request in flight, whose late answer then wins', async () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);
    act(() => result.current.setUrl('not a mint'));
    advance(800);
    expect(result.current.validationState.error).toBe('Invalid URL format');

    await settle(0, ok(infoA));

    // QUIRK (D4): the field holds invalid text but now reads as mint A, valid.
    expect(mockCalls[0]!.signal.aborted).toBe(false);
    expect(result.current.url).toBe('not a mint');
    expect(result.current.validationState).toEqual({
      isValid: true,
      isLoading: false,
      error: null,
    });
    expect(result.current.mintInfo).toBe(infoA);
  });
});

describe('cancelling', () => {
  it('clearing the field aborts the request in flight and returns to idle', async () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);

    act(() => result.current.setUrl(''));
    await settle(0, ok(infoA));

    expect(mockCalls[0]!.signal.aborted).toBe(true);
    expect(result.current).toMatchObject({ url: '', validationState: IDLE, mintInfo: null });
  });

  it('clearing the field during the wait asks nothing', () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(400);
    act(() => result.current.setUrl(''));
    advance(1_000);

    expect(mockCalls).toHaveLength(0);
  });

  it('reset clears the value, the result and the info, and aborts', async () => {
    const { result } = renderHook(() => useDebouncedMintValidation());
    act(() => result.current.setUrl('mint.a.com'));
    advance(800);
    await settle(0, ok(infoA));
    act(() => result.current.setUrl('mint.b.com'));
    advance(800);

    act(() => result.current.reset());
    await settle(1, ok(infoB));

    expect(mockCalls[1]!.signal.aborted).toBe(true);
    expect(result.current).toMatchObject({ url: '', validationState: IDLE, mintInfo: null });
  });

  it('unmount cancels the wait and aborts a request in flight', () => {
    const first = renderHook(() => useDebouncedMintValidation());
    act(() => first.result.current.setUrl('mint.a.com'));
    advance(800);
    first.unmount();
    expect(mockCalls[0]!.signal.aborted).toBe(true);

    const second = renderHook(() => useDebouncedMintValidation());
    act(() => second.result.current.setUrl('mint.b.com'));
    second.unmount();
    advance(1_000);
    expect(mockCalls).toHaveLength(1);
  });
});
