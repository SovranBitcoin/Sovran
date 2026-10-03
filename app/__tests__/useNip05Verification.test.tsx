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
