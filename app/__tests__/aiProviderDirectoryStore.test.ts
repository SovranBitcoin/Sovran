/**
 * @jest-environment node
 *
 * What survives between two openings of the AI provider list.
 *
 * The list is served whole by nagg — already discovered, already probed, and
 * already ranked — and the app used to throw that away on unmount. So every
 * open painted from whatever `knownProviders` happened to hold and then
 * re-seated every row a moment later when the reply landed: the rows were
 * never wrong, they were just being ranked twice in front of the reader.
 *
 * Keeping it has two rules worth a test. An EMPTY read is not news and must
 * not erase a good snapshot — that is how a 503 would turn "forty providers"
 * into "there is nobody out there". And a snapshot has a shelf life: a day-old
 * record of who was reachable is not something to draw as if somebody had just
 * looked.
 */

import { useAiProviderDirectoryStore } from '@/shared/stores/profile/aiProviderDirectoryStore';
import type { ServerProvider } from '@/shared/lib/routstr/providers';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

const served = (baseUrl: string, over: Partial<ServerProvider> = {}): ServerProvider => ({
  baseUrl,
  mints: [],
  status: 'online',
  ...over,
});

beforeEach(() => {
  useAiProviderDirectoryStore.setState({ providers: [], fetchedAt: null });
});

describe('the saved provider directory', () => {
  it("keeps nagg's rows in nagg's order, stamped with when they were read", () => {
    const directory = [
      served('https://a.example', { name: 'A', encryptedModelCount: 9 }),
      served('https://b.example', { status: 'offline' }),
    ];
    useAiProviderDirectoryStore.getState().rememberDirectory(directory);

    const state = useAiProviderDirectoryStore.getState();
    expect(state.providers.map((row) => row.baseUrl)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(state.fetchedAt).toBeGreaterThan(0);
  });

  it('ignores an empty read rather than emptying a good snapshot', () => {
    useAiProviderDirectoryStore.getState().rememberDirectory([served('https://a.example')]);
    const stamped = useAiProviderDirectoryStore.getState().fetchedAt;

    useAiProviderDirectoryStore.getState().rememberDirectory([]);

    expect(useAiProviderDirectoryStore.getState().providers).toHaveLength(1);
    expect(useAiProviderDirectoryStore.getState().fetchedAt).toBe(stamped);
  });

  it('replaces the list wholesale, so a provider nagg dropped does not linger', () => {
    useAiProviderDirectoryStore
      .getState()
      .rememberDirectory([served('https://gone.example'), served('https://stays.example')]);
    useAiProviderDirectoryStore.getState().rememberDirectory([served('https://stays.example')]);

    expect(useAiProviderDirectoryStore.getState().providers.map((row) => row.baseUrl)).toEqual([
      'https://stays.example',
    ]);
  });

  it('separates a measured zero from a reach nobody resolved', () => {
    // nagg publishes `null` for an operator whose following it could not
    // establish, and `0` when it counted and the answer was none. The store
    // must not launder one into the other — the row prints them differently.
    useAiProviderDirectoryStore
      .getState()
      .rememberDirectory([
        served('https://counted.example', { followers: 0 }),
        served('https://unknown.example'),
      ]);

    const [counted, unresolved] = useAiProviderDirectoryStore.getState().providers;
    expect(counted.followers).toBe(0);
    expect(unresolved.followers).toBeUndefined();
  });
});
