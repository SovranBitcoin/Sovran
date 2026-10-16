/**
 * @jest-environment node
 *
 * A transaction row must never carry a per-row `layout` transition. On
 * Fabric with Reanimated < 4.7 (reanimated#10471) a row inserted or
 * reordered while a sibling's transition is in flight is parked at its
 * neighbour's frame — rows drawn on top of each other — or vanishes, and
 * stays that way. The wallet home list takes history in waves (in-flight
 * supplement, coco page, pending card collapsing away), so this is exactly
 * the traffic that malformed it. The post-cancel collapse is instead an
 * explicit timing on the row's own measured height.
 */
import type { HistoryEntry } from '@cashu/coco-core';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Transaction } from '@/features/transactions/components/Transaction';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (name: string) => (props: Record<string, unknown>) => {
  const R = jest.requireActual<typeof import('react')>('react');
  return R.createElement(name, props, props.children as React.ReactNode);
};

// Shared values are plain boxes and the animated style is evaluated on every
// render, so a test drives the animation by re-rendering after each step.
jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  const View = (props: Record<string, unknown>) =>
    R.createElement('Animated.View', props, props.children as React.ReactNode);
  return {
    __esModule: true,
    default: { View },
    Easing: { linear: 'linear' },
    useSharedValue: (initial: number) => {
      const box = R.useRef({ value: initial });
      return {
        get: () => box.current.value,
        set: (next: number) => {
          box.current.value = next;
        },
      };
    },
    useAnimatedStyle: (worklet: () => Record<string, unknown>) => worklet(),
    withTiming: (target: number) => target,
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (token: string | readonly string[]) =>
    typeof token === 'string' ? 'c' : token.map(() => 'c'),
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (c: string) => c,
}));
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
    walletLog: logger,
    redactError: (e: unknown) => e,
    Log: ({ children }: { children: React.ReactNode }) => children,
  };
});
jest.mock('@/shared/lib/nav/transactionDetailRoutes', () => ({
  navigateToTransactionDetail: jest.fn(),
}));
jest.mock('wallet/react', () => ({ useColadaTransactionAnnotation: () => ({}) }));

let mockCollapsing = false;
jest.mock('@/shared/stores/runtime/rollbackStore', () => ({
  COLLAPSE_DURATION_MS: 260,
  useIsCollapsing: () => mockCollapsing,
  useIsReclaiming: () => false,
}));
jest.mock('@/features/transactions/components/TransactionIcon', () => ({
  __esModule: true,
  default: stub('TransactionIcon'),
}));
jest.mock('@/features/transactions/components/SwipeableRow', () => ({
  SwipeableRow: (props: Record<string, unknown>) => props.children,
}));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AmountFormatter: stub('AmountFormatter'),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: stub('Pressable') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ UntranslatedText: stub('Text') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: stub('HStack') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: stub('VStack') }));
jest.mock('assets/icons', () => ({ __esModule: true, default: stub('Icon') }));

const pendingSend = {
  id: 'send-1',
  type: 'send',
  state: 'pending',
  operationId: 'op-1',
  amount: 100,
  unit: 'sat',
  createdAt: 1,
} as unknown as HistoryEntry;

const flatten = (style: unknown): Record<string, unknown> =>
  (Array.isArray(style) ? style : [style])
    .flat(Infinity)
    .filter(Boolean)
    .reduce<Record<string, unknown>>((acc, s) => ({ ...acc, ...(s as object) }), {});

function renderRow() {
  // A fresh `onCancel` per render defeats the row's React.memo, so each
  // rerender really re-runs the component and its collapse effect.
  const element = () => <Transaction historyEntry={pendingSend} onCancel={() => {}} />;
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element());
  });
  const wrapper = () => renderer.root.findByType('Animated.View' as never);
  const rerender = () => act(() => renderer.update(element()));
  return { wrapper, rerender };
}

beforeEach(() => {
  mockCollapsing = false;
});

describe('Transaction row wrapper', () => {
  it('carries no layout transition and renders at its natural height', () => {
    const { wrapper } = renderRow();
    const { props } = wrapper();
    expect(props).not.toHaveProperty('layout');
    expect(props).not.toHaveProperty('entering');
    expect(props).not.toHaveProperty('exiting');
    expect(props.className).toBe('overflow-hidden');
    const style = flatten(props.style);
    expect(style.opacity).toBe(1);
    expect(style).not.toHaveProperty('height');
  });

  it('collapses to zero height from the height it measured while open', () => {
    const { wrapper, rerender } = renderRow();
    act(() => {
      wrapper().props.onLayout({ nativeEvent: { layout: { height: 70 } } });
    });

    mockCollapsing = true;
    rerender(); // effect starts the (instantly settled) timing
    rerender(); // animated style reads the settled progress

    const style = flatten(wrapper().props.style);
    expect(style.height).toBe(0);
    expect(style.opacity).toBe(0);
  });
});
