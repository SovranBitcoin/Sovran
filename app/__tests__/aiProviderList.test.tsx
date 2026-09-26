/**
 * @jest-environment node
 *
 * Where the AI provider list gets its list from, and what it does when the
 * user reaches for a row.
 *
 * nagg has already swept Nostr, read the HTTP directories and probed every
 * endpoint, so `/app/ai-providers` is the first paint — the picker is
 * populated before the phone's own discovery has finished its first relay
 * round trip. That is a cache, not an oracle: the local sweep keeps running
 * and its findings overrule nagg's, and nagg being down costs the first paint
 * and nothing else.
 *
 * The check on tap is the same principle at the moment it matters most. A
 * cached `online` is about to become a payment instruction, so it is verified
 * first — once per viewing, because dialling a provider twice to learn the
 * same thing is latency the user pays for.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { ok, err } from 'neverthrow';

import { ProviderListScreen } from '@/features/ai/screens/ProviderListScreen';
import { useProviderRows } from '@/features/ai/hooks/useProviderRows';
import { getAiProviders } from '@/shared/lib/apiClient';
import { probeProvider, probeProviders } from '@/shared/lib/routstr/providerHealth';
import { discoverProviders } from '@/shared/lib/routstr/discovery';
import type { ServerProvider } from '@/shared/lib/routstr/providers';
import { useAiProviderDirectoryStore } from '@/shared/stores/profile/aiProviderDirectoryStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSetUserNode = jest.fn();
const mockObserveProviders = jest.fn();

jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ userNodeBaseUrl: null, nodeBaseUrl: null }),
    {
      getState: () => ({
        knownProviders: {},
        observeProviders: mockObserveProviders,
        setUserNode: mockSetUserNode,
      }),
    }
  ),
}));

jest.mock('@/features/ai/hooks/useProviderRows', () => ({ useProviderRows: jest.fn(() => []) }));
jest.mock('@/shared/lib/apiClient', () => ({ getAiProviders: jest.fn() }));
// The directory's operator write-through reaches the Nostr data layer, which
// this suite does not stand up; the row hook it would feed is mocked above.
jest.mock('@/shared/lib/nostr/fetchProfiles', () => ({
  ...jest.requireActual<typeof import('@/shared/lib/nostr/fetchProfiles')>(
    '@/shared/lib/nostr/fetchProfiles'
  ),
  cacheOperatorStats: jest.fn(),
}));
jest.mock('@/shared/lib/routstr/discovery', () => ({
  discoverProviders: jest.fn(async () => ({ announced: [], peers: [] })),
}));
jest.mock('@/shared/lib/routstr/providerHealth', () => ({
  probeProvider: jest.fn(),
  probeProviders: jest.fn(async () => {}),
}));
jest.mock('@/shared/lib/routstr/providers', () => ({
  normalizeNodeUrl: (url: string) => url.trim().replace(/\/+$/, ''),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), navigate: jest.fn() },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'theme' }));
jest.mock('@/shared/hooks/useNostrProfile', () => ({ useNostrProfile: () => ({ data: null }) }));
jest.mock('@/shared/lib/logger', () => ({
  // `isLevelEnabled` is the gate the list-paint recorder asks before it builds
  // a single string, so a mock without it is a logger the diagnostics cannot
  // use. Enabled here, so the recorder runs the same path it runs on device.
  aiLog: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    isLevelEnabled: () => true,
  },
  // The saved-directory store is REAL here (a mocked one cannot re-render the
  // screen when it is written), so persist's own logging has to exist.
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/lib/nav/providerInfoRoutes', () => ({ buildProviderInfoHref: () => '/x' }));
jest.mock('@/shared/lib/popup', () => ({ paramPopup: jest.fn() }));

jest.mock('@/shared/ui/composed/ContactRow', () => ({
  ContactRow: 'ContactRow',
  providerIdentity: (input: unknown) => input,
  nostrIdentity: (pubkey: string) => ({ pubkey }),
}));
jest.mock('@/shared/ui/composed/List', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    List: ({
      data,
      renderItem,
    }: {
      data: unknown[];
      renderItem: (info: { item: unknown }) => React.ReactElement;
    }) =>
      ReactActual.createElement(
        'List',
        null,
        data.map((item, index) =>
          ReactActual.cloneElement(renderItem({ item }), { key: String(index) })
        )
      ),
  };
});
jest.mock('@/shared/ui/composed/Screen', () => ({ Screen: 'Screen' }));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({ BottomButtons: 'BottomButtons' }));
jest.mock('@/shared/ui/composed/ButtonHandler', () => ({ ButtonHandler: 'ButtonHandler' }));
jest.mock('@/shared/ui/composed/CircleActionButton', () => ({
  CircleActionButton: 'CircleActionButton',
}));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: 'Spinner' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: 'Text' }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: 'VStack' }));

const REDSHIFT = 'https://ai.redsh1ft.com';

const served = (baseUrl: string, over: Partial<ServerProvider> = {}): ServerProvider => ({
  baseUrl,
  mints: [],
  status: 'online',
  ...over,
});

const localRow = (over: Record<string, unknown> = {}) => ({
  baseUrl: REDSHIFT,
  name: 'redsh1ft',
  description: null,
  version: null,
  mints: [],
  e2ee: null,
  pubkey: null,
  status: 'unknown' as const,
  statusSource: 'none' as const,
  nameIsHost: false,
  encryptedModelCount: null,
  modelCount: null,
  followers: null,
  spendableSats: 10,
  blockedReason: null,
  ...over,
});

async function openList() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ProviderListScreen));
  });
  // Both openers are async chains (a fetch, then a sweep). Let them land
  // before the test pretends to be a user.
  for (let i = 0; i < 4; i++) await act(async () => {});
  return renderer;
}

/**
 * Let a pooled probe result reach the rows.
 *
 * Probe answers are committed in batches, not one render per answer — a sweep
 * of forty otherwise re-renders every row forty times. The verdict is
 * therefore correct a beat after the probe resolves, and a test that asserts
 * in the same tick is asserting on the pool rather than on the list.
 */
