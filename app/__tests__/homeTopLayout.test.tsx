/**
 * @jest-environment node
 *
 * The top of the wallet home (`HomeTop`): the balance WalletScreen hands it
 * is drawn first, with the full minimum height, above the shortcut row and
 * the payment row; while a swap holds the wallet, the payment row stops
 * touches and dims.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { HomeTop } from '@/features/wallet/home/HomeLayouts';
import type { HomeAction, HomeActions } from '@/features/wallet/home/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({ CapsuleButton: mockHost('Capsule') }));
jest.mock('@/shared/ui/composed/CircleActionRow', () => ({
  CircleActionRow: mockHost('CircleRow'),
}));
jest.mock('@/shared/ui/composed/QRButton', () => ({ QRButton: mockHost('QR') }));

const action = (id: string): HomeAction => ({
  id: id as HomeAction['id'],
  label: id,
  icon: 'i',
  testID: `wallet-${id}`,
  onPress: jest.fn(),
});
const actions = Object.fromEntries(
  ['receive', 'send', 'scan', 'split', 'theme', 'history', 'map'].map((id) => [id, action(id)])
) as unknown as HomeActions;

function Balance({ minHeight }: { minHeight: number }) {
  return React.createElement('Balance', { minHeight });
}

let renderer: TestRenderer.ReactTestRenderer;
async function render(paymentsLocked: boolean) {
  await act(async () => {
    renderer = TestRenderer.create(
      <HomeTop
        actions={actions}
        balance={<Balance minHeight={300} />}
        paymentsLocked={paymentsLocked}
      />
    );
  });
}
afterEach(() => {
  act(() => renderer?.unmount());
});

const paymentRow = () =>
  renderer.root
    .findAllByType('View' as never)
    .find((v) => v.findAllByType('Capsule' as never).length === 2 && v.props.pointerEvents)!;

describe('HomeTop', () => {
  it('draws the balance first at its full minimum height, then the shortcuts, then payments', async () => {
    await render(false);

    const tree = renderer.toJSON() as TestRenderer.ReactTestRendererJSON;
    expect(tree.children!.map((c) => (c as TestRenderer.ReactTestRendererJSON).type)).toEqual([
      'Balance',
      'CircleRow',
      'View',
    ]);
    expect(renderer.root.findByType('Balance' as never).props.minHeight).toBe(300);
    expect(paymentRow().props.pointerEvents).toBe('auto');
  });

  it('while a swap holds the wallet, stops touches on the payment row and dims it', async () => {
    await render(true);

    expect(paymentRow().props.pointerEvents).toBe('none');
    expect(paymentRow().props.style).toEqual(expect.arrayContaining([{ opacity: 0.4 }]));
  });
});
