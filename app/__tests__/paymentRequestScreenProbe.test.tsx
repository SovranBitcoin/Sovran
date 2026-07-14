/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { PaymentRequestScreen } from '@/features/send/screens/PaymentRequestScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockUseScreenActions = jest.fn();

jest.mock('wallet', () => ({
  isPaymentRequestPreview: (entry: { metadata?: { phase?: string }; operationId?: string }) =>
    entry.metadata?.phase === 'preview' && !entry.operationId,
}));
jest.mock('wallet/react', () => ({
  useScreenActions: (...args: unknown[]) => mockUseScreenActions(...args),
}));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children, footer }: React.PropsWithChildren<{ footer: React.ReactNode }>) => (
    <>
      {children}
      {footer}
    </>
  ),
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/BottomButtons', () => ({
  BottomButtons: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/composed/ButtonHandler', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    ButtonHandler: ({
      buttons,
    }: {
      buttons: { testID: string; text: string; condition?: boolean; onPress: () => void }[];
    }) =>
      ReactActual.createElement(
        ReactActual.Fragment,
        null,
        ...buttons
          .filter((button) => button.condition !== false)
          .map((button) =>
            ReactActual.createElement(
              'MockButton',
              { key: button.testID, testID: button.testID, onPress: button.onPress },
              button.text
            )
          )
      ),
  };
});
jest.mock('@/features/wallet', () => ({ MintSelector: () => null }));
jest.mock('@/features/transactions', () => ({
  HistoryEntryHeader: () => null,
  HistoryEntryRefresh: () => null,
  HistoryEntryTimeline: () => null,
  useBip321Info: jest.fn(() => ({ isBip321: false, optionKinds: null })),
  Bip321MethodIcons: () => null,
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), warn: jest.fn() },
  useLifecycleLogger: jest.fn(),
}));
jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn(() => '30 sats') }));
jest.mock('@/shared/lib/strings', () => ({ truncateMiddle: (value: string) => value }));
jest.mock('@/shared/ui/composed/DetailsSection', () => ({ DetailsSection: () => null }));
jest.mock('@/shared/ui/composed/ScreenStates', () => ({
  ScreenErrorState: () => null,
  ScreenLoadingState: () => null,
}));
jest.mock('@/shared/hooks/useMintInfo', () => ({ useMintInfo: jest.fn(() => null) }));

function screenActions(entry: Record<string, unknown>) {
  return {
    entry,
    error: null,
    source: 'Clipboard',
    mintUrl: entry.mintUrl,
    actions: {
      confirm: { available: true, loading: false, execute: jest.fn() },
      cancel: { available: true, loading: false, execute: jest.fn() },
      back: { available: true, loading: false, execute: jest.fn() },
    },
  };
}

function assertFixedReadyProbe(renderer: TestRenderer.ReactTestRenderer) {
  const ready = renderer.root.find(
    (node) => node.type === 'view' && node.props.testID === 'payment-request-ready'
  );
  expect(ready.props.accessible).toBe(true);
  expect(ready.props.accessibilityRole).toBe('text');
  expect(ready.props.accessibilityLabel).toBe('Payment request ready');
  expect(ready.props.importantForAccessibility).toBe('yes');
  expect(ready.props.collapsable).toBe(false);
  expect(ready.props.pointerEvents).toBe('none');
  expect(ready.props.accessibilityValue).toBeUndefined();
  expect(ready.children).toEqual([]);
}

describe('PaymentRequestScreen QA probes', () => {
  beforeEach(() => {
    mockUseScreenActions.mockReset();
  });

  it('marks a resolved preview and exposes only the safe transaction projection', async () => {
    mockUseScreenActions.mockReturnValue(
      screenActions({
        id: 'pr-preview-1',
        type: 'send',
        state: 'prepared',
        amount: 30,
        unit: 'sat',
        mintUrl: 'https://mint.sovran.money/private/path',
        createdAt: { datetime: '13 July 2026' },
        metadata: { phase: 'preview', paymentRequest: 'creqA-never-expose-me' },
      })
    );
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PaymentRequestScreen paymentRequestEntry="encoded-request" onCancel={jest.fn()} />
      );
    });

    assertFixedReadyProbe(renderer!);
    const probe = renderer!.root.findByProps({ testID: 'transaction-probe-pr-preview-1' });
    expect(JSON.parse(probe.props.accessibilityValue.text)).toEqual({
      direction: 'out',
      amount: 30,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'prepared',
      source: 'paste',
    });
    expect(probe.props.accessibilityValue.text).not.toContain('creqA');
    expect(probe.props.accessibilityValue.text).not.toContain('/private/path');
  });

  it('replaces the preview probe with the rolled-back result without leaking payload fields', async () => {
    mockUseScreenActions.mockReturnValue(
      screenActions({
        id: 'send-operation-1',
        type: 'send',
        state: 'rolledBack',
        operationId: 'send-operation-1',
        amount: 30,
        unit: 'sat',
        mintUrl: 'https://mint.sovran.money',
        createdAt: { datetime: '13 July 2026' },
        metadata: {
          phase: 'rolledBack',
          paymentRequest: 'creqA-never-expose-me',
          token: 'cashuA-never-expose-me',
        },
      })
    );
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <PaymentRequestScreen paymentRequestEntry="encoded-request" onCancel={jest.fn()} />
      );
    });

    assertFixedReadyProbe(renderer!);
    const probe = renderer!.root.findByProps({ testID: 'transaction-probe-send-operation-1' });
    expect(JSON.parse(probe.props.accessibilityValue.text)).toEqual({
      direction: 'out',
      amount: 30,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'rolledBack',
      source: 'paste',
    });
    expect(probe.props.accessibilityValue.text).not.toContain('creqA');
    expect(probe.props.accessibilityValue.text).not.toContain('cashuA');
    expect(renderer!.root.findByProps({ testID: 'payment-request-close' })).toBeDefined();
  });
});
