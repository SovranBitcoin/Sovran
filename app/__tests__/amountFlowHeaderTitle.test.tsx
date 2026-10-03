/**
 * @jest-environment node
 *
 * The amount routes set both `title` and a `headerTitle` render function. A
 * `headerTitle` function wins outright — the navigator renders whatever it
 * returns and never falls back to `title` — so the function must return an
 * ELEMENT in every state. Returning the bare string 'Select amount' left both
 * amount pages with no title at all, because a raw string is not renderable
 * inside a native header view.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AmountFlowContent } from '@/features/send/screens/AmountFlowScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capturedOptions: Record<string, unknown>[] = [];
let mockEntry: Record<string, unknown> = { destination: 'mintQuote' };
let mockMintUrl: string | null = null;
let mockMetadata: { nip05: string } | null = null;
let mockAmountProps: { recipientProfile?: { nip05: string | null } } = {};

beforeEach(() => {
  mockEntry = { destination: 'mintQuote' };
  mockMintUrl = null;
  mockMetadata = null;
  mockAmountProps = {};
});

jest.mock('expo-router', () => ({
  Stack: {
    Screen: (props: { options?: Record<string, unknown> }) => {
      if (props.options) capturedOptions.push(props.options);
      return null;
    },
  },
}));
jest.mock('@/features/send/screens/AmountSelector', () => ({
  AmountSelector: (props: typeof mockAmountProps) => {
    mockAmountProps = props;
    return null;
  },
}));
jest.mock('@/features/send/components/AmountSelectedMintProbe', () => ({
  AmountSelectedMintProbe: () => null,
}));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({ E2EActionMenuProbe: () => null }));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({ ScreenErrorState: () => null }));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({ ScreenHeaderAction: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () =>
    jest.requireActual<typeof import('@/shared/lib/themeEngine')>('@/shared/lib/themeEngine')
      .staticColor['shade-0'],
}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: () => ({ metadata: mockMetadata }),
}));
jest.mock('@/shared/lib/identity', () => ({ resolveIdentityName: () => null }));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContextWithOverride: () => ({}),
}));
jest.mock('@/shared/stores/runtime/nearPayStore', () => ({
  useNearPaySessionStore: (selector: (s: unknown) => unknown) => selector({ active: null }),
}));
jest.mock('@/shared/stores/runtime/amountDraftStore', () => ({
  useAmountDraftStore: { getState: () => ({ take: () => null, stash: jest.fn() }) },
}));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useLifecycleLogger: jest.fn(),
  paymentLog: { debug: jest.fn(), info: jest.fn() },
  // persistConfig's rehydrate error branch calls storeLog.warn; a missing
  // symbol throws inside zustand's rehydrate and kills the suite.
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('wallet', () => ({ fetchNip05Pubkey: jest.fn(async () => null) }));
// The lock control's menu host and its coco/nostr lookups are React Native
// and network surfaces; this suite only cares what the header renders.
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({
  actionMenuSheet: jest.fn(),
}));
jest.mock('@/features/send/hooks/useSendLockTarget', () => ({
  useSendLockTarget: () => ({
    gate: { kind: 'unavailable', reason: 'Locking needs a Nostr recipient' },
    refundKey: null,
    loading: false,
  }),
}));
jest.mock('@cashu/coco-react', () => ({ useMints: () => ({ trustedMints: [] }) }));
jest.mock('@/shared/providers/OfflineProvider', () => ({
  useOfflineStatus: () => ({ isOffline: false }),
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (state: { mockOffline: boolean }) => unknown) =>
    select({ mockOffline: false }),
}));
jest.mock('@/shared/stores/runtime/sendLockStore', () => ({
  useSendLockStore: (selector: (s: unknown) => unknown) =>
    selector({ draft: null, set: jest.fn(), clear: jest.fn() }),
}));

jest.mock('wallet/react', () => {
  const mockAction = { available: true, loading: false, execute: jest.fn(async () => undefined) };
  // Stable identity: `useSyncExternalStore` warns about an infinite loop if
  // `getContext` returns a fresh object on every call.
  const mockContext = { recipientPubkey: undefined };
  return {
    useScreenActions: () => ({
      entry: { rawInput: '', numericValue: 0, unit: 'sat', ...mockEntry },
      error: null,
      actions: { back: mockAction, setInput: mockAction, next: mockAction },
      suggestions: [],
      mintUrl: mockMintUrl,
    }),
    usePaymentFlowMachine: () => ({
      subscribe: () => () => undefined,
      getContext: () => mockContext,
      requestMintSelector: jest.fn(),
    }),
    useExecutionState: () => ({ isExecuting: false }),
  };
});

function headerTitleElement() {
  capturedOptions.length = 0;
  void act(() => {
    TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });
  const options = capturedOptions.at(-1);
  const render = options?.headerTitle as (() => React.ReactNode) | undefined;
  expect(typeof render).toBe('function');
  return render!();
}

test('the amount header renders a title element, not a bare string', () => {
  const title = headerTitleElement();

  // The regression: a string here is silently dropped by the native header.
  expect(typeof title).not.toBe('string');
  expect(React.isValidElement(title)).toBe(true);
});

test('that title reads "Select amount" when no recipient replaces it', () => {
  const title = headerTitleElement() as React.ReactElement<{ children?: React.ReactNode }>;

  expect(title.props.children).toBe('Select amount');
});

// ── The lock and sendability status ────────────────────────────────────────
// Both live in the bar of every ecash amount screen. The route draws its own
// bar; inside the Nut Drop radar the bar is the radar's, so the status is
// handed up to it.

type StatusElement = React.ReactElement<{
  lock?: { locked: boolean; label: string };
  canSendOffline: boolean | null;
}>;

const PEER_KEY = `02${'cd'.repeat(32)}`;

test('an ecash amount screen shows the lock in its header', () => {
  mockEntry = { destination: 'sendEcash', p2pkLockPubkey: PEER_KEY, canSendOffline: true };
  mockMintUrl = 'https://mint.example';
  capturedOptions.length = 0;
  void act(() => {
    TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });

  const render = capturedOptions.at(-1)?.headerRight as (() => StatusElement) | undefined;
  expect(typeof render).toBe('function');
  const status = render!();
  expect(status.props.lock).toMatchObject({ locked: true });
  expect(status.props.canSendOffline).toBe(true);
});

test('a receive amount screen has no status in its header', () => {
  capturedOptions.length = 0;
  void act(() => {
    TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });

  expect(capturedOptions.at(-1)?.headerRight).toBeUndefined();
});

test('inline, the status is handed to the host that owns the bar, then taken back', () => {
  mockEntry = { destination: 'sendEcash', p2pkLockPubkey: PEER_KEY };
  mockMintUrl = 'https://mint.example';
  const onHeaderStatus = jest.fn();
  let renderer: TestRenderer.ReactTestRenderer;
  void act(() => {
    renderer = TestRenderer.create(
      <AmountFlowContent headerMode="none" onHeaderStatus={onHeaderStatus} />
    );
  });

  const render = onHeaderStatus.mock.calls.at(-1)?.[0] as (() => StatusElement) | null;
  expect(typeof render).toBe('function');
  expect(render!().props.lock).toMatchObject({ locked: true });

  void act(() => {
    renderer!.unmount();
  });
  expect(onHeaderStatus).toHaveBeenLastCalledWith(null);
});

test.each([
  ['selected@example.com', 'selected@example.com'],
  [null, 'changed@example.com'],
])('retains a known claim or enriches a missing claim %s for the same key', (nip05, expected) => {
  mockEntry = {
    destination: 'sendEcash',
    recipientPubkey: 'ab'.repeat(32),
    recipientProfile: { displayName: 'Alice', avatarUrl: null, nip05 },
  };
  mockMetadata = { nip05: 'changed@example.com' };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });
  expect(mockAmountProps.recipientProfile?.nip05).toBe(expected);
  act(() => renderer.unmount());
});
