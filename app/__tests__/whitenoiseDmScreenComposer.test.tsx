/**
 * The White Noise conversation screen's send box: it opens only once the
 * conversation has loaded, so nothing typed can reach a send that would not
 * yet know whether a group already exists; and a blocked person's
 * conversation shows nothing, says how to unblock and sends nothing.
 *
 * The conversation hook is replaced at the screen's boundary
 * (`useWhitenoiseDM`), and the chat surface records the props it is given.
 */
import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import { WhitenoiseDMScreen } from '@/features/whitenoise/screens/WhitenoiseDMScreen';

const PEER = 'b'.repeat(64);

let mockDm = {
  isClientReady: true,
  isLoading: true,
  isCreatingGroup: false,
  error: null as string | null,
  hasGroup: false,
  messages: [],
  send: jest.fn(async (_text: string) => undefined),
};
type ChatProps = {
  composerDisabled?: boolean;
  messages?: unknown[];
  banner?: ReactNode;
  onSend?: (text: string) => unknown;
};
let mockChatProps: ChatProps = {};
let mockIgnored: string[] = [];

jest.mock('@/features/whitenoise/hooks/useWhitenoiseDM', () => ({
  useWhitenoiseDM: () => mockDm,
}));
jest.mock('@/shared/ui/composed/chat', () => ({
  ChatScreen: (props: ChatProps) => {
    mockChatProps = props;
    return null;
  },
  DmChatHeader: () => null,
  extractCashuToken: () => null,
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/features/user/components/ModeratedDmBubble', () => ({
  ModeratedDmBubble: () => null,
}));
jest.mock('@/features/feed/stores/ignoreStore', () => {
  const state = () => ({ ignoredPubkeys: mockIgnored, dmFilterEnabled: false, dmFilterWords: [] });
  const useFeedIgnoreStore = (selector: (s: ReturnType<typeof state>) => unknown) =>
    selector(state());
  useFeedIgnoreStore.getState = state;
  return { useFeedIgnoreStore };
});
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: null }),
}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: () => ({ metadata: null }),
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (keys: readonly string[]) => keys.map(() => 'black'),
}));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { back: jest.fn() } }));
jest.mock('assets/icons', () => () => null);
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    wnLog: log,
    log,
    storeLog: log,
    redactError: (e: unknown) => e,
    useLifecycleLogger: () => undefined,
  };
});

function openWith(dm: Partial<typeof mockDm>) {
  mockDm = { ...mockDm, ...dm };
  render(<WhitenoiseDMScreen pubkey={PEER} />);
  return mockChatProps.composerDisabled;
}

it('keeps the send box closed while the conversation is loading', () => {
  expect(openWith({ isLoading: true, hasGroup: false })).toBe(true);
});

it('opens the send box once loading has settled, with or without a group', () => {
  expect(openWith({ isLoading: false, hasGroup: true })).toBe(false);
  expect(openWith({ isLoading: false, hasGroup: false })).toBe(false);
});

it('a blocked person’s conversation shows nothing, says how to unblock and sends nothing', async () => {
  mockIgnored = [PEER];
  openWith({
    isLoading: false,
    hasGroup: true,
    messages: [
      { id: 'm1', content: 'hi', authorPubkey: PEER, createdAtSec: 1, isSelf: false },
    ] as never,
  });

  expect(mockChatProps.messages).toEqual([]);
  expect(mockChatProps.composerDisabled).toBe(true);
  await mockChatProps.onSend?.('hi');
  expect(mockDm.send).not.toHaveBeenCalled();
  expect((mockChatProps.banner as ReactElement<{ children: string }>).props.children).toBe(
    'This person is blocked. Open “Block or report” to unblock them.'
  );
  mockIgnored = [];
});
