/**
 * @jest-environment node
 *
 * A grouped AI request is still ONE payment, so it renders the ordinary
 * transaction row — not a row of its own. Two things change: the amount is the
 * request's real cost (payment minus change, which no single leg carries), and
 * a request whose money came back reads exactly like a cancelled send. A
 * refund and a rollback leave the wallet in the same place; the difference
 * between them belongs on the detail screen, not in a scannable list.
 */
import type { HistoryEntry } from '@cashu/coco-core';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Transaction } from '@/features/transactions/components/Transaction';
import {
  aiRequestAmountSign,
  aiRequestDisplayAmount,
  isAiRequestReturned,
} from '@/features/transactions/lib/aiRequestPresentation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (name: string) => (props: Record<string, unknown>) => {
  const R = jest.requireActual<typeof import('react')>('react');
  return R.createElement(name, props, props.children as React.ReactNode);
};

jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const View = (props: Record<string, unknown>) =>
    R.createElement('Animated.View', props, props.children as React.ReactNode);
  return {
    __esModule: true,
    default: { View },
    Easing: { linear: 'linear' },
    LinearTransition: { duration: () => ({ easing: () => ({}) }) },
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'c' : token.map(() => 'c'),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (c: string) => c }));
jest.mock('@/shared/lib/date', () => ({ formatDate: () => 'today' }));
jest.mock('@/shared/lib/currency', () => ({
  formatAmount: ({ amount }: { amount: number }) => `$${amount}`,
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = jest.fn();
  const logger = { debug: noop, info: noop, warn: noop, error: noop };
  return {
    log: logger,
    cashuLog: logger,
    paymentLog: logger,
    storeLog: logger,
    redactError: (e: unknown) => e,
    Log: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('@/shared/lib/nav/transactionDetailRoutes', () => ({
  navigateToTransactionDetail: jest.fn(),
}));
jest.mock('wallet/react', () => ({ useColadaTransactionAnnotation: () => ({}) }));
jest.mock('@/shared/stores/runtime/rollbackStore', () => ({
  COLLAPSE_DURATION_MS: 1,
  useIsCollapsing: () => false,
  useIsReclaiming: () => false,
}));
jest.mock('@/features/transactions/components/TransactionIcon', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement('TransactionIcon', props);
  },
}));
jest.mock('@/features/transactions/components/SwipeableRow', () => ({
  SwipeableRow: (props: Record<string, unknown>) => props.children,
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AmountFormatter: (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement('AmountFormatter', props);
  },
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: stub('Pressable') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ UntranslatedText: stub('Text') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: stub('HStack') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: stub('VStack') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: stub('Icon') }));

// `Record<string, unknown>` rather than `Partial<HistoryEntry>`: coco brands
// `amount`, and these fixtures set plain numbers.
function sendLeg(over: Record<string, unknown> = {}): HistoryEntry {
  const entry: Record<string, unknown> = {
    id: 'send-1',
    type: 'send',
    state: 'finalized',
    amount: 100,
    unit: 'sat',
    createdAt: 1,
    ...over,
  };
  return entry as unknown as HistoryEntry;
}

function render(node: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(node);
  });
  return renderer;
}

const row = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findByProps({ testID: 'transaction-send-send-1' });
const icon = (r: TestRenderer.ReactTestRenderer) => r.root.findByType('TransactionIcon' as never);
const amount = (r: TestRenderer.ReactTestRenderer) => r.root.findByType('AmountFormatter' as never);

describe('Transaction — grouped AI request', () => {
  it('shows the request’s real cost, not the amount the payment leg carries', () => {
    const r = render(<Transaction historyEntry={sendLeg()} amountOverride={30} />);
    expect(amount(r).props.amount).toBe(30);
    // The fiat subline must follow the same number, or the row contradicts itself.
    expect(
      row(r)
        .findAllByType('Text' as never)
        .some((n) => n.props.children === '$30')
    ).toBe(true);
  });

  it('renders a returned payment exactly like a cancelled one', () => {
    const refunded = render(<Transaction historyEntry={sendLeg()} returned />);
    const cancelled = render(<Transaction historyEntry={sendLeg({ state: 'rolledBack' })} />);

    expect(row(refunded).props.style).toEqual({ opacity: 0.33 });
    expect(row(refunded).props.style).toEqual(row(cancelled).props.style);
    expect(icon(refunded).props.cancelled).toBe(true);
  });

  it('leaves an ordinary settled send undimmed', () => {
    const r = render(<Transaction historyEntry={sendLeg()} />);
    expect(row(r).props.style).toBeUndefined();
    expect(icon(r).props.cancelled).toBe(false);
  });
});

