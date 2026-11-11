/**
 * @jest-environment node
 *
 * Relay edit sessions against the real relay-list store and reader. Network,
 * signing, active account, storage and logging are deterministic boundaries.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { errAsync, okAsync } from 'neverthrow';

import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import {
  beginRelayListEdit,
  publishDefaultRelayList,
  type RelayListEditor,
  trackRelaysAsked,
} from '@/shared/lib/nostr/outbox/publishOwnRelayList';
import { useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { forgetSilentRelays } from '@/shared/lib/nostr/ownReplaceableEvent';

const OWN = 'a0'.repeat(32);
type Relay = { url: string };
type RelayEvent = {
  kind: number;
  pubkey: string;
  created_at: number;
  id: string;
  tags: string[][];
};

const mockPublish = jest.fn();
const mockAfterSign = jest.fn();
/** Per relay, the kind 10002s it holds, or `fail` for one whose read throws. */
const mockHeld = new Map<string, RelayEvent[] | 'fail'>();
const mockAsked: string[] = [];
const mockProfile = { activeAccountIndex: 0, profiles: [{ accountIndex: 0, pubkey: OWN }] };
const mockProfileListeners = new Set<(state: typeof mockProfile) => void>();
const mockRelayObjects = new Map<string, Relay>();
const mockRelay = (url: string) => {
  if (!mockRelayObjects.has(url)) mockRelayObjects.set(url, { url });
  return mockRelayObjects.get(url)!;
};

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  ...jest.requireActual('@nostr-dev-kit/ndk-mobile'),
  NDKRelaySet: {
    fromRelayUrls: (urls: string[]) => ({ relays: new Set(urls.map(mockRelay)) }),
  },
  NDKEvent: class NDKEvent {
    kind = 0;
    pubkey = '';
    created_at = 0;
    tags: string[][] = [];
    content = '';
    id = '';
    getEventHash() {
      return this.id;
    }
    verifySignature() {
      return true;
    }
    async sign(signer: { user: () => Promise<{ pubkey: string }> }) {
      this.pubkey = (await signer.user()).pubkey;
      this.id = 'e'.repeat(64);
      mockAfterSign();
    }
  },
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  ...jest
    .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
    .activeAccountReaders(
      () => mockProfile,
      (listener) => {
        mockProfileListeners.add(listener);
        return () => {
          mockProfileListeners.delete(listener);
        };
      }
    ),
}));
jest.mock('@/shared/lib/logger', () => {
  // Every export is a silent logger that is also callable (`redactError`, hooks).
  const silent: object = new Proxy(() => undefined, { get: () => silent });
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : silent) });
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const NOW_SEC = 1_790_000_000;
const MINE = 'wss://mine.example';
const OLD = 'wss://old.example';
const store = () => useRelayListStore.getState();

function relayFake() {
  return {
    signer: { user: async () => ({ pubkey: OWN }) },
    subscribe: (_filter: unknown, _options: unknown, relaySet: { relays: Set<Relay> }) => {
      const [relay] = [...relaySet.relays];
      mockAsked.push(relay.url);
      const listeners: Record<string, (...args: unknown[]) => void> = {};
      const subscription = {
        eosesSeen: new Set<Relay>(),
        stop: () => undefined,
        on: (type: string, listener: (...args: unknown[]) => void) => {
          listeners[type] = listener;
        },
        start: async () => {
          const held = mockHeld.get(relay.url) ?? [];
          if (held === 'fail') throw new Error('relay failed');
          const { NDKEvent } = jest.requireMock('@nostr-dev-kit/ndk-mobile');
          for (const event of held) listeners.event(Object.assign(new NDKEvent(), event));
          subscription.eosesSeen.add(relay);
          listeners.eose();
        },
      };
      return subscription;
    },
  } as unknown as NDK;
}

const editors: RelayListEditor[] = [];
async function edit(ndk = relayFake()) {
  const result = await beginRelayListEdit(ndk, OWN);
  if (result.isErr()) throw new Error(result.error.type);
  editors.push(result.value);
  return result.value;
}
const remote = (tags: string[][], id = 'b', created_at = 200): RelayEvent => ({
  kind: 10002,
  pubkey: OWN,
  created_at,
  id: id.repeat(64),
  tags,
});
const mine = { url: MINE, read: true, write: true };

const sent = () => mockPublish.mock.calls[0][0];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_SEC * 1000, doNotFake: ['nextTick', 'setImmediate'] });
  forgetSilentRelays();
  mockProfile.activeAccountIndex = 0;
  mockHeld.clear();
  mockAsked.length = 0;
  mockPublish.mockReset();
  mockAfterSign.mockReset();
  mockPublish.mockImplementation(({ relays }: { relays: string[] }) =>
    okAsync({ accepted: relays.map((url) => ({ url, ok: true })) })
  );
  useRelayListStore.setState({
    entries: [{ url: MINE, read: true, write: true }],
    updatedAt: 100,
    hasPublished: true,
    source: 'local',
    discoveredFor: null,
  });
});

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.dispose());
  expect(mockProfileListeners.size).toBe(0);
  jest.useRealTimers();
});

