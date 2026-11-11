/**
 * @jest-environment node
 *
 * Network relay editing through real sessions, reads and the relay-list store.
 * Network, signing, account, storage and heavy visual primitives are fixtures.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RelayListSettings } from '@/features/settings/components/RelayListSettings';

import type NDK from '@nostr-dev-kit/ndk-mobile';
import { errAsync, okAsync } from 'neverthrow';

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
  expect(mockProfileListeners.size).toBe(0);
  jest.useRealTimers();
});

jest.mock('react-native-web/dist/exports/View', () => ({ __esModule: true, default: 'View' }));
jest.mock('react-native-web/dist/exports/Text', () => ({ __esModule: true, default: 'Text' }));
jest.mock('react-native-web/dist/exports/TextInput', () => ({
  __esModule: true,
  default: 'TextInput',
}));
jest.mock('react-native-web/dist/exports/Pressable', () => ({ __esModule: true, default: 'View' }));
jest.mock('react-native-web/dist/exports/Switch', () => ({ __esModule: true, default: 'Switch' }));
jest.mock('react-native', () => ({
  Text: 'Text',
  View: 'View',
  TextInput: 'TextInput',
  Switch: 'Switch',
  Pressable: 'View',
  StyleSheet: { flatten: (style: unknown) => style },
  Platform: { OS: 'ios' },
}));

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) =>
    jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
jest.mock('@/shared/ui/composed/Section', () => {
  const Text = jest.requireMock('react-native').Text;
  return {
    Section: ({ title, children }: React.PropsWithChildren<{ title: string }>) => (
      <>
        {title ? <Text>{title}</Text> : null}
        {children}
      </>
    ),
  };
});
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: jest.requireMock('react-native').Text }));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: ({ text, ...props }: { text: string }) => {
    const { Pressable, Text } = jest.requireMock('react-native');
    return (
      <Pressable accessible accessibilityRole="button" {...props}>
        <Text>{text}</Text>
      </Pressable>
    );
  },
}));
jest.mock('@/shared/ui/primitives/Switch', () => ({
  Switch: ({
    isSelected,
    onSelectedChange,
    ...props
  }: {
    isSelected: boolean;
    onSelectedChange: (next: boolean) => void;
  }) => {
    const { Switch } = jest.requireMock('react-native');
    return <Switch value={isSelected} onValueChange={onSelectedChange} {...props} />;
  },
}));
jest.mock('@/shared/ui/primitives/Badge', () => ({ Badge: () => null }));
jest.mock('heroui-native', () => {
  const { View, Text, TextInput } = jest.requireMock('react-native');
  const ListGroup = Object.assign(
    ({ children }: React.PropsWithChildren) => <View>{children}</View>,
    {
      Item: Object.assign(({ children }: React.PropsWithChildren) => <View>{children}</View>, {}),
      ItemContent: View,
      ItemTitle: Text,
      ItemDescription: Text,
      ItemSuffix: View,
    }
  );
  return { ListGroup, Separator: () => null, TextField: View, Input: TextInput };
});

function mount() {
  return render(<RelayListSettings ndk={relayFake()} pubkey={OWN} />);
}
async function start() {
  fireEvent.press(screen.getByRole('button', { name: 'Edit relays' }));
  expect(await screen.findByRole('button', { name: 'Review changes' })).toBeOnTheScreen();
}

it('reads before editing, keeps remote additions and permissions, and publishes only after review', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE, 'read'],
      ['r', OLD],
    ]),
  ]);
  mount();
  expect(screen.queryByLabelText('Relay URL')).not.toBeOnTheScreen();
  await start();
  fireEvent.changeText(screen.getByLabelText('Relay URL'), 'wss://added.example');
  fireEvent.press(screen.getByRole('button', { name: 'Add relay' }));
  expect(store().entries).toEqual([mine]);
  expect(mockPublish).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.getByText('Add: wss://added.example')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Relay URL')).not.toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Publish relay list' }));
  expect(await screen.findByText(/^Published to /)).toBeOnTheScreen();
  expect(mockPublish).toHaveBeenCalledTimes(1);
  expect(sent().event.tags).toEqual([
    ['r', MINE, 'read'],
    ['r', OLD],
    ['r', 'wss://added.example'],
  ]);
});

it('shows an old saved proposal only by explicit choice and reviews every lost relay and permission', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE, 'read'],
      ['r', OLD],
    ]),
  ]);
  mount();
  await start();
  fireEvent.press(screen.getByRole('button', { name: 'Use saved proposal' }));
  fireEvent.press(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.getByText(`Remove: ${OLD}`)).toBeOnTheScreen();
  expect(screen.getByText(`Change permissions: ${MINE}`)).toBeOnTheScreen();
  expect(mockPublish).not.toHaveBeenCalled();
});

it('shows the new comparison and requires another publish tap after an external edit', async () => {
  mockHeld.set(MINE, [remote([['r', MINE]])]);
  mount();
  await start();
  fireEvent.press(screen.getByRole('button', { name: 'Review changes' }));
  mockHeld.set(MINE, [
    remote(
      [
        ['r', MINE],
        ['r', OLD],
      ],
      'c',
      201
    ),
  ]);
  fireEvent.press(screen.getByRole('button', { name: 'Publish relay list' }));
  expect(
    await screen.findByText(
      'Your list changed elsewhere. Review the updated changes before publishing.'
    )
  ).toBeOnTheScreen();
  expect(screen.getByText(`Remove: ${OLD}`)).toBeOnTheScreen();
  expect(mockPublish).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Publish relay list' }));
  expect(await screen.findByText(/^Published to /)).toBeOnTheScreen();
  expect(sent().event.tags).toEqual([['r', MINE]]);
});

it('waits on failed reads with no editing controls or publication', async () => {
  mockHeld.set(MINE, 'fail');
  mount();
  fireEvent.press(screen.getByRole('button', { name: 'Edit relays' }));
  expect(
    await screen.findByText(
      'Your latest list could not be read. Connect and try again before editing.'
    )
  ).toBeOnTheScreen();
  expect(screen.queryByLabelText('Relay URL')).not.toBeOnTheScreen();
  expect(mockPublish).not.toHaveBeenCalled();
});

it('keeps a failed publication draft in memory, then rereads and requires review again', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE],
      ['r', OLD],
    ]),
  ]);
  mount();
  await start();
  fireEvent.press(screen.getByRole('button', { name: `Remove ${OLD}` }));
  fireEvent.press(screen.getByRole('button', { name: 'Review changes' }));
  mockPublish.mockReturnValueOnce(errAsync({ type: 'all-failed' }));
  fireEvent.press(screen.getByRole('button', { name: 'Publish relay list' }));
  expect(await screen.findByRole('button', { name: 'Read latest list' })).toBeOnTheScreen();
  expect(screen.queryByText(/^Published to /)).not.toBeOnTheScreen();
  expect(store().entries).toEqual([mine]);
  fireEvent.press(screen.getByRole('button', { name: 'Read latest list' }));
  expect(await screen.findByText(`Remove: ${OLD}`)).toBeOnTheScreen();
  expect(mockPublish).toHaveBeenCalledTimes(1);
});

it('cancels without saving, then reads the new base on re-entry', async () => {
  mockHeld.set(MINE, [
    remote([
      ['r', MINE],
      ['r', OLD],
    ]),
  ]);
  mount();
  await start();
  fireEvent.press(screen.getByRole('button', { name: `Remove ${OLD}` }));
  fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  mockHeld.set(MINE, [remote([['r', OLD]], 'c', 201)]);
  await start();
  expect(screen.queryByRole('button', { name: `Remove ${MINE}` })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: `Remove ${OLD}` })).toBeOnTheScreen();
  expect(store().entries).toEqual([mine]);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('disposes its session on leave and drops a late read after unmount', async () => {
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
  const view = render(<RelayListSettings ndk={ndk} pubkey={OWN} />);
  fireEvent.press(screen.getByRole('button', { name: 'Edit relays' }));
  view.unmount();
  release?.();
  await waitFor(() => expect(mockProfileListeners.size).toBe(0));
  expect(mockPublish).not.toHaveBeenCalled();
});

it('edits permissions only in memory and refuses a draft with no write relay', async () => {
  mockHeld.set(MINE, [remote([['r', MINE]])]);
  mount();
  await start();
  fireEvent(screen.getByLabelText(`Write to ${MINE}`), 'valueChange', false);
  fireEvent.press(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.getByText('Add a relay to write to, or restore defaults.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Publish relay list' })).not.toBeOnTheScreen();
  expect(store().entries).toEqual([mine]);
  expect(mockPublish).not.toHaveBeenCalled();
});

it('drops repeated publish taps while one publication is in progress', async () => {
  mockHeld.set(MINE, [remote([['r', MINE]])]);
  mount();
  await start();
  fireEvent.press(screen.getByRole('button', { name: 'Review changes' }));
  const button = screen.getByRole('button', { name: 'Publish relay list' });
  fireEvent.press(button);
  fireEvent.press(button);
  expect(await screen.findByText(/^Published to /)).toBeOnTheScreen();
  expect(mockPublish).toHaveBeenCalledTimes(1);
});
