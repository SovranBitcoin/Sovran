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
  // persistConfig's onRehydrateStorage error branch calls storeLog.warn; a
  // missing symbol throws inside zustand's rehydrate and fails the suite.
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/stores/runtime/routstrTopUpStore', () => ({
  useRoutstrTopUpStore: jest.fn(() => false),
}));
jest.mock('@/shared/ui/composed/AmountEntryView', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    AmountEntryView: (props: Record<string, unknown>) => ReactActual.createElement('div', props),
  };
});

const action = (available = false) => ({
  available,
  loading: false,
  execute: jest.fn(async () => undefined),
  variants: [],
});

describe('AmountSelector lock', () => {
  it('"as Ecash" asks about the lock, and there is no separate locked row', async () => {
    const lock = { pubkey: `02${'11'.repeat(32)}` };
    const askLock = jest.fn<Promise<typeof lock | null | undefined>, []>(async () => lock);
    const actions: React.ComponentProps<typeof AmountSelector>['actions'] = {
      setInput: action(true),
      toggle: action(true),
      next: {
        ...action(true),
        variants: [
          { id: 'ecash', label: 'as Ecash', available: true },
          { id: 'lightning', label: 'as Lightning', available: true },
          { id: 'locked-ecash', label: 'as Locked Ecash', available: true },
        ],
      },
      paste: action(),
      scanQr: action(),
      cancel: action(),
      back: action(),
    };
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector
          entry={{ destination: 'sendEcash', rawInput: '40', numericValue: 40 }}
          actions={actions}
          transactionType="send"
          lockChoice={null}
          askLock={askLock}
        />
      );
    });
    const variants = renderer!.root.findByType('div').props.nextVariants;
    expect(variants.map((v: { id: string }) => v.id)).toEqual(['ecash', 'lightning']);
    const ecash = variants.find((v: { id: string }) => v.id === 'ecash');

    await act(async () => {
      await ecash.onPress();
    });
    expect(actions.next.execute).toHaveBeenLastCalledWith({
      variantId: 'locked-ecash',
      p2pkLock: lock,
    });

    askLock.mockResolvedValueOnce(null);
    await act(async () => {
      await ecash.onPress();
    });
    expect(actions.next.execute).toHaveBeenLastCalledWith({ variantId: 'ecash', p2pkLock: null });

    askLock.mockResolvedValueOnce(undefined);
    const calls = (actions.next.execute as jest.Mock).mock.calls.length;
    await act(async () => {
      await ecash.onPress();
    });
    expect((actions.next.execute as jest.Mock).mock.calls.length).toBe(calls);
    await act(async () => {
      renderer!.unmount();
    });
  });

  const lockedEntry = {
    rawInput: '40',
    numericValue: 40,
    unit: 'sat',
    keyboardUnit: 'sat',
    destination: 'sendEcash',
    p2pkLockPubkey: `02${'11'.repeat(32)}`,
  };
  const plainActions = (): React.ComponentProps<typeof AmountSelector>['actions'] => ({
    setInput: action(true),
    toggle: action(true),
    next: action(true),
    paste: action(),
    scanQr: action(),
    cancel: action(),
    back: action(),
  });

  // The lock is shown in the header of every ecash amount screen. The pill
  // under the amount said the same thing a second time, and said less.
  it('puts no lock badge under the amount', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector entry={lockedEntry} actions={plainActions()} transactionType="send" />
      );
    });

    expect(renderer!.root.findAllByProps({ testID: 'p2pk-lock-indicator' })).toEqual([]);
    expect(renderer!.root.findByType('div').props.contextIndicator).toBeUndefined();
  });

  // A flow that arrives locked (a Nut Drop) used to send on its seeded terms
  // without a word. Every locked send now answers for who and how long first.
  it('asks for the lock terms before a locked send leaves, and sends on them', async () => {
    const lock = {
      pubkey: `02${'11'.repeat(32)}`,
      locktimeSec: 1_800_000_000,
      refundKeys: [`02${'22'.repeat(32)}`],
    };
    const confirmLock = jest.fn(async () => lock);
    const actions = plainActions();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector
          entry={lockedEntry}
          actions={actions}
          transactionType="send"
          confirmLock={confirmLock}
          suppressNextVariants
        />
      );
    });

    await act(async () => {
      await renderer!.root.findByType('div').props.onNext();
    });

    expect(confirmLock).toHaveBeenCalledTimes(1);
    expect(actions.next.execute).toHaveBeenCalledWith({ p2pkLock: lock });
  });

  it('sends nothing when the sender backs out of the lock question', async () => {
    const confirmLock = jest.fn(async () => null);
    const actions = plainActions();
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector
          entry={lockedEntry}
          actions={actions}
          transactionType="send"
          confirmLock={confirmLock}
        />
      );
    });

    await act(async () => {
      await renderer!.root.findByType('div').props.onNext();
    });

    expect(confirmLock).toHaveBeenCalledTimes(1);
    expect(actions.next.execute).not.toHaveBeenCalled();
  });

  it('asks through the as Locked Ecash row too when the flow arrived locked', async () => {
    const lock = { pubkey: `02${'11'.repeat(32)}` };
    const confirmLock = jest.fn(async () => lock);
    const actions = {
      ...plainActions(),
      next: {
        ...action(true),
        variants: [{ id: 'locked-ecash', label: 'as Locked Ecash', available: true }],
      },
    };
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <AmountSelector
          entry={lockedEntry}
          actions={actions}
          transactionType="send"
          confirmLock={confirmLock}
        />
      );
    });

    const variants = renderer!.root.findByType('div').props.nextVariants;
    await act(async () => {
      await variants.find((v: { id: string }) => v.id === 'locked-ecash').onPress();
    });

    expect(confirmLock).toHaveBeenCalledTimes(1);
    expect(actions.next.execute).toHaveBeenLastCalledWith({
      variantId: 'locked-ecash',
      p2pkLock: lock,
    });
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
