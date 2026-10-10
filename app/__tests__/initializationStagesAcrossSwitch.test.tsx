/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  InitializationProvider,
  useInitializationReset,
  useInitializationStage,
  useInitializationState,
} from '@/shared/providers/InitializationProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
}));

type Probe = {
  reset: ReturnType<typeof useInitializationReset>;
  migrations: ReturnType<typeof useInitializationStage>;
  keys: ReturnType<typeof useInitializationStage> | null;
  isInitializing: boolean;
};
let probe: Partial<Probe> = {};

beforeEach(() => {
  probe = {};
});

/** Mounted above the account providers: never unmounts, never registers twice. */
function Above({ children }: { children: React.ReactNode }) {
  const migrations = useInitializationStage('global-migrations', { outlivesAccount: true });
  const reset = useInitializationReset();
  const { isInitializing } = useInitializationState();
  probe = { ...probe, migrations, reset, isInitializing };
  return <>{children}</>;
}

/** An account provider: remounts on a switch and registers again. */
function Account() {
  const keys = useInitializationStage('nostr', { dependsOn: ['global-migrations'] });
  probe = { ...probe, keys };
  return null;
}

function tree(account: number) {
  return (
    <InitializationProvider>
      <Above>
        <Account key={account} />
      </Above>
    </InitializationProvider>
  );
}

it('lets account stages start again after an in-process switch', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(tree(0));
  });
  act(() => probe.migrations!.complete());
  act(() => probe.keys!.complete());
  expect(probe.isInitializing).toBe(false);

  // The switch keeps the gate above the account providers and remounts below it.
  act(() => probe.reset!.resetStages({ keepStagesThatOutliveAccount: true }));
  act(() => renderer!.update(tree(1)));

  // The migration gate did not register again, yet its dependant can start.
  expect(probe.keys!.canStart).toBe(true);
  act(() => probe.keys!.complete());
  act(() => probe.reset!.cancelResetStages());
  expect(probe.isInitializing).toBe(false);
  act(() => renderer!.unmount());
});

it('drops every stage on a reset that expects a restart', () => {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(tree(0));
  });
  act(() => probe.migrations!.complete());

  act(() => probe.reset!.resetStages());
  act(() => renderer!.update(tree(1)));

  // Nothing above the boundary registers again without a restart, so the
  // dependant waits: this is the state a restart is what clears.
  expect(probe.keys!.canStart).toBe(false);
  act(() => renderer!.unmount());
});
