/**
 * @jest-environment node
 *
 * The mint pill's skeleton → label swap. The label fades in while the bars
 * fade out (so opaque text never shows behind translucent bars), a frame held
 * by the scrubber never pulses, both rows share one minimum height (switching
 * to "Add a mint" does not jump), and a display preference given by the caller
 * reaches the amount instead of the settings store.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import BalanceDisplay from '@/shared/ui/composed/BalancePill/BalanceDisplay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockHost(name: string) {
  return (props: Record<string, unknown>) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(name, props, props.children as React.ReactNode);
  };
}

jest.mock('@/assets/icons', () => ({ __esModule: true, default: mockHost('Icon') }));
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'fg' }));
jest.mock('@/shared/lib/logger', () => ({ Log: mockHost('Log') }));
jest.mock('@/shared/ui/composed/AmountFormatter', () => ({
  AmountFormatter: mockHost('AmountFormatter'),
}));
jest.mock('@/shared/ui/primitives/Avatar', () => ({ Avatar: mockHost('Avatar') }));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: mockHost('Text') }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: mockHost('HStack') }));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: mockHost('RNView') }));
jest.mock('@/shared/ui/primitives/Skeleton', () => ({ Skeleton: mockHost('Skeleton') }));
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: (props: {
    renderSkeleton: () => React.ReactNode;
    renderContent: () => React.ReactNode;
  }) => {
    const R = jest.requireActual<typeof import('react')>('react');
    return R.createElement(
      'Crossfade',
      props,
      R.createElement('SkeletonLayer', null, props.renderSkeleton()),
      R.createElement('ContentLayer', null, props.renderContent())
    );
  },
}));

type Props = React.ComponentProps<typeof BalanceDisplay>;
const progress = { value: 0.5, get: () => 0.5, set: () => {} };

function draw(props: Partial<Props>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<BalanceDisplay title="Mint" balance={21} {...props} />);
  });
  return renderer;
}

function rowMinHeight(layer: TestRenderer.ReactTestInstance) {
  const row = layer.children[0] as TestRenderer.ReactTestInstance;
  const style = row.props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : (style ?? {});
  return flat.minHeight;
}

it('crossfades the label in, rather than leaving it opaque under the bars', () => {
  const r = draw({ isLoading: true });
  expect(r.root.findByType('Crossfade' as never).props.crossfadeContent).toBe(true);
  act(() => r.unmount());
});

it('draws a held scrubber frame with still bars, and the live placeholder pulsing', () => {
  const held = draw({ loadingProgress: progress as never });
  const heldBars = held.root.findAllByType('Skeleton' as never);
  expect(heldBars.length).toBeGreaterThan(0);
  expect(heldBars.every((bar) => bar.props.static === true)).toBe(true);
  act(() => held.unmount());

  const live = draw({ isLoading: true });
  expect(live.root.findAllByType('Skeleton' as never).every((bar) => !bar.props.static)).toBe(true);
  act(() => live.unmount());
});

it('gives the placeholder, balance and call-to-action rows one minimum height', () => {
  for (const props of [{ isLoading: true }, {}, { ctaLabel: 'Add a mint' }] as Partial<Props>[]) {
    const r = draw({ ...props, contentHeight: 36 });
    expect(rowMinHeight(r.root.findByType('SkeletonLayer' as never))).toBe(36);
    expect(rowMinHeight(r.root.findByType('ContentLayer' as never))).toBe(36);
    act(() => r.unmount());
  }
});

it('passes a caller display preference to the amount', () => {
  const fixed = draw({ displayPreference: 0 });
  expect(fixed.root.findByType('AmountFormatter' as never).props.displayPreference).toBe(0);
  act(() => fixed.unmount());
  const stored = draw({});
  expect(stored.root.findByType('AmountFormatter' as never).props.displayPreference).toBe(
    undefined
  );
  act(() => stored.unmount());
});
