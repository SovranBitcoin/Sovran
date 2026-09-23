import { act, create } from 'react-test-renderer';
import { FlashList } from '@shopify/flash-list';
import { ChatScreen } from '@/shared/ui/composed/chat/ChatScreen';
import { ChatSkeleton } from '@/shared/ui/composed/chat/ChatSkeleton';
import { LiquidChatComposer } from '@/shared/ui/composed/chat/LiquidChatComposer';
import { chatLog } from '@/shared/lib/logger';

// Native seams follow chatScreenAvatar.test.tsx; keep the loading surface real.
jest.mock('react-native', () => ({
  View: 'View',
  ScrollView: 'ScrollView',
  Keyboard: { dismiss: jest.fn() },
  StyleSheet: { absoluteFill: {} },
  Platform: { OS: 'ios', select: (values: { default: unknown }) => values.default },
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 12, left: 0, right: 0 }),
}));
jest.mock('react-native-keyboard-controller', () => ({
  KeyboardStickyView: jest.requireMock<typeof import('react-native')>('react-native').View,
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 } }),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireMock<typeof import('react-native')>('react-native').View },
  useAnimatedStyle: (factory: () => object) => factory(),
  FadeIn: { duration: () => undefined },
}));
jest.mock('@shopify/flash-list', () => ({ FlashList: () => null }));
jest.mock('@/shared/ui/composed/chat/LiquidChatComposer', () => ({
  LiquidChatComposer: () => null,
}));
jest.mock('@/shared/ui/composed/chat/ChatMessageBubble', () => ({ ChatMessageBubble: () => null }));
jest.mock('@/shared/ui/composed/chat/useChatSurfacePerfLogger', () => ({
  useChatKeyboardAnimationLogger: () => {},
  useChatSurfacePerfLogger: () => {},
  useComposerHeight: () => [56, jest.fn()],
  useLoggedChatSend: () => jest.fn(),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'black' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: jest.requireMock<typeof import('react-native')>('react-native').View,
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: 'Skeleton' }));
jest.mock('@/shared/lib/logger', () => ({
  chatLog: { debug: jest.fn() },
  // Render-diagnostics emitters (loggerRender) — no-ops here: they only emit.
  useWhyDidRender: () => {},
  useStateChangeLogger: () => {},
  useQueryResultLogger: () => {},
  useRowRenderLogger: () => {},
  countRowRender: () => {},
}));

beforeAll(() => Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }));

it('keeps the composer and draft mounted when loading changes to history', async () => {
  const props = { surface: 'test', log: chatLog, onSend: jest.fn(), composerTestID: 'dm-composer' };
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(<ChatScreen {...props} messages={[]} isLoading />);
  });
  const composer = renderer.root.findByType(LiquidChatComposer);
  expect(composer.props.testID).toBe('dm-composer');
  expect(renderer.root.findByProps({ testID: 'chat-skeleton' })).toBeTruthy();
  expect(renderer.root.findByType(ChatSkeleton).props.bottomPadding).toBe(84);
  expect(renderer.root.findAllByType(FlashList)).toHaveLength(0);
  await act(async () => composer.props.onChangeText('Draft written while loading'));
  await act(async () => {
    renderer.update(
      <ChatScreen
        {...props}
        isLoading={false}
        messages={[{ id: 'one', content: 'Hello', senderId: 'peer', timestamp: 1, isOwn: false }]}
      />
    );
  });
  expect(renderer.root.findByType(LiquidChatComposer)).toBe(composer);
  expect(composer.props.value).toBe('Draft written while loading');
  expect(renderer.root.findAllByType(ChatSkeleton)).toHaveLength(0);
  expect(renderer.root.findByType(FlashList).props.contentContainerStyle.paddingBottom).toBe(84);
  await act(async () => renderer.unmount());
});

it('supports custom loading content while keeping the composer available', async () => {
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <ChatScreen
        surface="test"
        log={chatLog}
        messages={[]}
        onSend={jest.fn()}
        isLoading
        loadingContent="Custom loading"
        composerTestID="custom-composer"
      />
    );
  });
  expect(renderer.root.findByType(LiquidChatComposer).props.testID).toBe('custom-composer');
  expect(renderer.root.findAllByType(ChatSkeleton)).toHaveLength(0);
  expect(JSON.stringify(renderer.toJSON())).toContain('Custom loading');
  await act(async () => renderer.unmount());
});
