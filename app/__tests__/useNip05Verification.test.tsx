/** @jest-environment node */
import { AppState } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { verifyNip05, type Nip05Verification } from 'wallet';
import { useNip05Verification, type Nip05State } from '@/shared/hooks/useNip05Verification';

jest.mock('wallet', () => ({ ...jest.requireActual('wallet'), verifyNip05: jest.fn() }));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: { mockMode: boolean }) => unknown) =>
    select({ mockMode: false }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let renderer: TestRenderer.ReactTestRenderer;
let state: Nip05State;
function Probe({ address, pubkey }: { address: string; pubkey: string }) {
  state = useNip05Verification(address, pubkey).state;
  return null;
}
beforeEach(() => {
  jest.useFakeTimers();
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
});
afterEach(() => {
  act(() => renderer?.unmount());
  jest.useRealTimers();
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

it('never flashes a previous recipient check after the selected key changes', async () => {
  jest
    .mocked(verifyNip05)
    .mockResolvedValue({ status: 'verified', identifier: 'alice@hook.example' });
  await act(async () => {
    renderer = TestRenderer.create(<Probe address="alice@hook.example" pubkey={'a'.repeat(64)} />);
  });
  expect(state.status).toBe('pending');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  expect(state.status).toBe('verified');
  let finish: (value: Nip05Verification) => void = () => {};
  jest.mocked(verifyNip05).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  act(() => renderer.update(<Probe address="alice@hook.example" pubkey={'b'.repeat(64)} />));
  expect(state.status).toBe('pending');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  await act(async () => {
    finish({ status: 'mismatch', identifier: 'alice@hook.example' });
  });
  expect(state.status).toBe('mismatch');
});

it('discards late results for a changed identifier', async () => {
  let finish: (value: Nip05Verification) => void = () => {};
  jest.mocked(verifyNip05).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  await act(async () => {
    renderer = TestRenderer.create(<Probe address="alice@old.example" pubkey={'a'.repeat(64)} />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  act(() => renderer.update(<Probe address="alice@new.example" pubkey={'a'.repeat(64)} />));
  await act(async () => {
    finish({ status: 'verified', identifier: 'alice@old.example' });
  });
  expect(state.status).toBe('pending');
});

describe('a verified result over time', () => {
  const pubkey = 'c'.repeat(64);
  const mountVerified = async (address: string) => {
    jest.mocked(verifyNip05).mockResolvedValue({ status: 'verified', identifier: address });
    await act(async () => {
      renderer = TestRenderer.create(<Probe address={address} pubkey={pubkey} />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    expect(state.status).toBe('verified');
  };

  it('loses its mark at the hard limit even while a refresh is still in flight', async () => {
    await mountVerified('alice@hard-limit.example');
    // The refresh at 15 minutes never answers.
    jest.mocked(verifyNip05).mockReturnValue(new Promise(() => {}));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(900_000);
    });
    expect(state.status).toBe('verified');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2_700_000);
    });
    expect(state.status).toBe('pending');
  });

  it('does not spin re-rendering while the app is in the background', async () => {
    await mountVerified('alice@background.example');
    let renders = 0;
    function Counting() {
      renders += 1;
      state = useNip05Verification('alice@background.example', pubkey).state;
      return null;
    }
    expect(verifyNip05).toHaveBeenCalledTimes(1);
    act(() => renderer.update(<Counting />));
    expect(verifyNip05).toHaveBeenCalledTimes(1);
    // `currentState` is a getter here: assigning to it does nothing.
    jest.spyOn(AppState, 'currentState', 'get').mockReturnValue('background');
    expect(AppState.currentState).toBe('background');
    renders = 0;
    await act(async () => {
      // Past the stale time by a minute, well short of hard expiry.
      await jest.advanceTimersByTimeAsync(899_000);
    });
    expect(verifyNip05).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(61_000);
    });
    expect(renders).toBeLessThanOrEqual(2);
    expect(verifyNip05).toHaveBeenCalledTimes(1);
  });
});

it('asks again when the shared queue was too busy to check', async () => {
  const pubkey = 'd'.repeat(64);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.mocked(verifyNip05).mockImplementation(async (identifier) => {
    await gate;
    return { status: 'verified', identifier };
  });
  const { checkNip05Identity } = jest.requireActual<
    typeof import('@/shared/lib/nostr/profile/nip05Verification')
  >('@/shared/lib/nostr/profile/nip05Verification');
  const busy = Array.from({ length: 64 }, (_, i) =>
    checkNip05Identity(`busy${i}@saturated.example`, pubkey)
  );
  await act(async () => {
    renderer = TestRenderer.create(<Probe address="late@saturated.example" pubkey={pubkey} />);
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(400);
  });
  expect(state.status).toBe('pending');

  release();
  await act(async () => {
    await Promise.all(busy);
    await jest.advanceTimersByTimeAsync(5_000);
  });
  expect(state.status).toBe('verified');
});

describe('when the shared queue is saturated', () => {
  const pubkey = 'e'.repeat(64);
  const saturate = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    jest.mocked(verifyNip05).mockImplementation(async (identifier) => {
      await gate;
      return { status: 'verified', identifier };
    });
    const { checkNip05Identity } = jest.requireActual<
      typeof import('@/shared/lib/nostr/profile/nip05Verification')
    >('@/shared/lib/nostr/profile/nip05Verification');
    const busy = Array.from({ length: 64 }, (_, i) =>
      checkNip05Identity(`busy${i}-${Math.random()}@full.example`, pubkey)
    );
    return { release, busy };
  };

  it('backs off on a stale result it cannot refresh', async () => {
    const address = 'alice@stale-busy.example';
    jest.mocked(verifyNip05).mockResolvedValue({ status: 'verified', identifier: address });
    let renders = 0;
    function Counting() {
      renders += 1;
      state = useNip05Verification(address, pubkey).state;
      return null;
    }
    await act(async () => {
      renderer = TestRenderer.create(<Counting />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    expect(state.status).toBe('verified');
    // Go stale with every slot taken.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(899_000);
    });
    const { release, busy } = saturate();
    renders = 0;
    await act(async () => {
      await jest.advanceTimersByTimeAsync(4_000);
    });
    // One attempt and its back-off, not a render per millisecond.
    expect(renders).toBeLessThanOrEqual(3);
    expect(state.status).toBe('verified');
    release();
    await act(async () => {
      await Promise.all(busy);
    });
  });

  it('stops asking once the row is gone', async () => {
    const { release, busy } = saturate();
    await act(async () => {
      renderer = TestRenderer.create(<Probe address="gone@unmounted.example" pubkey={pubkey} />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(400);
    });
    act(() => renderer.unmount());
    release();
    await act(async () => {
      await Promise.all(busy);
    });
    const asked = () =>
      jest.mocked(verifyNip05).mock.calls.filter(([id]) => id === 'gone@unmounted.example').length;
    const before = asked();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });
    expect(asked()).toBe(before);
    expect(jest.getTimerCount()).toBe(0);
  });
});
