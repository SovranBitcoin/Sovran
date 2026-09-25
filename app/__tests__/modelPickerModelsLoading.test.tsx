/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-require-imports -- `refreshRoutstrLineup` keeps its throttle in module scope, so each case needs its own copy of the module. */

/**
 * "Models loading" has to end.
 *
 * The picker's fallback chain is `session lineup → persisted snapshot →
 * "models loading"`, and a device log caught it stalling on the last rung with
 * a catalog already in hand: the user pinned a provider (which clears the
 * lineup, the snapshot and the model cache), that node answered with ten
 * models of which zero qualified, and `setCachedModels` committed the empty
 * derivation as the live lineup. An empty lineup is a truthy object, so it
 * shadowed the snapshot fallback; the model cache was stamped fresh in the
 * same write, so the app's sole catalog fetcher had no reason to ask again.
 * The picker was opened three times in seven seconds and showed "Models
 * loading" on every tab each time.
 *
 * These tests pin the three halves of the repair: the store must not let a
 * catalog that qualifies nothing replace a menu that works, the picker must
 * not promise that something is coming once a catalog has answered, and a
 * failed lineup refresh must not bank a whole day of silence.
 */

import React from 'react';
import { ok, err } from 'neverthrow';
import TestRenderer, { act } from 'react-test-renderer';

import type { RoutstrModel } from '@/shared/lib/routstr/api';

import { ModelPickerContent } from '@/shared/lib/popup/popups/modelPicker';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockGetAiLineup = jest.fn();

jest.mock('@/shared/lib/apiClient', () => ({
  getAiLineup: (...args: unknown[]) => mockGetAiLineup(...args),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({ activeAccountIndex: 0, profiles: [{ accountIndex: 0 }] }),
  },
}));
// The routstr request path belongs to other tests; only the two values the
// store and the pricing helpers read from it matter here.
jest.mock('@/shared/lib/routstr/api', () => ({
  setRoutstrNodeBaseUrl: jest.fn(),
  ROUTSTR_MAX_COMPLETION_TOKENS: 4096,
}));
jest.mock('@/shared/lib/routstr/securePersistence', () => ({
  createRoutstrPersistence: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/routstr/secureVault', () => ({
  createSecureVault: () => ({ read: async () => null, write: async () => {} }),
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const entry = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: entry,
    aiLog: entry,
    storeLog: entry,
    log: { ...entry, child: () => entry },
    useMountLog: () => {},
    applyFileLogging: jest.fn(),
    redactError: (error: unknown) => error,
  };
});
jest.mock('@/shared/lib/http/requestSignal', () => ({ buildAbortSignal: () => undefined }));

// Render-side stand-ins. The picker's chrome (heroui rows, icons, theme
// tokens, the popup host) is not what is under test — the copy in the row it
// falls back to is.
jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(name, props, children);
  const text = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement('Text', null, children);
  const Menu = Object.assign(host('Menu'), {
    Item: host('MenuItem'),
    ItemTitle: text,
    ItemDescription: text,
  });
  return { Menu, BottomSheet: { Title: text } };
});
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => {
  // Any real token will do; `withAlpha` rejects a non-hex stand-in.
  const { INVARIANT_BLACK } = jest.requireActual<typeof import('@/shared/lib/brandColors')>(
    '@/shared/lib/brandColors'
  );
  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => INVARIANT_BLACK) : INVARIANT_BLACK,
  };
});
jest.mock('@/shared/stores/runtime/popupStore', () => ({
  usePopupStore: (selector: (s: unknown) => unknown) => selector({ openSeq: 1 }),
}));
jest.mock('@/shared/lib/popup/popups/bridge', () => ({ showActionSheet: jest.fn() }));
jest.mock('@/shared/lib/popup/popups', () => ({ paramPopup: jest.fn() }));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({
  E2EActionMenuRenderMarker: () => null,
  E2EActionMenuTargetMarker: () => null,
}));

const NODE = 'https://node.example';
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

/** A catalog row the lineup accepts: enabled, priced, text-out, wide enough.
 *  `rate` orders the tier ladder — the cheapest turn is Auto. */
