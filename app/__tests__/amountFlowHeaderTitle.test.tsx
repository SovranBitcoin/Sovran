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

jest.mock('expo-router', () => ({
  Stack: {
    Screen: (props: { options?: Record<string, unknown> }) => {
      if (props.options) capturedOptions.push(props.options);
      return null;
    },
  },
}));
jest.mock('@/features/send/screens/AmountSelector', () => ({ AmountSelector: () => null }));
jest.mock('@/features/send/components/AmountSelectedMintProbe', () => ({
  AmountSelectedMintProbe: () => null,
}));
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => ({ E2EActionMenuProbe: () => null }));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({ ScreenErrorState: () => null }));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({ ScreenHeaderAction: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'white' }));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadata: () => ({ metadata: null }),
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

jest.mock('wallet/react', () => {
  const mockAction = { available: true, loading: false, execute: jest.fn(async () => undefined) };
  // Stable identity: `useSyncExternalStore` warns about an infinite loop if
  // `getContext` returns a fresh object on every call.
  const mockContext = { recipientPubkey: undefined };
  return {
    useScreenActions: () => ({
      entry: { rawInput: '', numericValue: 0, unit: 'sat', destination: 'mintQuote' },
      error: null,
      actions: { back: mockAction, setInput: mockAction, next: mockAction },
      suggestions: [],
      mintUrl: null,
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