it('refuses an unreviewed saved proposal that would overwrite remote additions and permissions', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE, 'read'],
      ['r', 'wss://remote-only.example'],
    ]),
  ]);
  store().addRelay('wss://local-addition.example', { read: true, write: true });
  const editor = await edit();
  expect(editor.base).toEqual([
    { url: MINE, read: true, write: false },
    { url: 'wss://remote-only.example', read: true, write: true },
  ]);
  expect(editor.savedProposal).toEqual([
    mine,
    { url: 'wss://local-addition.example', read: true, write: true },
  ]);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(store().source).toBe('local');
});

it('adds to the latest list, retaining external additions and permissions', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE, 'read'],
      ['r', 'wss://remote-only.example'],
    ]),
  ]);
  const editor = await edit();
  const review = editor.review([
    ...editor.base,
    { url: 'wss://new.example', read: true, write: true },
  ]);
  const result = await review.publish();
  expect(result.isOk()).toBe(true);
  expect(sent().event.tags).toEqual([
    ['r', MINE, 'read'],
    ['r', 'wss://remote-only.example'],
    ['r', 'wss://new.example'],
  ]);
  expect(sent().relays).toEqual(
    expect.arrayContaining([MINE, 'wss://remote-only.example', 'wss://new.example'])
  );
  expect(store().source).toBe('relay');
  expect(store().discoveredFor).toBe(OWN);
  expect(store().entries).toEqual(review.entries);
});

it('retains an intentional removal and sends to the old destination too', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE],
      ['r', OLD],
    ]),
  ]);
  const editor = await edit();
  expect((await editor.review([mine]).publish()).isOk()).toBe(true);
  expect(sent().event.tags).toEqual([['r', MINE]]);
  expect(sent().relays).toContain(OLD);
});

it('requires a new review when another client changes permissions during review', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE],
      ['r', OLD],
    ]),
  ]);
  const editor = await edit();
  const review = editor.review([mine]);
  mockHeld.set(MINE, [
    remote(
      [
        ['r', MINE, 'read'],
        ['r', OLD],
      ],
      'c',
      201
    ),
  ]);
  const result = await review.publish();
  expect(result.isErr() && result.error.type).toBe('changed');
  expect(mockPublish).not.toHaveBeenCalled();
  const again = editor.review(review.entries);
  expect(again.base[0]).toEqual({ url: MINE, read: true, write: false });
  expect((await again.publish()).isOk()).toBe(true);
  expect(sent().event.tags).toEqual([['r', MINE]]);
});

it('detects a remote change made while signing before posting', async () => {
  mockHeld.set(MINE, [remote([['r', MINE]])]);
  const editor = await edit();
  mockAfterSign.mockImplementation(() =>
    mockHeld.set(MINE, [
      remote(
        [
          ['r', MINE],
          ['r', OLD],
        ],
        'c',
        201
      ),
    ])
  );
  const result = await editor.review([mine]).publish();
  expect(result.isErr() && result.error.type).toBe('changed');
  expect(mockPublish).not.toHaveBeenCalled();
});

it('keeps a deliberately empty remote list empty, with no defaults added', async () => {
  mockHeld.set(MINE, [remote([])]);
  const editor = await edit();
  expect(editor.base).toEqual([]);
  expect((await editor.review([mine]).publish()).isOk()).toBe(true);
  expect(sent().event.tags).toEqual([['r', MINE]]);
});

