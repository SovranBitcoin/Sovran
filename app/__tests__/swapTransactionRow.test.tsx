/**
 * The status a swap's history row shows, from its saved group and legs.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SwapTransactionRow } from '@/features/transactions/components/SwapTransactionRow';
import type { SwapGroup, SwapLeg } from '@/shared/stores/profile/swapTransactionsStore';

function mockHost(name: string) {
  const R = jest.requireActual<typeof import('react')>('react');
  return (props: Record<string, unknown>) =>
    R.createElement(name, props, props.children as React.ReactNode);
}

jest.mock('@/shared/ui/primitives/Text', () => ({
  UntranslatedText: mockHost('UntranslatedText'),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: mockHost('Pressable') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: mockHost('HStack') }));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({ VStack: mockHost('VStack') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('assets/icons', () => mockHost('Icon'));
jest.mock('@/shared/hooks/useGuardedRouter', () => ({ guardedRouter: { navigate: jest.fn() } }));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: readonly string[]) => tokens.map((token) => token),
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (c: string) => c }));
jest.mock('@/shared/lib/date', () => ({ formatDate: () => 'date' }));
jest.mock('@/shared/lib/logger', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn() },
    Log: ({ children }: { children: React.ReactNode }) =>
      R.createElement(R.Fragment, null, children),
  };
});

function leg(localStatus: SwapLeg['localStatus'], over: Partial<SwapLeg> = {}): SwapLeg {
  return {
    id: `leg-${localStatus}`,
    fromMintUrl: 'a',
    toMintUrl: 'b',
    amount: 10,
    localStatus,
    ...over,
  };
}

function statusOf(state: SwapGroup['state'], legs: SwapLeg[]) {
  const group: SwapGroup = { id: 'g', unit: 'sat', createdAt: 0, title: 'Swap', state, legs };
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<SwapTransactionRow group={group} />);
  });
  const texts = renderer.root
    .findAllByType('UntranslatedText' as never)
    .map((node) => [node.props.children, node.props.color]);
  act(() => renderer.unmount());
  // The second text is the status, coloured by what it says.
  return texts[1];
}

it.each([
  ['a running group', 'running', [leg('done')], ['Pending', 'foreground']],
  // A running group may still start or settle a leg: it is not over, so not failed.
  ['a failed leg in a running group', 'running', [leg('failed')], ['Pending', 'foreground']],
  ['a finished group', 'finished', [leg('done')], ['Completed', 'success']],
  [
    'a finished group with a failed leg',
    'finished',
    [leg('done'), leg('failed')],
    ['Failed', 'danger'],
  ],
  [
    'a finished group with a settling leg',
    'finished',
    [leg('settling')],
    ['Pending', 'foreground'],
  ],
  [
    'a finished group with a payment pending',
    'finished',
    [leg('paymentPending')],
    ['Pending', 'foreground'],
  ],
  ['a cancelled group', 'cancelled', [leg('done')], ['Completed', 'success']],
  [
    'a cancelled group with a failed leg',
    'cancelled',
    [leg('done'), leg('failed')],
    ['Failed', 'danger'],
  ],
  [
    'a cancelled group with a leg that never ran',
    'cancelled',
    [leg('pending')],
    ['Completed', 'success'],
  ],
  [
    'a cancelled group with an invoice and no melt',
    'cancelled',
    [leg('invoiceReady')],
    ['Completed', 'success'],
  ],
] as const)('%s', (_name, state, legs, expected) => {
  expect(statusOf(state, [...legs])).toEqual(expected);
});

describe('a leg whose melt or mint can still complete keeps the swap pending, however the group was saved', () => {
  it.each([
    ['settling', leg('settling')],
    ['paymentPending', leg('paymentPending')],
    ['melting', leg('melting', { meltOperationId: 'melt-op' })],
  ])('beside a failed leg: %s', (_name, moving) => {
    for (const state of ['running', 'finished', 'cancelled'] as const) {
      expect([state, statusOf(state, [leg('failed', { id: 'leg-f' }), moving])]).toEqual([
        state,
        ['Pending', 'foreground'],
      ]);
    }
  });

  it.each([
    ['melting', leg('melting', { meltOperationId: 'melt-op' })],
    ['verifying', leg('verifying', { meltOperationId: 'melt-op' })],
    ['settling', leg('settling')],
    ['paymentPending', leg('paymentPending')],
    ['invoiceReady with a melt', leg('invoiceReady', { meltOperationId: 'melt-op' })],
  ])('%s', (_name, moving) => {
    for (const state of ['running', 'finished', 'cancelled'] as const) {
      expect([state, statusOf(state, [leg('done'), moving])]).toEqual([
        state,
        ['Pending', 'foreground'],
      ]);
    }
  });
});
