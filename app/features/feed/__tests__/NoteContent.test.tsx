import { fireEvent, render } from '@testing-library/react-native';

import { NoteContent } from '../components/nostr/NoteContent';

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));
jest.mock('@/features/feed/stores/ignoreStore', () => ({
  useFeedIgnoreStore: (
    select: (state: { ignoredPubkeys: string[]; ignoredEventIds: string[] }) => unknown
  ) => select({ ignoredPubkeys: [], ignoredEventIds: [] }),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: require('react-native').View }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: require('react-native').Text }));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: 'VideoView' }));
jest.mock('react-native-gesture-handler', () => ({ GestureDetector: 'GestureDetector' }));
jest.mock('../components/nostr/useVideoTapGesture', () => ({ useVideoTapGesture: jest.fn() }));
jest.mock('../components/nostr/image-overlay', () => ({
  ImageBlock: 'ImageBlock',
  useImageOverlay: () => null,
}));
jest.mock('../components/nostr/poll/PollCard', () => ({ PollCard: 'PollCard' }));
jest.mock('../components/nostr/RelayCard', () => ({ RelayCard: 'RelayCard' }));
jest.mock('wallet', () => ({ decodeBolt11Invoice: jest.fn() }));
jest.mock('wallet/react', () => ({ usePaymentFlowMachine: jest.fn() }));
jest.mock('@/shared/providers/WalletContextProvider', () => ({ useWalletContext: jest.fn() }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'black' }));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: {} }));
jest.mock('@/shared/lib/url', () => ({ openExternalUrl: jest.fn() }));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: {} }));
jest.mock('@/shared/lib/date', () => ({ formatRelativeUnixSeconds: jest.fn() }));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({ log: {}, feedLog: { info: jest.fn() } }));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useShiftLogger: () => ({ report: jest.fn() }),
  useVisualLayoutLogger: () => ({}),
  VISUAL_LOGGING_ENABLED: false,
}));

const content = 'Long content '.repeat(100);
const props = {
  content,
  quotedEvents: new Map(),
  profiles: new Map(),
  getMetrics: () => ({ likeCount: 0, repostCount: 0, replyCount: 0, satsZapped: 0 }),
};
const note = (id: string) => ({ id, kind: 1, content, tags: [], pubkey: 'author', created_at: 1 });

it('keeps expansion on the same post but collapses a different recycled post, even with identical text', () => {
  const view = render(<NoteContent {...props} event={note('first')} />);
  fireEvent.press(view.getByText('show more'));
  expect(view.getByText('show less')).toBeTruthy();

  view.rerender(<NoteContent {...props} event={note('first')} profiles={new Map()} />);
  expect(view.getByText('show less')).toBeTruthy();

  view.rerender(<NoteContent {...props} event={note('second')} />);
  expect(view.getByText('show more')).toBeTruthy();
  expect(view.queryByText('show less')).toBeNull();
});
