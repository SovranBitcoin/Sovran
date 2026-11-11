/**
 * What the BitChat chat screen shows for each own message's delivery, and
 * "Tap to retry" on a failed Bluetooth direct message: a retry re-sends the
 * original text once, and the failed bubble does not offer to send it again,
 * whether the person taps twice in a row, taps again after the retry went out,
 * or leaves and reopens the chat.
 *
 * The screen runs with the real chat hook over recording fakes of the native
 * `bitchat-module` and the real BLE DM store over an in-memory AsyncStorage.
 * The list is replaced by one that records the rows and renders each through
 * the screen's `renderBubble`; the bubble itself is the real one, so the "Tap
 * to retry" target is what a person presses.
 */
import { AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { GeohashChatScreen } from '@/features/bitchat/screens/GeohashChatScreen';
import {
  useBitchatDmMessagesStore,
  type BleDmMessage,
} from '@/features/bitchat/stores/bitchatDmMessages';

const PEER = 'a1b2c3d4e5f60718';
const GEOHASH = 'u4pruy';
const RETRY = 'Retry sending message';

// eslint-disable-next-line no-restricted-syntax -- a parseable theme fixture, not a UI color
const mockColor = '#222222';
let mockRows: { id: string; isOwn: boolean; deliveryStatus?: string }[] = [];
let mockOnSend: ((text: string) => unknown) | undefined;
let mockChat: { composerDisabled?: boolean; banner?: unknown } = {};
let mockIgnored: string[] = [];

type Listener = (event: Record<string, unknown>) => void;
const mockListeners: Record<string, Set<Listener>> = {};
function mockAddListener(name: string) {
  return (fn: Listener) => {
    (mockListeners[name] ??= new Set()).add(fn);
    return { remove: () => mockListeners[name]!.delete(fn) };
  };
}
const mockNative = {
  startBLE: jest.fn(async (_opts: unknown) => undefined),
  acquirePublicBLEMesh: jest.fn(() => () => undefined),
  sendBLEMessage: jest.fn(async (_content: string) => undefined),
  startBLEPrivateChat: jest.fn(async (_peer: string) => undefined),
  sendBLEPrivateMessage: jest.fn(
    async (args: { content: string; messageID: string }) => args.messageID
  ),
  getBLEPeers: jest.fn((): unknown[] => []),
  getBLEState: jest.fn(() => 'poweredOn'),
  startNostr: jest.fn(async (_scope: string) => undefined),
  joinGeohash: jest.fn(async (_geohash: string) => undefined),
  sendGeohashMessage: jest.fn(async (_content: string, _nickname?: string) => undefined),
  sendGeohashPrivateMessage: jest.fn(async (_pubkey: string, _content: string) => undefined),
};
type NativeName = keyof typeof mockNative;
function mockForward(name: NativeName) {
  return (...args: unknown[]) => (mockNative[name] as (...a: unknown[]) => unknown)(...args);
}
jest.mock('bitchat-module', () => ({
  ...Object.fromEntries(
    [
      'startBLE',
      'acquirePublicBLEMesh',
      'sendBLEMessage',
      'startBLEPrivateChat',
      'sendBLEPrivateMessage',
      'getBLEPeers',
      'getBLEState',
      'startNostr',
      'joinGeohash',
      'sendGeohashMessage',
      'sendGeohashPrivateMessage',
    ].map((name) => [name, mockForward(name as NativeName)])
  ),
  addBLEMessageListener: mockAddListener('bleMessage'),
  addBLEPeerListener: mockAddListener('blePeer'),
  addBLEStateListener: mockAddListener('bleState'),
  addNostrMessageListener: mockAddListener('nostrMessage'),
  addNostrPrivateMessageListener: mockAddListener('nostrPrivate'),
}));
const mockSendGeohash = mockNative.sendGeohashMessage;
const mockSendPrivate = mockNative.sendBLEPrivateMessage;
const mockAsync = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
    getAllKeys: async () => [...mockAsync.keys()],
  };
  return { __esModule: true, default: storage, ...storage };
});
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  useBitchatNickname: () => 'Tester',
}));
const mockIdentity = { nostrPubkey: 'a'.repeat(64) };
jest.mock('@/features/bitchat/hooks/useBitchatBLEIdentityMaterial', () => ({
  useBitchatBLEIdentityMaterial: () => mockIdentity,
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  useBitchatProfileScope: () => 'profile-1',
  getBitchatProfileScope: () => 'profile-1',
}));
jest.mock('@/features/bitchat/hooks/useBLEPeers', () => ({
  useBLEPeers: () => ({ peers: [], connectedCount: 0 }),
}));
jest.mock('@/features/bitchat/hooks/useBluetoothState', () => ({
  useBluetoothState: () => ({ status: 'ready' }),
}));
jest.mock('@/features/bitchat/components/BluetoothNotice', () => ({
  BluetoothInlineNotice: () => null,
  ChatStatusStrip: () => null,
}));
jest.mock('@/shared/ui/composed/chat', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { ChatMessageBubble } = jest.requireActual(
    '@/shared/ui/composed/chat/ChatMessageBubble'
  ) as typeof import('@/shared/ui/composed/chat/ChatMessageBubble');
  const { extractCashuToken } = jest.requireActual(
    '@/shared/ui/composed/chat/extractCashuToken'
  ) as typeof import('@/shared/ui/composed/chat/extractCashuToken');
  return {
    ChatMessageBubble,
    extractCashuToken,
    DmChatHeader: () => null,
    ChatScreen: ({
      messages,
      renderBubble,
      onSend,
      composerDisabled,
      banner,
    }: {
      composerDisabled?: boolean;
      banner?: unknown;
      messages: { id: string; isOwn: boolean; deliveryStatus?: string }[];
      renderBubble?: (args: Record<string, unknown>) => ReactNode;
      onSend: (text: string) => unknown;
    }) => {
      mockRows = messages;
      mockOnSend = onSend;
      mockChat = { composerDisabled, banner };
      return React.createElement(
        React.Fragment,
        null,
        messages.map((message) =>
          React.createElement(
            React.Fragment,
            { key: message.id },
            renderBubble?.({ message, isFirstInGroup: true, isLastInGroup: true })
          )
        )
      );
    },
  };
});
jest.mock('@/shared/ui/composed/chat/CashuTokenBubble', () => ({ CashuTokenBubble: () => null }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('assets/icons', () => () => null);
jest.mock('@/shared/lib/date', () => ({ formatRelative: () => 'now' }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({ ScreenHeaderAction: () => null }));
jest.mock('@/navigation/headerItems', () => ({ withGlassHeaderItems: (o: unknown) => o }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), push: jest.fn() },
}));
jest.mock('@/features/user/components/ModeratedDmBubble', () => ({
  ModeratedDmBubble: () => null,
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: null }),
}));
jest.mock('@/features/feed/stores/ignoreStore', () => {
  const state = () => ({ ignoredPubkeys: mockIgnored, dmFilterEnabled: false, dmFilterWords: [] });
  const useFeedIgnoreStore = (selector: (s: ReturnType<typeof state>) => unknown) =>
    selector(state());
  useFeedIgnoreStore.getState = state;
  return { useFeedIgnoreStore };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (keys: string | readonly string[]) =>
    typeof keys === 'string' ? mockColor : keys.map(() => mockColor),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    bitchatLog: log,
    chatLog: log,
    cashuLog: log,
    storeLog: log,
    log,
    redactError: (e: unknown) => e,
    useLifecycleLogger: () => undefined,
  };
});

