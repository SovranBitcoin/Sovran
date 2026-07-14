/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AmountSelector } from '@/features/send/screens/AmountSelector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/features/wallet', () => ({ MintSelector: () => null }));
jest.mock(
  '@/features/wallet/components/UnitSwitcherPill',
  () => ({
    UnitSwitcherPill: () => null,
  }),
  { virtual: true }
);
jest.mock('@/shared/lib/currency', () => ({ formatAmount: jest.fn(() => '40 sats') }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
  useLifecycleLogger: jest.fn(),
  walletLog: { debug: jest.fn(), info: jest.fn() },
}));
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: jest.fn(() => false),
}));
jest.mock('@/shared/ui/composed/AmountEntryView', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    AmountEntryView: (props: { contextIndicator?: React.ReactNode }) =>
      ReactActual.createElement('div', props, props.contextIndicator),
  };
});
jest.mock('@/features/send/components/P2PKLockIndicator', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    hasP2PKLock: (entry: Record<string, unknown>) => Boolean(entry.p2pkLockPubkey),
    P2PKLockIndicator: () =>
      ReactActual.createElement('MockIndicator', { testID: 'p2pk-lock-indicator' }),
  };
});

const action = (available = false) => ({
  available,
  loading: false,
  execute: jest.fn(async () => undefined),
  variants: [],
});

describe('AmountSelector P2PK state', () => {
  it('renders the lock indicator when the amount entry carries a lock target', async () => {
    const entry = {
      rawInput: '40',
      numericValue: 40,
      unit: 'sat',
      keyboardUnit: 'sat',
      destination: 'sendEcash',
      p2pkLockPubkey: `02${'11'.repeat(32)}`,
    };
    const actions: React.ComponentProps<typeof AmountSelector>['actions'] = {
      setInput: action(true),
      toggle: action(true),
      next: action(true),
      paste: action(),
      scanQr: action(),
      cancel: action(),
      back: action(),
    };
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector entry={entry} actions={actions} transactionType="send" />
      );
    });

    expect(renderer!.root.findByProps({ testID: 'p2pk-lock-indicator' })).toBeTruthy();
  });

  it('renders one Create ecash action without generic variants, paste, or scan', async () => {
    const entry = {
      rawInput: '40',
      numericValue: 40,
      unit: 'sat',
      keyboardUnit: 'sat',
      destination: 'sendEcash',
      entrySource: 'createEcash',
    };
    const actions: React.ComponentProps<typeof AmountSelector>['actions'] = {
      setInput: action(true),
      toggle: action(true),
      next: {
        ...action(true),
        variants: [
          { id: 'ecash', label: 'Ecash', available: true },
          { id: 'lightning', label: 'Lightning', available: true },
        ],
      },
      paste: action(true),
      scanQr: action(true),
      cancel: action(),
      back: action(),
    };
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector entry={entry} actions={actions} transactionType="send" />
      );
    });

    const amountEntry = renderer!.root.findByType('div');
    expect(amountEntry.props.nextText).toBe('Create ecash');
    expect(amountEntry.props.nextVariants).toBeUndefined();
    expect(amountEntry.props.extraButtons).toEqual([]);
  });
});
