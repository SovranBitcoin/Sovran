/**
 * @jest-environment node
 *
 * `AmountFormatter animated` hands the roll what it needs: the formatted
 * text, the value (signed by direction) and a format key that changes on a
 * BTC/sats or unit switch, so that switch snaps instead of rolling. Liquid
 * Glass gets the same three props for its native roll.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockLiquidGlass = false;

function mockHost(name: string) {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const Host = (props: Record<string, unknown>) => ReactActual.createElement(name, props);
  Host.displayName = name;
  return Host;
}

jest.mock('liquid-glass-text', () => ({ LiquidGlassText: mockHost('LiquidGlassText') }));
jest.mock('@/shared/ui/composed/RollingAmountText', () => ({
  RollingAmountText: mockHost('RollingAmountText'),
}));
jest.mock('@/shared/ui/capability', () => ({
  useCapabilities: () => ({ liquidGlass: mockLiquidGlass }),
}));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'fg' }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: { children: React.ReactNode }) => children,
  paymentLog: { debug: jest.fn() },
}));
jest.mock('@/shared/lib/amountDisplay', () => ({
  formatDisplayAmount: (amount: number, unit: string, displayBtc: number) =>
    displayBtc === 2 ? `${amount} sats` : `₿ ${amount} ${unit}`,
}));
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (select: (s: { displayBtc: number }) => number) => select({ displayBtc: 0 }),
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('View') }));

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

beforeEach(() => {
  mockLiquidGlass = false;
});

describe('AmountFormatter animated', () => {
  it('rolls through RollingAmountText with the value and format key', () => {
    const renderer = render(<AmountFormatter amount={1250} unit="sat" animated sign="+" />);
    const rolling = renderer.root.findByType('RollingAmountText' as never);
    expect(rolling.props).toMatchObject({
      text: '+ ₿ 1250 sat',
      numericValue: 1250,
      formatKey: 'sat:0',
    });
  });

  it('changes the format key on a denomination switch and signs an outgoing value', () => {
    const renderer = render(
      <AmountFormatter amount={1250} unit="sat" animated displayPreference={2} sign="-" />
    );
    const rolling = renderer.root.findByType('RollingAmountText' as never);
    expect(rolling.props.formatKey).toBe('sat:2');
    expect(rolling.props.numericValue).toBe(-1250);
  });

  it('keeps the plain text when not animated', () => {
    const renderer = render(<AmountFormatter amount={1250} unit="sat" />);
    expect(renderer.root.findAllByType('RollingAmountText' as never)).toHaveLength(0);
  });

  it('keeps the glass cutouts and passes the roll to the native view', () => {
    mockLiquidGlass = true;
    const renderer = render(<AmountFormatter amount={42} unit="sat" animated liquid />);
    expect(renderer.root.findAllByType('RollingAmountText' as never)).toHaveLength(0);
    const glass = renderer.root.findByType('LiquidGlassText' as never);
    expect(glass.props).toMatchObject({
      text: '₿ 42 sat',
      animated: true,
      numericValue: 42,
      formatKey: 'sat:0',
    });
  });
});