function row(
  id: string,
  content: string,
  deliveryStatus: BleDmMessage['deliveryStatus'],
  isOwn = true
): BleDmMessage {
  return {
    id,
    content,
    sender: isOwn ? 'You' : 'peer',
    senderId: isOwn ? '' : PEER,
    timestamp: 1_000,
    isPrivate: true,
    isOwn,
    deliveryStatus,
    isPending: deliveryStatus === 'sending',
  };
}

function seed(...rows: BleDmMessage[]) {
  useBitchatDmMessagesStore.setState({ byPeer: { [PEER]: rows } });
}

const thread = () => useBitchatDmMessagesStore.getState().byPeer[PEER] ?? [];

/** Mark every row of the thread still sending as failed, as a native report would. */
function failSending() {
  act(() => {
    const store = useBitchatDmMessagesStore.getState();
    for (const m of thread()) {
      if (m.deliveryStatus === 'sending') {
        store.applyDeliveryStatus({ messageID: m.id, status: 'failed', reason: 'no session' });
      }
    }
  });
}

async function openChat() {
  const view = render(<GeohashChatScreen transport="ble-dm" dmPeerID={PEER} dmNickname="peer" />);
  await act(async () => undefined);
  return view;
}

const statuses = () => mockRows.map((m) => [m.id, m.isOwn, m.deliveryStatus]);

beforeEach(() => {
  // The Bluetooth DM watchdog runs on these; none of the tests reach 15 s.
  jest.useFakeTimers();
  jest.clearAllMocks();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  useBitchatDmMessagesStore.setState({ byPeer: {} });
  mockRows = [];
  mockIgnored = [];
});

afterEach(() => {
  jest.useRealTimers();
});

