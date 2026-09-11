/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Amount, getEncodedToken } from '@cashu/cashu-ts';

import { UserMessagesScreen } from '@/features/user/screens/UserMessagesScreen';
import { useDmEchoStore } from '@/shared/stores/runtime/dmEchoStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PEER_PUBKEY = '22'.repeat(32);
let mockDemoEnabled = false;
const mockOwnPubkey = '11'.repeat(32);
let mockActiveOwnPubkey = mockOwnPubkey;
const SELF_WRAP_ID = 'self-wrap-1';
const TOKEN = getEncodedToken({
  mint: 'https://mint.sovran.money',
  unit: 'sat',
  proofs: [
    {
      amount: Amount.from(20),
      id: '009a1f293253e41e',
      secret: 'dm-echo-proof',
      C: `02${'ab'.repeat(32)}`,
    },
  ],
});

const mockRefresh = jest.fn();
const mockLoadMore = jest.fn();
const mockUseDmThread = jest.fn();

let mockThreadState: {
  messages: {
    id: string;
    content: string;
    senderPubkey: string;
    createdAt: number;
    isOwn: boolean;
  }[];
  loading: boolean;
  hasMore: boolean;
  loadMore: typeof mockLoadMore;
  refresh: typeof mockRefresh;
  error: Error | null;
};

function threadState(overrides: Partial<typeof mockThreadState> = {}): typeof mockThreadState {
  return {
    messages: [],
    loading: false,
    hasMore: false,
    loadMore: mockLoadMore,
    refresh: mockRefresh,
    error: null,
    ...overrides,
  };
}

function ownCashuBubbles(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    (node) => String(node.type) === 'pressable' && node.props.testID === 'cashu-bubble-own'
  );
}

jest.mock('@/features/payments/hooks/useDmThread', () => ({
  useDmThread: (...args: unknown[]) => mockUseDmThread(...args),
}));

jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (callback: () => void | (() => void)) =>
      ReactActual.useEffect(callback, [callback]),
  };
});

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    NDKEvent: class NDKEvent {},
    useNDK: () => ({ ndk: {} }),
  }),
  { virtual: true }
);

jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({
    keys: { pubkey: mockActiveOwnPubkey, privateKey: new Uint8Array(32).fill(1) },
  }),
}));

jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) =>
    selector({ mockMode: mockDemoEnabled }),
}));

jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: () => ({ metadata: { name: 'Test peer' } }),
}));

jest.mock('wallet/react', () => ({
  usePaymentFlowMachine: () => ({ startSendEcash: jest.fn() }),
}));

jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContext: () => ({}),
}));

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { back: jest.fn(), navigate: jest.fn() },
}));

jest.mock('@/shared/lib/cashu/npc', () => ({ getNpcAddress: () => undefined }));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({
  isMockContactPubkey: () => true,
  getMockDmThread: () => [
    {
      id: 'demo-dm-fixture',
      content: 'A demo message',
      isOwn: false,
      created_at: 1700000000,
      pubkey: '22'.repeat(32),
    },
  ],
}));
jest.mock('@/shared/lib/popup', () => ({ staticPopup: jest.fn() }));
jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    cashuLog: logger,
    chatLog: logger,
    log: logger,
    useLifecycleLogger: jest.fn(),
    // CashuTokenBubble's decode path spreads these into its log fields, and
    // its catch turns a missing symbol into a silently unrendered bubble.
    mintUrlLogFields: () => ({}),
    redactError: (error: unknown) => error,
    storeLog: logger,
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'theme-color') : 'theme-color',
}));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: () => '$0.00' }));
jest.mock('@/shared/lib/cashu/utils', () => ({ buildReceiveHistoryEntry: jest.fn() }));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (color: string) => color,
}));

jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    VStack: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('vstack', props, children),
  };
});
jest.mock('@/shared/ui/primitives/View/HStack', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    HStack: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('hstack', props, children),
  };
});
jest.mock('@/shared/ui/primitives/Pressable', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Pressable: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('pressable', props, children),
  };
});
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <text {...props}>{children}</text>
  ),
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/shared/ui/primitives/Button', () => ({ Button: () => null }));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({ AmountFormatter: () => null }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