const usable = (id: string, name: string, rate: number): RoutstrModel =>
  ({
    id,
    name,
    canonical_slug: `openai/${id}`,
    enabled: true,
    context_length: 128_000,
    created: 1_780_000_000,
    architecture: { output_modalities: ['text'], input_modalities: ['text'] },
    sats_pricing: {
      prompt: rate,
      completion: rate * 4,
      request: 0,
      image: 0,
      max_cost: 40,
    },
  }) as unknown as RoutstrModel;

/**
 * A catalog row the lineup rejects. The vendor is recognised and the row is
 * well formed — it simply produces embeddings, so nothing can be offered from
 * it. That is the shape of the node the device log caught: a real catalog, ten
 * rows, zero of them a chat model.
 */
const unusable = (id: string): RoutstrModel =>
  ({
    id,
    name: `OpenAI: ${id}`,
    canonical_slug: `openai/${id}`,
    enabled: true,
    context_length: 128_000,
    created: 1_780_000_000,
    architecture: { output_modalities: ['embeddings'], input_modalities: ['text'] },
    sats_pricing: { prompt: 0.00001, completion: 0.00004, request: 0, image: 0, max_cost: 40 },
  }) as unknown as RoutstrModel;

const WORKING_CATALOG = [
  usable('gpt-5-mini', 'OpenAI: GPT-5 mini', 0.00001),
  usable('gpt-5', 'OpenAI: GPT-5', 0.0001),
];
const DEGRADED_CATALOG = Array.from({ length: 10 }, (_, i) => unusable(`text-embedding-${i}`));

/** Everything the open picker puts on screen, as one searchable string. */
function pickerCopy(): string {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <ModelPickerContent
        payload={{}}
        balanceSats={10_000}
        close={() => {}}
        pushCustomPage={() => {}}
        popCustomPage={() => {}}
        canPop={false}
        setFooterConfig={() => {}}
      />
    );
  });
  const rendered = JSON.stringify(tree.toJSON());
  act(() => tree.unmount());
  return rendered;
}

