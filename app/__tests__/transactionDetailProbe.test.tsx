/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { TransactionDetailShell } from '@/features/transactions/components/detail/TransactionDetailShell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('wallet', () => ({ getCounterparty: jest.fn(() => null) }));
jest.mock('@/shared/ui/composed/Screen', () => ({
  Screen: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => (
    <view {...props}>{children}</view>
  ),
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));
jest.mock('@/features/transactions/components/detail/HistoryEntryHeader', () => ({
  HistoryEntryHeader: () => <header />,
}));
jest.mock('@/features/transactions/components/detail/HistoryEntryRefresh', () => ({
  HistoryEntryRefresh: () => null,
}));
jest.mock('@/features/transactions/components/detail/timeline', () => ({
  HistoryEntryTimeline: () => null,
}));
jest.mock('@/features/transactions/components/CounterpartyTransactions', () => ({
  CounterpartyTransactions: () => null,
}));
jest.mock('@/shared/lib/popup/E2EToastProbe', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    E2EToastProbe: () => ReactActual.createElement('div', { testID: 'e2e-toast-probe-host' }),
  };
});
jest.mock('@/shared/lib/popup/E2EActionMenuProbe', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    E2EActionMenuProbe: () =>
      ReactActual.createElement('div', { testID: 'e2e-action-menu-probe-host' }),
  };
});

describe('TransactionDetailShell device probe', () => {
  it('binds the safe JSON value to transaction-probe-${txRef}', async () => {
    const entry = {
      id: 'receive-1',
      type: 'receive' as const,
      amount: 50,
      unit: 'sat',
      mintUrl: 'https://mint.sovran.money',
      state: 'finalized',
      token: 'cashuB-never-expose-me',
    };
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <TransactionDetailShell
          screenName="ReceiveTokenScreen"
          testID="receive-token-id-receive-1"
          entry={entry as never}
          source="Paste"
          footer={null}>
          <></>
        </TransactionDetailShell>
      );
    });

    const probe = renderer!.root.find(
      (node) => node.type === 'view' && node.props.testID === 'transaction-probe-receive-1'
    );
    const routeReady = renderer!.root.find(
      (node) => node.type === 'view' && node.props.testID === 'receive-token-id-receive-1'
    );
    expect(renderer!.root.findByProps({ testID: 'e2e-toast-probe-host' })).toBeDefined();
    expect(renderer!.root.findByProps({ testID: 'e2e-action-menu-probe-host' })).toBeDefined();
    expect(routeReady.props.accessible).toBe(true);
    expect(routeReady.props.accessibilityRole).toBe('text');
    expect(routeReady.props.accessibilityLabel).toBe('Transaction detail ready');
    expect(routeReady.props.importantForAccessibility).toBe('yes');
    expect(routeReady.props.collapsable).toBe(false);
    expect(routeReady.props.pointerEvents).toBe('none');
    expect(routeReady.children).toEqual([]);
    expect(JSON.parse(probe.props.accessibilityValue.text)).toEqual({
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
      source: 'paste',
    });
    expect(probe.props.accessibilityValue.text).not.toContain('cashuB');
  });
});
