import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';
import { ModeratedDmBubble } from '@/features/user/components/ModeratedDmBubble';
import { ChatScreen } from '@/shared/ui/composed/chat/ChatScreen';
import { ChatMessageBubble } from '@/shared/ui/composed/chat/ChatMessageBubble';
import type { ChatBubbleMessage, ChatBubbleRenderArgs } from '@/shared/ui/composed/chat/types';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { chatLog } from '@/shared/lib/logger';

jest.mock('react-native', () => ({
  View: 'View',
  Text: 'Text',
  ScrollView: 'ScrollView',
  Pressable: 'Pressable',
  Keyboard: { dismiss: jest.fn() },
  StyleSheet: { absoluteFill: {} },
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardStickyView: jest.requireMock<typeof import('react-native')>('react-native').View,
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 } }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireMock<typeof import('react-native')>('react-native').View },
  useAnimatedStyle: (factory: () => object) => factory(),
}));
jest.mock('@shopify/flash-list', () => ({
  FlashList: ({
    data,
    renderItem,
  }: {
    data: ChatBubbleMessage[];
    renderItem: (args: { item: ChatBubbleMessage; index: number }) => React.ReactNode;
  }) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireMock<typeof import('react-native')>('react-native');
    return data.map((item, index) =>
      ReactActual.createElement(View, { key: item.id }, renderItem({ item, index }))
    );
  },
}));
jest.mock('@/shared/ui/composed/chat', () => ({
  ChatMessageBubble: jest.requireActual('@/shared/ui/composed/chat/ChatMessageBubble')
    .ChatMessageBubble,
}));
jest.mock('@/shared/ui/composed/chat/LiquidChatComposer', () => ({
  LiquidChatComposer: () => null,
}));
jest.mock('@/shared/ui/composed/chat/useChatSurfacePerfLogger', () => ({
  useChatKeyboardAnimationLogger: () => {},
  useChatSurfacePerfLogger: () => {},
  useComposerHeight: () => [0, jest.fn()],
  useLoggedChatSend: () => jest.fn(),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (names: string | string[]) =>
    Array.isArray(names) ? names.map(() => 'black') : 'black',
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: jest.requireMock<typeof import('react-native')>('react-native').View,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: jest.requireMock<typeof import('react-native')>('react-native').View,
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: jest.requireMock<typeof import('react-native')>('react-native').View,
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: jest.requireMock<typeof import('react-native')>('react-native').Text,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: jest.requireMock<typeof import('react-native')>('react-native').Pressable,
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({
  Avatar: ({ state }: { state: string }) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement(
        jest.requireMock<typeof import('react-native')>('react-native').Text,
        null,
        `${state} avatar`
      ),
}));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: () => null }));
jest.mock('@/shared/ui/primitives/Spinner', () => ({ Spinner: () => null }));
jest.mock('assets/icons', () => () => null);
jest.mock('@/shared/ui/composed/chat/CashuTokenBubble', () => ({ CashuTokenBubble: () => null }));
jest.mock('@/shared/lib/date', () => ({ formatRelative: () => 'now' }));
jest.mock('@/shared/lib/logger', () => ({ chatLog: { debug: jest.fn() } }));

const incoming: ChatBubbleMessage = {
  id: 'incoming-1',
  content: 'Hello',
  senderId: 'peer',
  timestamp: 1,
  isOwn: false,
};

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

it.each([true, false])(
  'renders the peer avatar only on the last incoming message (custom renderer: %s)',
  async (customRenderer) => {
    const messages = [incoming, { ...incoming, id: 'incoming-2' }];
    const renderBubble = customRenderer
      ? (args: ChatBubbleRenderArgs) => (
          <ModeratedDmBubble {...args} enabled={false} words={[]} scope="test-thread" />
        )
      : undefined;
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <ChatScreen
          surface="test"
          log={chatLog}
          messages={messages}
          onSend={jest.fn()}
          counterpartyAvatar={<Text>Peer picture</Text>}
          renderBubble={renderBubble}
        />
      );
    });

    const peerPictures = () =>
      renderer.root.findAllByType(Text).filter((node) => node.props.children === 'Peer picture');
    expect(peerPictures()).toHaveLength(1);
    expect(renderer.root.findAllByType(Avatar)).toHaveLength(0);
    const bubbles = renderer.root.findAllByType(ChatMessageBubble);
    expect(bubbles[0].findAllByProps({ children: 'Peer picture' })).toHaveLength(0);
    expect(bubbles[1].findByProps({ children: 'Peer picture' })).toBe(peerPictures()[0]);

    await act(async () => {
      renderer.update(
        <ChatScreen
          surface="test"
          log={chatLog}
          messages={[{ ...incoming, isOwn: true, senderId: '' }]}
          onSend={jest.fn()}
          counterpartyAvatar={<Text>Peer picture</Text>}
          renderBubble={renderBubble}
        />
      );
    });
    expect(peerPictures()).toHaveLength(0);
    expect(renderer.root.findAllByType(Avatar)).toHaveLength(0);

    await act(async () => {
      renderer.unmount();
    });
  }
);

it.each([undefined, null, <Avatar key="fictional" state="fallback" seed="fictional-peer" />])(
  'preserves omitted, hidden, and fictional-contact avatars through the custom renderer (%s)',
  async (counterpartyAvatar) => {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
        <ChatScreen
          surface="test"
          log={chatLog}
          messages={[incoming]}
          onSend={jest.fn()}
          counterpartyAvatar={counterpartyAvatar}
          renderBubble={(args) => (
            <ModeratedDmBubble {...args} enabled={false} words={[]} scope="test-thread" />
          )}
        />
      );
    });
    const avatars = renderer.root.findAllByType(Avatar);
    expect(avatars).toHaveLength(counterpartyAvatar === null ? 0 : 1);
    if (counterpartyAvatar !== null) {
      expect(avatars[0].props.state).toBe('fallback');
      expect(avatars[0].props.seed).toBe(counterpartyAvatar ? 'fictional-peer' : 'peer');
    }
    await act(async () => {
      renderer.unmount();
    });
  }
);
