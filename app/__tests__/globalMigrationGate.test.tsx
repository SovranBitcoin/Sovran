/**
 * @jest-environment node
 *
 * The migration gate (`GlobalMigrationGate`): the migrations and the store
 * load run first, then profile-scoped storage is opened, then the app below
 * mounts. A failed run opens nothing and shows the storage retry screen; a
 * retry that succeeds opens storage once. Its stage blocks the splash and
 * survives an in-process account switch.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import GlobalMigrationGate from '@/shared/blocks/GlobalMigrationGate';
import {
  InitializationProvider,
  useInitializationReset,
  useInitializationState,
} from '@/shared/providers/InitializationProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockEvents: string[] = [];
const mockMigrate = jest.fn<Promise<void>, []>();
jest.mock('@/shared/lib/migrations/migrateThenLoad', () => ({
  migrateThenLoad: () => mockMigrate(),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  signalMigrationsComplete: () => mockEvents.push('storage opened'),
}));
jest.mock('@/shared/blocks/StartupFailedScreen', () => ({
  StartupFailedScreen: (props: { step: string; onRetry: () => void }) =>
    jest.requireActual<typeof import('react')>('react').createElement('Failed', props),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  useLifecycleLogger: jest.fn(),
  Log: ({ children }: { children: React.ReactNode }) => children,
}));

let state: ReturnType<typeof useInitializationState>;
let reset: ReturnType<typeof useInitializationReset>;
function Probe() {
  state = useInitializationState();
  reset = useInitializationReset();
  return null;
}
function App() {
  mockEvents.push('app mounted');
  return 'app';
}

let renderer: TestRenderer.ReactTestRenderer;
async function render() {
  await act(async () => {
    renderer = TestRenderer.create(
      <InitializationProvider>
        <Probe />
        <GlobalMigrationGate>
          <App />
        </GlobalMigrationGate>
      </InitializationProvider>
    );
  });
}
const failed = () => renderer.root.findAllByType('Failed' as never);

beforeEach(() => {
  mockEvents.length = 0;
  mockMigrate.mockReset();
});
afterEach(() => {
  act(() => renderer?.unmount());
});

it('migrates, then opens storage, then mounts the app, and lets the splash go', async () => {
  let finish!: () => void;
  mockMigrate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        mockEvents.push('migrating');
        finish = resolve;
      })
  );
  await render();

  expect(state.isInitializing).toBe(true);
  expect(mockEvents).toEqual(['migrating']);

  await act(async () => finish());

  expect(mockEvents).toEqual(['migrating', 'storage opened', 'app mounted']);
  expect(state).toEqual({ isInitializing: false, hasFailedStage: false });
  expect(mockMigrate).toHaveBeenCalledTimes(1);
});

it('on failure opens nothing and shows the storage retry; a retry that succeeds opens storage once', async () => {
  mockMigrate.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce(undefined);
  await render();

  expect(failed().map((f) => f.props.step)).toEqual(['storage']);
  expect(mockEvents).toEqual([]);
  expect(state.hasFailedStage).toBe(true);

  await act(async () => failed()[0]!.props.onRetry());

  expect(mockMigrate).toHaveBeenCalledTimes(2);
  expect(mockEvents).toEqual(['storage opened', 'app mounted']);
  expect(failed()).toHaveLength(0);
  expect(state).toEqual({ isInitializing: false, hasFailedStage: false });
});

it('a retry under way clears the failed stage before the run settles', async () => {
  let finish!: () => void;
  mockMigrate
    .mockRejectedValueOnce(new Error('disk full'))
    .mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
  await render();
  expect(state.hasFailedStage).toBe(true);

  await act(async () => failed()[0]!.props.onRetry());

  expect(state).toEqual({ isInitializing: true, hasFailedStage: false });
  expect(renderer.toJSON()).toBeNull();
  await act(async () => finish());
});

it('keeps its completed stage through an in-process switch reset, and does not run again', async () => {
  mockMigrate.mockResolvedValue(undefined);
  await render();

  act(() => reset.resetStages({ keepStagesThatOutliveAccount: true }));

  expect(state.isInitializing).toBe(false);
  expect(mockMigrate).toHaveBeenCalledTimes(1);
});
