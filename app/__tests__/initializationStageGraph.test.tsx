/**
 * @jest-environment node
 *
 * The startup stage graph as the providers register it: migrations first,
 * then keys, then the wallet; Nostr and the wallet's background work wait for
 * the wallet but do not hold the splash; only the migration stage survives an
 * in-process account switch.
 */
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

type Stage = ReturnType<typeof useInitializationStage>;
const stages: Record<string, Stage> = {};
let splashUp = false;
let reset: ReturnType<typeof useInitializationReset>;

/** The stages GlobalMigrationGate, NostrKeysProvider, CocoProvider and NostrNDKProvider register. */
function Providers() {
  stages['global-migrations'] = useInitializationStage('global-migrations');
  stages.nostr = useInitializationStage('nostr');
  stages.coco = useInitializationStage('coco');
  stages['coco-background'] = useInitializationStage('coco-background');
  stages['nostr-ndk'] = useInitializationStage('nostr-ndk');
  splashUp = useInitializationState().isInitializing;
  reset = useInitializationReset();
  return null;
}

const canStart = () =>
  Object.fromEntries(Object.entries(stages).map(([id, s]) => [id, s.canStart]));

let renderer: TestRenderer.ReactTestRenderer;
beforeEach(() => {
  act(() => {
    renderer = TestRenderer.create(
      <InitializationProvider>
        <Providers />
      </InitializationProvider>
    );
  });
});
afterEach(() => {
  act(() => renderer.unmount());
});

it('starts each stage only after the one it waits on, and holds the splash until the wallet is up', () => {
  expect(canStart()).toEqual({
    'global-migrations': true,
    nostr: false,
    coco: false,
    'coco-background': false,
    'nostr-ndk': false,
  });

  act(() => stages['global-migrations']!.complete());
  expect(canStart()).toMatchObject({ nostr: true, coco: false });
  act(() => stages.nostr!.complete());
  expect(canStart()).toMatchObject({ coco: true, 'coco-background': false, 'nostr-ndk': false });
  expect(splashUp).toBe(true);

  act(() => stages.coco!.complete());
  expect(canStart()).toMatchObject({ 'coco-background': true, 'nostr-ndk': true });
  // Background work and Nostr never hold the splash.
  expect(splashUp).toBe(false);
});

it('keeps only the migration stage through an in-process switch reset', () => {
  for (const id of ['global-migrations', 'nostr', 'coco'] as const)
    act(() => stages[id]!.complete());

  act(() => reset.resetStages({ keepStagesThatOutliveAccount: true }));

  // The account stages are gone; the kept migration stage ends the wait.
  expect(splashUp).toBe(false);
  expect(canStart()).toMatchObject({ 'global-migrations': true, nostr: false, coco: false });
});
