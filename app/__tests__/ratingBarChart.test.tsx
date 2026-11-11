import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RatingBarChart } from '@/features/mint/components/RatingBarChart';

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));
// Animations resolve to their target at once; a shared value keeps what it was
// last set to, and a style is recomputed on each render.
jest.mock('react-native-reanimated', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: () => undefined, cubic: undefined },
    useSharedValue: (initial: number) =>
      React.useRef({
        current: initial,
        get() {
          return this.current;
        },
        set(next: number) {
          this.current = next;
        },
      }).current,
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (target: number) => target,
    withDelay: (_delay: number, target: number) => target,
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'gold' }));
jest.mock('@/features/mint/components/RatingStars', () => ({ RatingStars: () => null }));
jest.mock('@/shared/ui/composed/AnimatedCountValue', () => ({ useCountRollIn: () => ({}) }));
jest.mock('@/shared/ui/composed/StatsGrid', () => ({ UNKNOWN_STAT: '—' }));
jest.mock('@/shared/ui/composed/SkeletonContentCrossfade', () => ({
  SkeletonContentCrossfade: ({
    loading,
    renderSkeleton,
    renderContent,
  }: {
    loading: boolean;
    renderSkeleton: () => ReactNode;
    renderContent: () => ReactNode;
  }) => (loading ? renderSkeleton() : renderContent()),
}));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: jest.requireActual<typeof import('react-native')>('react-native').Text,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: jest.requireActual<typeof import('react-native')>('react-native').View,
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({
  HStack: jest.requireActual<typeof import('react-native')>('react-native').View,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: jest.requireActual<typeof import('react-native')>('react-native').View,
}));

/** The gold fill's horizontal scale (the share of its row it covers). */
function fillScale(view: ReturnType<typeof render>): number {
  const fill = view.UNSAFE_root.findAll(
    (node) =>
      typeof node.type !== 'string' &&
      StyleSheet.flatten(node.props.style)?.backgroundColor === 'gold'
  )[0];
  const transform = StyleSheet.flatten(fill.props.style).transform as { scaleX: number }[];
  return transform[0].scaleX;
}

it('refills the bar when a refreshed score replaces the cached one', () => {
  const view = render(<RatingBarChart score={4.5} />);
  view.rerender(<RatingBarChart score={4.5} />);
  expect(fillScale(view)).toBeCloseTo(0.9);

  // 3.0 moves the highlight to the three-star row, which it fills completely.
  view.rerender(<RatingBarChart score={3} />);
  view.rerender(<RatingBarChart score={3} />);
  expect(fillScale(view)).toBe(1);
});
