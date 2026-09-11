/** @jest-environment node */
import TestRenderer from 'react-test-renderer';
import Icon, { CurrencyIcon } from 'assets/icons';
import { UnitSwitcherPillFallback } from '@/features/wallet/components/UnitSwitcherPill/UnitSwitcherPill.fallback';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { act, renderHook } from '@testing-library/react-native';
import { useUnitSwitcherPill } from '@/features/wallet/components/UnitSwitcherPill/useUnitSwitcherPill';
const mockSelectUnit = jest.fn();
let mockAvailableUnits = ['sat'];
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: () => null }));
jest.mock('@/shared/ui/composed/ScreenHeaderAction', () => ({ ScreenHeaderAction: () => null }));
jest.mock('@/shared/ui/composed/CapsuleButton', () => ({ CapsuleButton: () => null }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'green' }));
jest.mock('@/shared/lib/popup/popups/actionMenuSheet', () => ({ actionMenuSheet: jest.fn() }));
jest.mock('@/features/wallet/hooks/useActiveUnit', () => ({
  useActiveUnit: () => ({
    unit: 'sat',
    availableUnits: mockAvailableUnits,
    selectUnit: mockSelectUnit,
  }),
}));
jest.mock('@/shared/lib/logger', () => ({ walletLog: { info: jest.fn() } }));
jest.mock('assets/icons', () => ({
  __esModule: true,
  default: () => null,
  CurrencyIcon: () => null,
}));
beforeEach(() => {
  mockSelectUnit.mockClear();
  mockAvailableUnits = ['sat'];
});
describe('receive account picker', () => {
  it('offers Bitcoin when the displayed fiat account is no longer available', () => {
    const { result } = renderHook(() => useUnitSwitcherPill({ displayUnit: 'usd' }));
    expect(result.current.canSwitch).toBe(true);
    expect(result.current.availableOptions.map((option) => option.unit)).toEqual(['sat']);
  });
  it('lets the receive screen guard selection before the active account changes', () => {
    const onSelectUnit = jest.fn();
    const { result } = renderHook(() => useUnitSwitcherPill({ displayUnit: 'usd', onSelectUnit }));
    act(() => result.current.handleSelectUnit('sat'));
    expect(onSelectUnit).toHaveBeenCalledWith('sat');
    expect(mockSelectUnit).not.toHaveBeenCalled();
  });
  it('preserves ordinary wallet selection when no flow override is supplied', () => {
    const { result } = renderHook(() => useUnitSwitcherPill({}));
    act(() => result.current.handleSelectUnit('sat'));
    expect(mockSelectUnit).toHaveBeenCalledWith('sat');
    expect(result.current.canSwitch).toBe(false);
  });
});

it('uses the modal-safe sheet from the canonical receive header action', () => {
  mockAvailableUnits = ['sat', 'usd'];
  const onSelectUnit = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <UnitSwitcherPillFallback header displayUnit="usd" onSelectUnit={onSelectUnit} />
    );
  });
  const header = renderer.root.findByType(ScreenHeaderAction);
  expect(header.props.children.type).toBe(Icon);
  expect(header.props.children.props).toEqual({ name: 'circle-flags:us', size: 24 });
  expect(header.props.disabled).not.toBe(true);
  expect(header.props.accessibilityLabel).toBe('Switch wallet account, USD');
  act(() => {
    header.props.onPress();
  });
  const payload = jest.mocked(actionMenuSheet).mock.calls.at(-1)![0];
  expect(payload.title).toBe('Wallet accounts');
  expect(payload.buttons.map((button) => button.testID)).toEqual([
    'wallet-unit-menu-sat',
    'wallet-unit-menu-usd',
  ]);
  expect(
    payload.buttons.filter((button) => button.suffix !== undefined).map((button) => button.testID)
  ).toEqual(['wallet-unit-menu-usd']);
  act(() => {
    void payload.buttons[0].onPress?.(jest.fn());
  });
  expect(onSelectUnit).toHaveBeenCalledWith('sat');
  act(() => renderer.unmount());
});

it.each([
  { available: ['sat'] },
  { available: ['sat', 'usd'] },
  { available: ['sat', 'eur', 'gbp'] },
])('only offers available wallet units: $available', ({ available }) => {
  mockAvailableUnits = available;
  const onSelectUnit = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <UnitSwitcherPillFallback header displayUnit="sat" onSelectUnit={onSelectUnit} />
    );
  });
  const header = renderer.root.findByType(ScreenHeaderAction);
  expect(header.props.children.type).toBe(CurrencyIcon);
  expect(header.props.children.props).toEqual({ currency: 'sat', width: 24 });
  expect(header.props.disabled).not.toBe(true);
  act(() => {
    header.props.onPress();
  });
  const payload = jest.mocked(actionMenuSheet).mock.calls.at(-1)![0];
  expect(payload.buttons.map((button) => button.testID)).toEqual(
    available.map((unit) => `wallet-unit-menu-${unit}`)
  );
  act(() => {
    for (const button of payload.buttons) void button.onPress?.(jest.fn());
  });
  expect(onSelectUnit.mock.calls).toEqual(available.map((unit) => [unit]));
  act(() => renderer.unmount());
});