it('offers defaults only when no published list exists', async () => {
  const editor = await edit();
  expect(editor.base.map((entry) => entry.url)).toEqual(DEFAULT_RELAYS);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('waits without editing or publishing after an incomplete read', async () => {
  mockHeld.set(DEFAULT_RELAYS[0], 'fail');
  const result = await beginRelayListEdit(relayFake(), OWN);
  expect(result.isErr() && result.error.type).toBe('waiting');
  expect(store().entries).toEqual([mine]);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('waits without publishing if the fresh read fails', async () => {
  const editor = await edit();
  mockHeld.set(DEFAULT_RELAYS[0], 'fail');
  const result = await editor.review([mine]).publish();
  expect(result.isErr() && result.error.type).toBe('waiting');
  expect(mockPublish).not.toHaveBeenCalled();
});

it('rejects lists with no write relay', async () => {
  const editor = await edit();
  for (const proposal of [[], [{ ...mine, write: false }]]) {
    const result = await editor.review(proposal).publish();
    expect(result.isErr() && result.error.type).toBe('no-write-relay');
  }
  expect(mockPublish).not.toHaveBeenCalled();
});

it('does not report success or save the proposal when publication fails', async () => {
  const editor = await edit();
  mockPublish.mockReturnValue(errAsync({ type: 'all-failed', relayResults: [] }));
  const result = await editor.review([mine]).publish();
  expect(result.isErr() && result.error.type).toBe('failed');
  expect(store()).toMatchObject({ source: 'local', updatedAt: 100 });
});

it('owns immutable proposals and ignores repeat taps and overlapping reviews', async () => {
  const editor = await edit();
  const proposal = [{ ...mine }];
  const review = editor.review(proposal);
  proposal[0].write = false;
  const outcomes = await Promise.all([review.publish(), review.publish()]);
  expect(outcomes.filter((result) => result.isOk())).toHaveLength(1);
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(sent().event.tags).toEqual([['r', MINE]]);
});

it('invalidates a previous review when returning to edit', async () => {
  const editor = await edit();
  const old = editor.review([mine]);
  editor.review([{ ...mine, read: false }]);
  expect((await old.publish()).isErr()).toBe(true);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('cancels an edit and reads again on re-entry without saving its changes', async () => {
  const editor = await edit();
  const review = editor.review([{ ...mine, read: false }]);
  editor.dispose();
  expect((await review.publish()).isErr()).toBe(true);
  mockHeld.set(MINE, [remote([['r', OLD]])]);
  const next = await edit();
  expect(next.base).toEqual([{ url: OLD, read: true, write: true }]);
  expect(store().entries).toEqual([mine]);
  expect(mockPublish).not.toHaveBeenCalled();
});

it.each(['read', 'sign', 'post-sign', 'publish'] as const)(
  'guards a signer replacement during %s',
  async (phase) => {
    const ndk = relayFake();
    const editor = await edit(ndk);
    const replace = () => Object.assign(ndk, { signer: { user: async () => ({ pubkey: OWN }) } });
    if (phase === 'read') replace();
    if (phase === 'sign') mockAfterSign.mockImplementation(replace);
    if (phase === 'post-sign')
      mockAfterSign.mockImplementation(() => {
        void Promise.resolve().then(() => Promise.resolve().then(replace));
      });
    if (phase === 'publish')
      mockPublish.mockImplementation(({ relays }: { relays: string[] }) => {
        replace();
        return okAsync({ accepted: relays.map((url) => ({ url })) });
      });
    const result = await editor.review([mine]).publish();
    expect(result.isErr()).toBe(true);
    expect(mockPublish).toHaveBeenCalledTimes(phase === 'publish' ? 1 : 0);
    expect(store()).toMatchObject({ source: 'local', updatedAt: 100 });
  }
);

it.each(['read', 'sign', 'post-sign', 'publish'] as const)(
  'guards an account switch during %s',
  async (phase) => {
    const editor = await edit();
    const switchAccount = () => {
      mockProfile.activeAccountIndex = 1;
      for (const listener of mockProfileListeners) listener(mockProfile);
    };
    if (phase === 'read') switchAccount();
    if (phase === 'sign') mockAfterSign.mockImplementation(switchAccount);
    if (phase === 'post-sign')
      mockAfterSign.mockImplementation(() => {
        void Promise.resolve().then(() => Promise.resolve().then(switchAccount));
      });
    if (phase === 'publish')
      mockPublish.mockImplementation(({ relays }: { relays: string[] }) => {
        switchAccount();
        return okAsync({ accepted: relays.map((url) => ({ url })) });
      });
    expect((await editor.review([mine]).publish()).isErr()).toBe(true);
    expect(mockPublish).toHaveBeenCalledTimes(phase === 'publish' ? 1 : 0);
    expect(store()).toMatchObject({ source: 'local', updatedAt: 100 });
  }
);

it('rejects saved changes during signing and keeps them pending', async () => {
  const editor = await edit();
  mockAfterSign.mockImplementation(() => store().addRelay(OLD, { read: true, write: true }));
  expect((await editor.review([mine]).publish()).isErr()).toBe(true);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(store().entries.map((entry) => entry.url)).toEqual([MINE, OLD]);
});

it('includes learned old write destinations', async () => {
  const untrack = trackRelaysAsked(OWN, new Set(), new Set([OLD]));
  try {
    const editor = await edit();
    await editor.review([mine]).publish();
    expect(sent().relays).toContain(OLD);
  } finally {
    untrack();
  }
});

it('cancels first-run defaults and refuses defaults over any existing list or saved proposal', async () => {
  const read = {
    status: 'read' as const,
    newest: undefined,
    relays: [...DEFAULT_RELAYS],
    asked: [...DEFAULT_RELAYS],
  };
  const ndk = relayFake();
  expect((await publishDefaultRelayList(ndk, OWN, read, () => true)).isErr()).toBe(true);
  useRelayListStore.setState({ hasPublished: false, source: 'default' });
  expect((await publishDefaultRelayList(ndk, OWN, read, () => false)).isErr()).toBe(true);
  mockHeld.set(MINE, [remote([])]);
  expect((await publishDefaultRelayList(ndk, OWN, read, () => true)).isErr()).toBe(true);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('keeps old learned destinations after an external removal requires a new review', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE],
      ['r', OLD],
    ]),
  ]);
  const editor = await edit();
  const review = editor.review([mine]);
  mockHeld.set(MINE, [remote([['r', MINE]], 'c', 201)]);
  const result = await review.publish();
  expect(result.isErr() && result.error.type).toBe('changed');
  expect((await editor.review(review.entries).publish()).isOk()).toBe(true);
  expect(sent().relays).toContain(OLD);
});

it('invalidates an invocation when saved entries change during signer lookup', async () => {
  const ndk = relayFake();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.assign(ndk, {
    signer: {
      user: async () => {
        await gate;
        return { pubkey: OWN };
      },
    },
  });
  const pending = beginRelayListEdit(ndk, OWN);
  store().addRelay(OLD, { read: true, write: true });
  release?.();
  expect((await pending).isErr()).toBe(true);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(store().entries.map((entry) => entry.url)).toEqual([MINE, OLD]);
});

it('serializes separate sessions for the same account', async () => {
  const ndk = relayFake();
  const first = await edit(ndk);
  const second = await edit(ndk);
  const outcomes = await Promise.all([
    first.review([mine]).publish(),
    second.review([mine]).publish(),
  ]);
  expect(outcomes.filter((result) => result.isOk())).toHaveLength(1);
  expect(mockPublish).toHaveBeenCalledTimes(1);
});

it('keeps a later saved proposal pending even if the earlier event was accepted', async () => {
  const editor = await edit();
  mockPublish.mockImplementation(({ relays }: { relays: string[] }) => {
    store().addRelay(OLD, { read: true, write: true });
    return okAsync({ accepted: relays.map((url) => ({ url })) });
  });
  expect((await editor.review([mine]).publish()).isErr()).toBe(true);
  expect(store()).toMatchObject({ source: 'local', updatedAt: 100 });
  expect(store().entries.map((entry) => entry.url)).toEqual([MINE, OLD]);
});

it('does not publish first-run defaults if another list appears during signing', async () => {
  useRelayListStore.setState({ hasPublished: false, source: 'default' });
  mockAfterSign.mockImplementation(() => mockHeld.set(MINE, [remote([])]));
  const result = await publishDefaultRelayList(
    relayFake(),
    OWN,
    { status: 'read', newest: undefined, relays: [...DEFAULT_RELAYS], asked: [...DEFAULT_RELAYS] },
    () => true
  );
  expect(result.isErr()).toBe(true);
  expect(mockPublish).not.toHaveBeenCalled();
  expect(store().hasPublished).toBe(false);
});

it('retains destinations known when opening even if discovery changes during signer lookup', async () => {
  const ndk = relayFake();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.assign(ndk, {
    signer: {
      user: async () => {
        await gate;
        return { pubkey: OWN };
      },
    },
  });
  const untrack = trackRelaysAsked(OWN, new Set(), new Set([OLD]));
  const pending = beginRelayListEdit(ndk, OWN);
  untrack();
  release?.();
  const result = await pending;
  if (result.isErr()) throw new Error(result.error.type);
  editors.push(result.value);
  await result.value.review([mine]).publish();
  expect(sent().relays).toContain(OLD);
});

it('does not mark discovery for an account switched by a saved-list subscriber', async () => {
  const editor = await edit();
  const unsubscribe = useRelayListStore.subscribe((state) => {
    if (state.source !== 'relay') return;
    mockProfile.activeAccountIndex = 1;
    for (const listener of mockProfileListeners) listener(mockProfile);
  });
  try {
    const result = await editor.review([mine]).publish();
    expect(result.isErr()).toBe(true);
    expect(store().discoveredFor).toBeNull();
  } finally {
    unsubscribe();
  }
});

it('dates replacements after both the saved timestamp and the newest remote event', async () => {
  useRelayListStore.setState({ updatedAt: NOW_SEC + 600 });
  const first = await edit();
  await first.review([mine]).publish();
  expect(sent().event.created_at).toBe(NOW_SEC + 601);
  mockPublish.mockClear();
  mockHeld.set(MINE, [remote([['r', MINE]], 'c', NOW_SEC + 900)]);
  const next = await edit();
  await next.review([mine]).publish();
  expect(sent().event.created_at).toBe(NOW_SEC + 901);
});