jest.mock('@/shared/ui/composed/chat', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { CashuTokenBubble } = jest.requireActual<
    typeof import('@/shared/ui/composed/chat/CashuTokenBubble')
  >('@/shared/ui/composed/chat/CashuTokenBubble');
  const { extractCashuToken } = jest.requireActual<
    typeof import('@/shared/ui/composed/chat/extractCashuToken')
  >('@/shared/ui/composed/chat/extractCashuToken');

  return {
    extractCashuToken,
    DmChatHeader: () => null,
    ChatScreen: ({
      messages,
      isLoading,
      loadingContent,
      emptyContent,
    }: {
      messages: { id: string; cashuToken?: string; isOwn: boolean }[];
      isLoading?: boolean;
      loadingContent?: React.ReactNode;
      emptyContent?: React.ReactNode;
    }) =>
      ReactActual.createElement(
        'chat-screen',
        { testID: 'chat-screen', isLoading, messageCount: messages.length },
        isLoading
          ? loadingContent
          : messages.length === 0
            ? emptyContent
            : messages.map((message) =>
                message.cashuToken
                  ? ReactActual.createElement(CashuTokenBubble, {
                      key: message.id,
                      token: message.cashuToken,
                      isOwn: message.isOwn,
                    })
                  : ReactActual.createElement('message', { key: message.id })
              )
      ),
  };
});

describe('UserMessagesScreen optimistic DM echoes', () => {
  beforeEach(() => {
    mockDemoEnabled = false;
    mockRefresh.mockReset();
    mockLoadMore.mockReset();
    useDmEchoStore.setState({ byThread: {} });
    mockUseDmThread.mockImplementation(() => mockThreadState);
    mockActiveOwnPubkey = mockOwnPubkey;
  });

  it('keeps the sent Cashu bubble rendered while server history moves from loading to error', async () => {
    useDmEchoStore.getState().append('nip17', mockOwnPubkey, PEER_PUBKEY, {
      id: SELF_WRAP_ID,
      content: TOKEN,
      isOwn: true,
      created_at: 1_700_000_000,
      pubkey: mockOwnPubkey,
    });
    mockThreadState = threadState({ loading: true });

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip17" />);
    });

    expect(renderer!.root.findByProps({ testID: 'dm-chat-probe' })).toBeTruthy();
    expect(ownCashuBubbles(renderer!)).toHaveLength(1);
    expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.isLoading).toBe(false);

    mockThreadState = threadState({ error: new Error('nagg unavailable') });
    await act(async () => {
      renderer!.update(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip17" />);
    });

    expect(renderer!.root.findByProps({ testID: 'dm-chat-probe' })).toBeTruthy();
    expect(ownCashuBubbles(renderer!)).toHaveLength(1);
    expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.messageCount).toBe(1);
  });

  it('reconciles the matching server self-copy without rendering a duplicate bubble', async () => {
    useDmEchoStore.getState().append('nip17', mockOwnPubkey, PEER_PUBKEY, {
      id: SELF_WRAP_ID,
      content: TOKEN,
      isOwn: true,
      created_at: 1_700_000_000,
      pubkey: mockOwnPubkey,
    });
    mockThreadState = threadState({
      messages: [
        {
          id: SELF_WRAP_ID,
          content: TOKEN,
          senderPubkey: mockOwnPubkey,
          createdAt: 1_700_000_000,
          isOwn: true,
        },
      ],
    });

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip17" />);
    });

    expect(ownCashuBubbles(renderer!)).toHaveLength(1);
    expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.messageCount).toBe(1);
  });

  it("does not seed a NIP-17 Cashu echo into the same peer's NIP-04 thread", async () => {
    useDmEchoStore.getState().append('nip17', mockOwnPubkey, PEER_PUBKEY, {
      id: SELF_WRAP_ID,
      content: TOKEN,
      isOwn: true,
      created_at: 1_700_000_000,
      pubkey: mockOwnPubkey,
    });
    mockThreadState = threadState();

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip04" />);
    });

    expect(ownCashuBubbles(renderer!)).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.messageCount).toBe(0);
  });

  it("does not seed another profile's bearer-token echo after an in-process switch", async () => {
    useDmEchoStore.getState().append('nip17', mockOwnPubkey, PEER_PUBKEY, {
      id: SELF_WRAP_ID,
      content: TOKEN,
      isOwn: true,
      created_at: 1_700_000_000,
      pubkey: mockOwnPubkey,
    });
    mockActiveOwnPubkey = '33'.repeat(32);
    mockThreadState = threadState();

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip17" />);
    });

    expect(ownCashuBubbles(renderer!)).toHaveLength(0);
    expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.messageCount).toBe(0);
  });
});

it('removes demo messages when Mock Mode is disabled on the mounted conversation', async () => {
  mockDemoEnabled = true;
  mockThreadState = threadState();
  mockUseDmThread.mockImplementation(() => mockThreadState);
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip17" />);
  });
  expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.messageCount).toBe(1);
  mockDemoEnabled = false;
  await act(async () => {
    renderer!.update(<UserMessagesScreen pubkey={PEER_PUBKEY} protocol="nip17" />);
  });
  expect(renderer!.root.findByProps({ testID: 'chat-screen' }).props.messageCount).toBe(0);
  await act(async () => renderer!.unmount());
});