describe('delivery shown for each row', () => {
  it('a Bluetooth DM shows the saved status of each own row and none on the peer’s', async () => {
    seed(
      row('s1', 'a', 'sending'),
      row('s2', 'b', 'sent'),
      row('s3', 'c', 'delivered'),
      row('s4', 'd', 'read'),
      row('s5', 'e', 'failed'),
      row('in', 'f', undefined, false)
    );
    await openChat();

    expect(statuses()).toEqual([
      ['s1', true, 'sending'],
      ['s2', true, 'sent'],
      ['s3', true, 'delivered'],
      ['s4', true, 'read'],
      ['s5', true, 'failed'],
      ['in', false, undefined],
    ]);
  });

  it('a public geohash chat shows sending, then sent, on an own row and none on the peer’s', async () => {
    let finish!: () => void;
    mockSendGeohash.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      })
    );
    render(<GeohashChatScreen geohash={GEOHASH} transport="nostr" />);
    await act(async () => undefined);
    act(() => {
      mockListeners.nostrMessage?.forEach((fn) =>
        fn({
          id: 'peer-1',
          content: 'hi',
          sender: 'anon',
          senderPubkey: 'd'.repeat(64),
          timestamp: 1,
          isOwn: false,
          geohash: GEOHASH,
        })
      );
    });

    let sent!: Promise<unknown>;
    act(() => {
      sent = Promise.resolve(mockOnSend?.('gm'));
    });
    expect(mockSendGeohash).toHaveBeenCalledWith('gm', 'Tester');
    expect(mockRows.map((m) => [m.isOwn, m.deliveryStatus])).toEqual([
      [false, undefined],
      [true, 'sending'],
    ]);

    await act(async () => {
      finish();
      await sent;
    });
    expect(mockRows.map((m) => [m.isOwn, m.deliveryStatus])).toEqual([
      [false, undefined],
      [true, 'sent'],
    ]);
  });
});

it('a double tap on "Tap to retry" sends the failed message once', async () => {
  seed(row('failed-1', 'hello there', 'failed'));
  await openChat();

  // Two taps in separate moments, as fingers deliver them: the shared
  // Pressable only drops a second tap while the first handler is running.
  const retry = screen.getByLabelText(RETRY);
  await act(async () => {
    fireEvent.press(retry);
  });
  await act(async () => {
    fireEvent.press(retry);
  });

  expect(mockSendPrivate).toHaveBeenCalledTimes(1);
  expect(mockSendPrivate).toHaveBeenCalledWith(expect.objectContaining({ content: 'hello there' }));
});

it('a failed message that was retried no longer offers a retry, and the new copy can still be retried', async () => {
  seed(row('failed-2', 'second try', 'failed'));
  await openChat();

  await act(async () => {
    fireEvent.press(screen.getByLabelText(RETRY));
  });
  // The retry appended a new copy, which then failed too.
  failSending();

  // Two failed rows, one retry target: the new copy's.
  expect(thread().map((m) => m.deliveryStatus)).toEqual(['failed', 'failed']);
  expect(screen.getAllByLabelText(RETRY)).toHaveLength(1);
  await act(async () => {
    fireEvent.press(screen.getByLabelText(RETRY));
  });
  expect(mockSendPrivate).toHaveBeenCalledTimes(2);
});

it('reopening the chat does not offer a retry for a message already retried', async () => {
  seed(row('failed-3', 'once only', 'failed'));
  const first = await openChat();
  await act(async () => {
    fireEvent.press(screen.getByLabelText(RETRY));
  });
  first.unmount();
  seed(row('failed-3', 'once only', 'failed'));

  await openChat();

  expect(screen.queryByLabelText(RETRY)).toBeNull();
  expect(mockSendPrivate).toHaveBeenCalledTimes(1);
});

it('a blocked person’s geohash DM shows nothing, says how to unblock and sends nothing', async () => {
  const NOSTR_PEER = 'e'.repeat(64);
  mockIgnored = [NOSTR_PEER];
  render(<GeohashChatScreen geohash={GEOHASH} transport="nostr-dm" dmPeerID={NOSTR_PEER} />);
  await act(async () => undefined);
  act(() => {
    mockListeners.nostrPrivate?.forEach((fn) =>
      fn({
        id: 'p1',
        content: 'hi',
        sender: 'anon',
        senderPubkey: NOSTR_PEER,
        timestamp: 1,
        isOwn: false,
        geohash: GEOHASH,
      })
    );
  });

  expect(mockRows).toEqual([]);
  expect(mockChat.composerDisabled).toBe(true);
  expect((mockChat.banner as ReactElement<{ children: string }>).props.children).toBe(
    'This person is blocked. Open “Block or report” to unblock them.'
  );
  await act(async () => {
    await mockOnSend?.('hi');
  });
  expect(mockNative.sendGeohashPrivateMessage).not.toHaveBeenCalled();
});