async function settleProbeCommit() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
}

/** The arguments the screen most recently handed the row builder. */
const lastRowsCall = () => jest.mocked(useProviderRows).mock.calls.at(-1)!;

beforeEach(() => {
  jest.clearAllMocks();
  useAiProviderDirectoryStore.setState({ providers: [], fetchedAt: null });
  jest.mocked(useProviderRows).mockReturnValue([]);
  jest.mocked(getAiProviders).mockResolvedValue(ok([]));
  jest.mocked(discoverProviders).mockResolvedValue({ announced: [], peers: [] });
  jest.mocked(probeProviders).mockResolvedValue(undefined);
  jest.mocked(probeProvider).mockResolvedValue({ baseUrl: REDSHIFT, status: 'online', info: null });
});

describe('the provider directory', () => {
  it("paints nagg's list, in nagg's order, without waiting for discovery", async () => {
    const directory = [
      served(`${REDSHIFT}/`, { name: 'redsh1ft', encryptedModelCount: 9, modelCount: 582 }),
      served('https://b.example', { status: 'unknown' }),
      served('https://c.example', { status: 'offline' }),
    ];
    jest.mocked(getAiProviders).mockResolvedValue(ok(directory));
    // Discovery never settles here: whatever the list shows, it did not come
    // from a Nostr sweep.
    jest.mocked(discoverProviders).mockReturnValue(new Promise(() => {}));

    const renderer = await openList();
    expect(lastRowsCall()[1]).toEqual(directory);
    // …and it is kept, so the NEXT open does not have to ask again.
    expect(useAiProviderDirectoryStore.getState().providers).toEqual(directory);
    // Attributed to nagg, and passed through verbatim. The screen used to
    // hand-write "only include `name` if there is one" here; that judgement
    // belongs to the claim ladder, which applies it to every source rather
    // than the ones a call site remembered.
    expect(mockObserveProviders).toHaveBeenCalledWith('aggregator', {
      [`${REDSHIFT}/`]: { name: 'redsh1ft', mints: [], pubkey: undefined },
      'https://b.example': { name: undefined, mints: [], pubkey: undefined },
      'https://c.example': { name: undefined, mints: [], pubkey: undefined },
    });
    act(() => renderer.unmount());
  });

  it('paints the saved directory in the first frame, before anything answers', async () => {
    // This is the flicker the list was reported for: it used to paint from
    // whatever `knownProviders` happened to hold and then re-seat every row
    // when nagg replied a moment later. The saved directory means the order
    // and the statuses are already there when the screen mounts.
    const saved = [
      served(REDSHIFT, { name: 'redsh1ft', encryptedModelCount: 9 }),
      served('https://b.example', { status: 'offline' }),
    ];
    useAiProviderDirectoryStore.setState({ providers: saved, fetchedAt: Date.now() });
    // Neither the network nor discovery ever answers in this test.
    jest.mocked(getAiProviders).mockReturnValue(new Promise(() => {}) as never);
    jest.mocked(discoverProviders).mockReturnValue(new Promise(() => {}));

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(ProviderListScreen));
    });
    // The FIRST render, not an eventual one: no await has run.
    expect(jest.mocked(useProviderRows).mock.calls[0][1]).toEqual(saved);
    act(() => renderer.unmount());
  });

  it('will not paint a day-old snapshot of who was reachable', async () => {
    useAiProviderDirectoryStore.setState({
      providers: [served(REDSHIFT, { name: 'redsh1ft' })],
      fetchedAt: Date.now() - 48 * 60 * 60 * 1000,
    });
    jest.mocked(getAiProviders).mockReturnValue(new Promise(() => {}) as never);
    jest.mocked(discoverProviders).mockReturnValue(new Promise(() => {}));

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(React.createElement(ProviderListScreen));
    });
    expect(jest.mocked(useProviderRows).mock.calls[0][1]).toEqual([]);
    act(() => renderer.unmount());
  });

  it('probes what it already knows without waiting for discovery to finish', async () => {
    // Reachability is one of the only two reasons a provider is unusable, and
    // it used to be sequenced BEHIND a relay sweep plus a fan-out of HTTP
    // directory reads — so a dead row stayed choosable until discovery, which
    // is not about reachability at all, happened to finish.
    jest.mocked(getAiProviders).mockReturnValue(new Promise(() => {}) as never);
    jest.mocked(discoverProviders).mockReturnValue(new Promise(() => {}));

    const renderer = await openList();
    expect(probeProviders).toHaveBeenCalledTimes(1);
    expect(discoverProviders).toHaveBeenCalled();
    act(() => renderer.unmount());
  });

  it('records the announcement and the peer directories as separate sources', async () => {
    jest.mocked(getAiProviders).mockResolvedValue(ok([]));
    jest.mocked(discoverProviders).mockResolvedValue({
      announced: [{ baseUrl: REDSHIFT, name: 'redsh1ft', pubkey: 'a'.repeat(64) }],
      peers: [{ baseUrl: REDSHIFT, name: 'somebody elses idea', mints: ['https://mint.example'] }],
    });
    const renderer = await openList();

    // Two parties, two observations. Merging them here is what let a peer
    // node's opinion overwrite an operator's own name on fourteen rows.
    const sources = mockObserveProviders.mock.calls.map(([source]) => source);
    expect(sources).toContain('announcement');
    expect(sources).toContain('peer');
    const peerCall = mockObserveProviders.mock.calls.find(([source]) => source === 'peer');
    // A peer directory is hearsay about a third party and is never given the
    // chance to say who runs it.
    expect(peerCall?.[1][REDSHIFT]).not.toHaveProperty('pubkey');
    act(() => renderer.unmount());
  });

  it('degrades to local discovery when nagg is unreachable, rather than emptying', async () => {
    jest.mocked(getAiProviders).mockResolvedValue(err(new Error('503 Service Unavailable')));
    jest.mocked(useProviderRows).mockReturnValue([localRow()]);

    const renderer = await openList();
    expect(lastRowsCall()[1]).toEqual([]);
    // The sweep the app has always done still runs, and still fills the list.
    expect(discoverProviders).toHaveBeenCalled();
    expect(
      renderer.root.findAllByType('ContactRow' as unknown as React.ComponentType)
    ).toHaveLength(1);
    act(() => renderer.unmount());
  });
});

