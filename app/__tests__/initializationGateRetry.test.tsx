/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { InitializationGate } from '@/shared/blocks/InitializationGate';
import {
  InitializationProvider,
  useInitializationState,
} from '@/shared/providers/InitializationProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  useLifecycleLogger: jest.fn(),
  Log: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The migration gate depends on this: a failed run must not open what the gate
 * guards, must offer a retry, and a retry that succeeds must open it once.
 */
it('holds its children and the success signal until a retry succeeds', async () => {
  const run = jest
    .fn<Promise<void>, []>()
    .mockRejectedValueOnce(new Error('disk full'))
    .mockResolvedValueOnce(undefined);
  const onSuccess = jest.fn();
  let retry: (() => void) | undefined;

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <InitializationProvider>
        <InitializationGate
          tag="TestGate"
          stageId="test-gate"
          message="working"
          logEvent="gate.test"
          run={run}
          onSuccess={onSuccess}
          renderFailure={(onRetry) => {
            retry = onRetry;
            return 'failed';
          }}>
          opened
        </InitializationGate>
      </InitializationProvider>
    );
  });

  expect(renderer.toJSON()).toBe('failed');
  expect(onSuccess).not.toHaveBeenCalled();
  expect(run).toHaveBeenCalledTimes(1);

  await act(async () => {
    retry?.();
  });

  expect(run).toHaveBeenCalledTimes(2);
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(renderer.toJSON()).toBe('opened');
});

it('renders nothing on failure when no failure screen is given', async () => {
  const onSuccess = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <InitializationProvider>
        <InitializationGate
          tag="TestGate"
          stageId="test-gate"
          message="working"
          logEvent="gate.test"
          run={() => Promise.reject(new Error('no'))}
          onSuccess={onSuccess}>
          opened
        </InitializationGate>
      </InitializationProvider>
    );
  });

  expect(renderer.toJSON()).toBeNull();
  expect(onSuccess).not.toHaveBeenCalled();
});

it('reports a failed blocking stage, and clears it when a retry is under way', async () => {
  // The boot splash fades as soon as this is true, so the failure screen is
  // not left behind it.
  const run = jest
    .fn<Promise<void>, []>()
    .mockRejectedValueOnce(new Error('disk full'))
    .mockResolvedValueOnce(undefined);
  let retry: (() => void) | undefined;
  const seen: boolean[] = [];
  function Probe() {
    seen.push(useInitializationState().hasFailedStage);
    return null;
  }

  await act(async () => {
    TestRenderer.create(
      <InitializationProvider>
        <Probe />
        <InitializationGate
          tag="TestGate"
          stageId="test-gate"
          message="working"
          logEvent="gate.test"
          run={run}
          renderFailure={(onRetry) => {
            retry = onRetry;
            return 'failed';
          }}>
          opened
        </InitializationGate>
      </InitializationProvider>
    );
  });
  expect(seen.at(-1)).toBe(true);

  await act(async () => {
    retry?.();
  });

  expect(seen.at(-1)).toBe(false);
});