describe('the model picker always resolves its loading state', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    useRoutstrStore.setState({
      lineup: null,
      lastKnownLineup: null,
      modelsCache: null,
      serverLineupAt: null,
      nodeBaseUrl: NODE,
      userNodeBaseUrl: NODE,
      selectedProvider: 'openai',
      selectedTier: 'auto',
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('still says "Models loading" before any catalog has answered', () => {
    expect(pickerCopy()).toContain('Models loading');
  });

  it('stops saying "Models loading" once a catalog answers with nothing usable', () => {
    useRoutstrStore.getState().setCachedModels(DEGRADED_CATALOG);
    const copy = pickerCopy();
    expect(copy).not.toContain('Models loading');
    // The row has to be an answer the user can act on, and name what it is an
    // answer about: this node replied, with this many models, none offerable.
    expect(copy).toContain('10 models');
    expect(copy).toContain('choose a different provider');
  });

  it('keeps a working menu when the next catalog read qualifies nothing', () => {
    useRoutstrStore.getState().setCachedModels(WORKING_CATALOG);
    const working = useRoutstrStore.getState().lineup;
    expect(working?.openai.auto?.modelId).toBe('gpt-5-mini');

    // A snapshot recorded against a different node is the case with nothing to
    // substitute from — `setServerLineup` files a pinned provider's snapshot
    // under the pinned url while `nodeBaseUrl` still names nagg's, so the two
    // disagree routinely. The degraded read then derives an empty lineup with
    // no fallback behind it, which is what used to overwrite a working menu.
    useRoutstrStore.setState({
      lastKnownLineup: { derivedAt: NOW, lineup: working!, nodeBaseUrl: 'https://other.example' },
    });

    // The same node, seconds later, answering with a degraded catalog — the
    // 582-then-10 swing the device log recorded twice in four minutes.
    useRoutstrStore.getState().setCachedModels(DEGRADED_CATALOG);
    expect(useRoutstrStore.getState().lineup?.openai.auto?.modelId).toBe('gpt-5-mini');
    expect(pickerCopy()).not.toContain('Models loading');
  });

  it('falls through an empty session lineup to the persisted snapshot', () => {
    useRoutstrStore.getState().setCachedModels(WORKING_CATALOG);
    const snapshot = useRoutstrStore.getState().lastKnownLineup;
    // An empty lineup is truthy, so the old `??` chain stopped at it and never
    // reached the snapshot sitting right behind it.
    useRoutstrStore.setState({ lineup: {} });
    expect(snapshot?.lineup.openai.auto?.modelId).toBe('gpt-5-mini');
    expect(pickerCopy()).toContain('GPT-5 mini');
  });

  it('derives a menu when a persisted server timestamp outlives its session-only lineup', () => {
    // `serverLineupAt` is persisted; `lineup` is not. A cold start therefore
    // holds a day-fresh timestamp and no lineup at all — and the foreground
    // refresh skips a timestamp that young, so deferring to it here vetoed the
    // only other source of a menu for a full day.
    useRoutstrStore.setState({ serverLineupAt: NOW - 60_000 });
    useRoutstrStore.getState().setCachedModels(WORKING_CATALOG);
    expect(useRoutstrStore.getState().lineup?.openai.auto?.modelId).toBe('gpt-5-mini');
    expect(pickerCopy()).not.toContain('Models loading');
  });
});

/**
 * `refreshRoutstrLineup` keeps its throttle in module scope, so each case gets
 * its own copy of the module (and of the store it writes to).
 */
function loadRefresh(): (reason?: 'foreground' | 'failure') => Promise<boolean> {
  let refresh!: typeof import('@/shared/lib/routstr/refreshLineup').refreshRoutstrLineup;
  jest.isolateModules(() => {
    refresh = (
      require('@/shared/lib/routstr/refreshLineup') as typeof import('@/shared/lib/routstr/refreshLineup')
    ).refreshRoutstrLineup;
  });
  return refresh;
}

const LINEUP_PAYLOAD = {
  version: 1,
  updatedAt: NOW,
  node: { baseUrl: NODE, authMode: 'bearer' as const, fallbackUsed: false },
  providers: [
    {
      id: 'openai',
      vendor: 'openai',
      models: [
        {
          tier: 'auto' as const,
          id: 'gpt-5-mini',
          name: 'GPT-5 mini',
          inputModalities: ['text'],
          pricing: { maxCost: 40 },
        },
      ],
    },
  ],
};

describe('a failed lineup refresh does not bank a day of silence', () => {
  beforeEach(() => {
    mockGetAiLineup.mockReset();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => jest.restoreAllMocks());

  it('retries in minutes after a failure, not tomorrow', async () => {
    const refresh = loadRefresh();
    mockGetAiLineup.mockResolvedValue(err(new Error('offline')));
    expect(await refresh()).toBe(false);
    expect(mockGetAiLineup).toHaveBeenCalledTimes(1);

    // Still inside the failure window: one attempt, not a storm.
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
    expect(await refresh()).toBe(false);
    expect(mockGetAiLineup).toHaveBeenCalledTimes(1);

    // Past it, and far short of a day. The old rule wrote the daily window
    // before the request and left it there on failure, so a launch that came
    // up with no lineup had nothing to recover with until tomorrow.
    const retryAt = NOW + 6 * 60_000;
    expect(retryAt - NOW).toBeLessThan(DAY_MS);
    jest.spyOn(Date, 'now').mockReturnValue(retryAt);
    expect(await refresh()).toBe(false);
    expect(mockGetAiLineup).toHaveBeenCalledTimes(2);
  });

  it('spends the daily window only on a refresh that answered', async () => {
    const refresh = loadRefresh();
    mockGetAiLineup.mockResolvedValue(ok(LINEUP_PAYLOAD));
    expect(await refresh()).toBe(true);
    jest.spyOn(Date, 'now').mockReturnValue(NOW + 6 * 60_000);
    expect(await refresh()).toBe(false);
    expect(mockGetAiLineup).toHaveBeenCalledTimes(1);
  });
});