describe('choosing a provider', () => {
  const tap = async (renderer: TestRenderer.ReactTestRenderer) => {
    const row = renderer.root.findByType('ContactRow' as unknown as React.ComponentType);
    await act(async () => {
      row.props.onPress();
    });
  };

  it('sanity-checks the provider on tap, and does not check it twice', async () => {
    jest.mocked(useProviderRows).mockReturnValue([localRow()]);
    const renderer = await openList();

    await tap(renderer);
    expect(probeProvider).toHaveBeenCalledTimes(1);
    expect(mockSetUserNode).toHaveBeenCalledWith(REDSHIFT);

    await tap(renderer);
    // Already verified in this viewing. Asking again is latency the user pays
    // for to learn what the screen already knows.
    expect(probeProvider).toHaveBeenCalledTimes(1);
    act(() => renderer.unmount());
  });

  it('takes the background sweep as the check, when it got there first', async () => {
    jest.mocked(useProviderRows).mockReturnValue([localRow()]);
    jest.mocked(probeProviders).mockImplementation(async (_urls, options) => {
      options.onResult({ baseUrl: REDSHIFT, status: 'online', info: null });
    });
    const renderer = await openList();

    // The sweep reported this provider before the user got to it.
    expect(probeProviders).toHaveBeenCalled();
    await tap(renderer);
    expect(probeProvider).not.toHaveBeenCalled();
    expect(mockSetUserNode).toHaveBeenCalledWith(REDSHIFT);
    act(() => renderer.unmount());
  });

  it('refuses to select a provider that fails the check', async () => {
    jest.mocked(useProviderRows).mockReturnValue([localRow({ status: 'online' })]);
    jest
      .mocked(probeProvider)
      .mockResolvedValue({ baseUrl: REDSHIFT, status: 'offline', info: null });
    const renderer = await openList();

    await tap(renderer);
    // nagg said online; we just failed to reach it. Nothing is paid to a
    // provider that is not there.
    expect(mockSetUserNode).not.toHaveBeenCalled();
    await settleProbeCommit();
    expect(lastRowsCall()[0]).toEqual({ [REDSHIFT]: 'offline' });
    act(() => renderer.unmount());
  });
});