/**
 * The group's own numbers, before any row sees them. Both outcomes where the
 * money ended up back in the wallet compute to zero, and zero is the one
 * figure neither the row nor the detail header may show — it claims nothing
 * happened. Both surfaces read this one function, so they cannot drift apart.
 */
describe('aiRequestDisplayAmount', () => {
  const group = (over: Partial<Parameters<typeof aiRequestDisplayAmount>[0]> = {}) => ({
    state: 'spent' as const,
    paidAmount: 100,
    netAmount: 30,
    legs: [sendLeg({ amount: 240 })],
    ...over,
  });

  it('shows what the answer cost when the request bought something', () => {
    expect(aiRequestDisplayAmount(group())).toBe(30);
    expect(isAiRequestReturned(group())).toBe(false);
  });

  it('shows what was SENT for a refunded request, never the zero net', () => {
    const refunded = group({ state: 'refunded', paidAmount: 240, netAmount: 0 });
    expect(aiRequestDisplayAmount(refunded)).toBe(240);
    expect(isAiRequestReturned(refunded)).toBe(true);
  });

  it('falls back to the payment leg for a cancelled request, which settled nothing', () => {
    // `paidAmount` is 0 here by construction — nothing settled — so the only
    // thing that knows what the request was for is the leg itself.
    const cancelled = group({ state: 'cancelled', paidAmount: 0, netAmount: 0 });
    expect(isAiRequestReturned(cancelled)).toBe(true);
    expect(aiRequestDisplayAmount(cancelled)).toBe(240);
  });

  it('displays the fallback WITHOUT rewriting the ledger figure', () => {
    // The group model is the record of what moved, and for a cancellation the
    // honest answer is still "no sats". Only the display compensates.
    const cancelled = group({ state: 'cancelled', paidAmount: 0, netAmount: 0 });
    aiRequestDisplayAmount(cancelled);
    expect(cancelled.paidAmount).toBe(0);
    expect(cancelled.netAmount).toBe(0);
  });

  it('says zero only when there is no payment leg left to read', () => {
    expect(aiRequestDisplayAmount(group({ state: 'cancelled', paidAmount: 0, legs: [] }))).toBe(0);
  });

  it('still shows the cost while the request is pending', () => {
    expect(aiRequestDisplayAmount(group({ state: 'pending' }))).toBe(30);
  });
});

/**
 * Both returned outcomes read the same in the list: the size of the movement
 * that was attempted, in the send's own red and sign, under the dimming and
 * cancel glyph that say it did not stick.
 */
describe.each([
  ['refunded', { state: 'refunded' as const, paidAmount: 240, netAmount: 0 }, true, 'finalized'],
  ['cancelled', { state: 'cancelled' as const, paidAmount: 0, netAmount: 0 }, false, 'rolledBack'],
])('Transaction — a %s AI request', (_name, groupState, returned, legState) => {
  it('shows the amount that went out, red and signed, never 0', () => {
    const legs = [sendLeg({ amount: 240, state: legState })];
    const displayed = aiRequestDisplayAmount({ ...groupState, legs });
    const r = render(
      <Transaction historyEntry={legs[0]} amountOverride={displayed} returned={returned} />
    );

    expect(amount(r).props.amount).toBe(240);
    // Direction survives the outcome — this is the payment leg, so it is a send.
    expect(amount(r).props.sign).toBe('-');
    // ...under the dimming, which is what says the money is back.
    expect(row(r).props.style).toEqual({ opacity: 0.33 });
    expect(icon(r).props.cancelled).toBe(true);
  });
});

/**
 * The detail header's sign, pinned here because the row and the header now
 * share every part of the amount decision — the figure AND its direction.
 */
describe('aiRequestAmountSign', () => {
  const group = (over: Partial<Parameters<typeof aiRequestAmountSign>[0]> = {}) => ({
    state: 'spent' as const,
    paidAmount: 100,
    netAmount: 30,
    legs: [sendLeg({ amount: 240 })],
    ...over,
  });

  it.each(['refunded', 'cancelled'] as const)(
    'signs a %s request like the send it was',
    (state) => {
      expect(
        aiRequestAmountSign(group({ state, paidAmount: state === 'refunded' ? 240 : 0 }))
      ).toBe('-');
    }
  );

  it('leaves a spent request unsigned — the header states a cost, not a movement', () => {
    expect(aiRequestAmountSign(group())).toBeNull();
  });

  it('drops the sign when there is no movement left to describe', () => {
    expect(aiRequestAmountSign(group({ state: 'cancelled', paidAmount: 0, legs: [] }))).toBeNull();
  });
});
