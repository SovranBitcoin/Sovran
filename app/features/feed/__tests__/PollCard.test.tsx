import { fireEvent, render, act } from '@testing-library/react-native';
import { PollCard } from '../components/nostr/poll/PollCard';

const mockPublish = jest.fn();
let mockViewer = 'viewer';
const mockNdk = {};
jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    useNDK: () => ({ ndk: mockNdk }),
    NDKEvent: class {},
  }),
  { virtual: true }
);
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: { pubkey: mockViewer } }),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: 'Pressable' }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: require('react-native').Text }));
jest.mock('assets/icons', () => 'Icon');
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => ['black', 'blue', 'gray', 'green'],
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@/shared/lib/nostr/outbox/defaults', () => ({ DEFAULT_RELAYS: [] }));
jest.mock('../components/nostr/poll/usePollVotes', () => ({ usePollVotes: () => [] }));

const poll = (id: string) => ({
  id,
  kind: 1068,
  content: 'Question',
  pubkey: 'author',
  created_at: 1,
  tags: [['option', '1', 'Choice']],
});

beforeEach(() => {
  mockViewer = 'viewer';
  mockPublish.mockReset();
});

it.each(['poll', 'viewer'])('resets a selected option when the %s changes', (scope) => {
  const view = render(<PollCard event={poll('first')} />);
  fireEvent.press(view.getByText('Choice'));
  if (scope === 'viewer') mockViewer = 'another-viewer';
  view.rerender(<PollCard event={poll(scope === 'poll' ? 'second' : 'first')} />);
  fireEvent.press(view.getByText('Vote'));
  expect(mockPublish).not.toHaveBeenCalled();
});

it('does not let a previous poll submission finish the current poll submission', async () => {
  let finishOld!: () => void;
  let finishCurrent!: () => void;
  mockPublish
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishOld = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCurrent = resolve;
        })
    );
  const view = render(<PollCard event={poll('first')} />);
  fireEvent.press(view.getByText('Choice'));
  fireEvent.press(view.getByText('Vote'));
  expect(view.getByText('Voting…')).toBeTruthy();

  view.rerender(<PollCard event={poll('second')} />);
  fireEvent.press(view.getByText('Choice'));
  fireEvent.press(view.getByText('Vote'));
  await act(async () => finishOld());
  expect(view.getByText('Voting…')).toBeTruthy();

  await act(async () => finishCurrent());
  expect(view.getByText('Vote')).toBeTruthy();
});
