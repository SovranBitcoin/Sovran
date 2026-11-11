/**
 * @jest-environment node
 *
 * The sizes both BalancePill variants draw: the outer width (the caller's,
 * else the wallet-header width for the window), the outer height (the
 * caller's, else the header button height), and the width and height the
 * balance row inside is given. Flat honours an explicit content width; liquid
 * always derives it from the button width.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import BalancePillFlat from '@/shared/ui/composed/BalancePill/BalancePill.flat';
import BalancePillLiquid from '@/shared/ui/composed/BalancePill/BalancePill.liquid';
import { getHeaderTitleWidthFromWidth, HEADER_LAYOUT } from '@/features/wallet/lib/walletHeader';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

jest.mock('react-native-web/dist/exports/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));
jest.mock('react-native-web/dist/exports/View', () => ({
  __esModule: true,
  default: mockHost('RNView'),
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('RNView') }));
jest.mock('heroui-native', () => {
  const PressableFeedback = Object.assign(mockHost('Pressable'), { Ripple: () => null });
  return { PressableFeedback };
});
jest.mock('@expo/ui/swift-ui', () => ({ Host: mockHost('Host'), Button: mockHost('SwiftButton') }));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  environment: () => ({}),
  frame: (f: unknown) => ({ frame: f }),
  glassEffect: () => ({}),
}));
jest.mock('@/shared/hooks/useColorScheme', () => ({ useColorScheme: () => 'dark' }));
jest.mock('@/shared/styles/appStyle', () => ({ useControlChrome: () => ({}) }));
jest.mock('@/shared/ui/composed/BalancePill/BalanceDisplay', () => ({
  __esModule: true,
  default: mockHost('BalanceDisplay'),
}));
jest.mock('@/shared/stores/global/settingsStore', () => {
  const state = { mockNoGlass: false };
  const useSettingsStore = (select: (s: typeof state) => unknown) => select(state);
  useSettingsStore.getState = () => state;
  return { useSettingsStore };
});

type Props = React.ComponentProps<typeof BalancePillFlat>;
const base: Props = { title: 'Mint', balance: 1, unit: 'sat' } as Props;

function drawn(Pill: typeof BalancePillFlat, props: Partial<Props>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<Pill {...base} {...props} />);
  });
  const outer = renderer.root.findAllByType('RNView' as never)[0]!.props.style;
  const flatOuter = Array.isArray(outer) ? Object.assign({}, ...outer) : outer;
  const row = renderer.root.findByType('BalanceDisplay' as never).props;
  act(() => renderer.unmount());
  return {
    width: flatOuter.width,
    height: flatOuter.height,
    contentWidth: row.contentWidth,
    contentHeight: row.contentHeight,
  };
}

const HEADER_WIDTH = getHeaderTitleWidthFromWidth(390);
const DEFAULT_CONTENT_HEIGHT = HEADER_LAYOUT.BUTTON_HEIGHT - HEADER_LAYOUT.CONTENT_PADDING_VERTICAL;

describe.each([
  ['flat', BalancePillFlat, 12],
  ['liquid', BalancePillLiquid, 12],
] as const)('%s', (variant, Pill, padding) => {
  it('defaults to the header width and height', () => {
    expect(drawn(Pill, {})).toEqual({
      width: HEADER_WIDTH,
      height: HEADER_LAYOUT.BUTTON_HEIGHT,
      contentWidth: HEADER_WIDTH - padding * 2,
      contentHeight: DEFAULT_CONTENT_HEIGHT,
    });
  });

  it('takes the caller’s width, height and content height', () => {
    expect(drawn(Pill, { width: 280, height: 40, contentHeight: 30 })).toEqual({
      width: 280,
      height: 40,
      contentWidth: 280 - padding * 2,
      contentHeight: 30,
    });
  });

  it('with an explicit content width, flat uses it and liquid does not', () => {
    expect(drawn(Pill, { width: 280, contentWidth: 100 }).contentWidth).toBe(
      variant === 'flat' ? 100 : 280 - padding * 2
    );
  });
});
