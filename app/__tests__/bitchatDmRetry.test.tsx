/**
 * "Tap to retry" on a failed Bluetooth direct message, as the chat screen
 * wires it: a retry re-sends the original text once, and the failed bubble
 * does not offer to send it again, whether the person taps twice in a row,
 * taps again after the retry went out, or leaves and reopens the chat.
 *
 * The chat hook is replaced at the screen's boundary (`useBitChat`), so the
 * thread and the send are observed directly. The list is replaced by one that
 * renders each row through the screen's `renderBubble`; the bubble itself is
 * the real one, so the "Tap to retry" target is what a person presses.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { GeohashChatScreen } from '@/features/bitchat/screens/GeohashChatScreen';

const PEER = 'a1b2c3d4e5f60718';
const RETRY = 'Retry sending message';

type Row = {
  id: string;
  content: string;
  sender: string;
  senderId: string;
  timestamp: number;
  isPrivate: boolean;
  isOwn: boolean;
  deliveryStatus?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
};

// eslint-disable-next-line no-restricted-syntax -- a parseable theme fixture, not a UI color
const mockColor = '#222222';
let mockMessages: Row[] = [];
const mockSend = jest.fn(async (_text: string) => undefined);

jest.mock('@/features/bitchat/hooks/useBitChat', () => ({
  useBitChat: () => ({ messages: mockMessages, isConnected: true, sendMessage: mockSend }),
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
    }: {
      messages: { id: string }[];
      renderBubble?: (args: Record<string, unknown>) => ReactNode;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        messages.map((message) =>
          React.createElement(
            React.Fragment,
            { key: message.id },
            renderBubble?.({ message, isFirstInGroup: true, isLastInGroup: true })
          )
        )
      ),
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
  const state = { ignoredPubkeys: [], dmFilterEnabled: false, dmFilterWords: [] };
  const useFeedIgnoreStore = (selector: (s: typeof state) => unknown) => selector(state);
  useFeedIgnoreStore.getState = () => state;
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

function row(id: string, content: string, deliveryStatus: Row['deliveryStatus']): Row {
  return {
    id,
    content,
    sender: 'You',
    senderId: '',
    timestamp: 1_000,
    isPrivate: true,
    isOwn: true,
    deliveryStatus,
  };
}

function openChat() {
  return render(<GeohashChatScreen transport="ble-dm" dmPeerID={PEER} dmNickname="peer" />);
}

beforeEach(() => {
  mockSend.mockClear();
});

it('a double tap on "Tap to retry" sends the failed message once', async () => {
  mockMessages = [row('failed-1', 'hello there', 'failed')];
  openChat();

  // Two taps in separate moments, as fingers deliver them: the shared
  // Pressable only drops a second tap while the first handler is running.
  const retry = screen.getByLabelText(RETRY);
  await act(async () => {
    fireEvent.press(retry);
  });
  await act(async () => {
    fireEvent.press(retry);
  });

  expect(mockSend).toHaveBeenCalledTimes(1);
  expect(mockSend).toHaveBeenCalledWith('hello there');
});

it('a failed message that was retried no longer offers a retry, and the new copy can still be retried', async () => {
  mockMessages = [row('failed-2', 'second try', 'failed')];
  const view = openChat();

  await act(async () => {
    fireEvent.press(screen.getByLabelText(RETRY));
  });
  // The retry appended a new copy, which then failed too.
  mockMessages = [...mockMessages, row('copy-2', 'second try', 'failed')];
  view.rerender(<GeohashChatScreen transport="ble-dm" dmPeerID={PEER} dmNickname="peer" />);

  // Two failed rows, one retry target: the new copy's.
  expect(screen.getAllByLabelText(RETRY)).toHaveLength(1);
  await act(async () => {
    fireEvent.press(screen.getByLabelText(RETRY));
  });
  expect(mockSend).toHaveBeenCalledTimes(2);
});

it('reopening the chat does not offer a retry for a message already retried', async () => {
  mockMessages = [row('failed-3', 'once only', 'failed')];
  const first = openChat();
  await act(async () => {
    fireEvent.press(screen.getByLabelText(RETRY));
  });
  first.unmount();

  openChat();

  expect(screen.queryByLabelText(RETRY)).toBeNull();
  expect(mockSend).toHaveBeenCalledTimes(1);
});
