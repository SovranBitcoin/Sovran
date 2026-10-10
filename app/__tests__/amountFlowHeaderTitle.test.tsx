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

import { useNotePickerStore } from '@/shared/stores/runtime/notePickerStore';
import { AmountFlowContent } from '@/features/send/screens/AmountFlowScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capturedOptions: Record<string, unknown>[] = [];
let mockEntry: Record<string, unknown> = { destination: 'mintQuote' };
let mockMintUrl: string | null = null;
let mockMetadata: { nip05: string } | null = null;
let mockAmountProps: {
  recipientProfile?: { nip05: string | null };
  onPickNotes?: () => void;
} = {};
let mockProofAmounts: Record<string, number[]> = {};

beforeEach(() => {
  mockEntry = { destination: 'mintQuote' };
  mockMintUrl = null;
  mockMetadata = null;
  mockAmountProps = {};
  mockProofAmounts = {};
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
jest.mock('@/shared/ui/composed/Nip05Identity', () => ({ Nip05Identity: () => null }));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { push: jest.fn() } }));
jest.mock('@/shared/providers/WalletContextProvider', () => ({
  useWalletContextWithOverride: () => ({ proofAmounts: mockProofAmounts }),
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

// ── The lock and network status ────────────────────────────────────────────
// The amount screen's own display shows them, so the bar carries neither and
// the content is told what to show.

const PEER_KEY = `02${'cd'.repeat(32)}`;

test('an ecash amount screen leaves the status out of its header', () => {
  mockEntry = { destination: 'sendEcash', p2pkLockPubkey: PEER_KEY, canSendOffline: true };
  mockMintUrl = 'https://mint.example';
  capturedOptions.length = 0;
  void act(() => {
    TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });

  expect(capturedOptions.at(-1)?.headerRight).toBeUndefined();
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

// ── The note picker ─────────────────────────────────────────────────────────

const openPickerWith = (entry: Record<string, unknown>) => {
  mockEntry = { destination: 'sendEcash', unit: 'sat', ...entry };
  mockMintUrl = 'https://mint.example';
  mockProofAmounts = { 'https://mint.example': [64, 8, 2] };
  void act(() => {
    TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });
  void act(() => mockAmountProps.onPickNotes?.());
  return useNotePickerStore.getState().request;
};

test('the picker opens on an amount that can already leave offline', () => {
  const request = openPickerWith({
    canSendOffline: true,
    // Typed as dollars: the figure on the keypad is not the sat amount.
    inputMode: 'fiat',
    numericValue: 0.06,
    effectiveAmount: { value: 74, unit: 'sat' },
  });

  expect(request).toMatchObject({ notes: [64, 8, 2], unit: 'sat', amount: 74 });
});

test('the picker opens empty on an amount the mint would have to make', () => {
  const request = openPickerWith({
    canSendOffline: false,
    numericValue: 20,
    effectiveAmount: { value: 20, unit: 'sat' },
  });

  expect(request?.amount).toBe(0);
});

test('a payment that is not an ecash send offers no picker', () => {
  mockEntry = { destination: 'mintQuote' };
  mockMintUrl = 'https://mint.example';
  mockProofAmounts = { 'https://mint.example': [64] };
  void act(() => {
    TestRenderer.create(<AmountFlowContent headerMode="native" />);
  });

  expect(mockAmountProps.onPickNotes).toBeUndefined();
});
