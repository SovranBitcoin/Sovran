import type { ReactNode } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { MetricsFooter } from '@/features/feed/components/nostr/MetricsFooter';

jest.mock('react-native/Libraries/Utilities/Platform', () => ({
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
}));
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  class Keyframe {
    duration() {
      return this;
    }
  }
  return {
    __esModule: true,
    default: { View },
    Keyframe,
    LayoutAnimationConfig: ({ children }: { children: ReactNode }) => children,
    useReducedMotion: () => false,
    cancelAnimation: () => undefined,
    useSharedValue: (value: number) => ({ value, get: () => value, set: () => undefined }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('assets/icons', () => () => null);
// Visual only. The test helper dispatches a touch to the NEAREST handler, while
// native touches reach every ancestor, so the scale wrapper would hide the bar's.
jest.mock('@/shared/ui/primitives/PressScale', () => ({
  PressScale: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (value: string | string[]) =>
    Array.isArray(value) ? value.map(() => 'black') : 'black',
}));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('@/features/feed/lib/repostMenu', () => ({ openRepostMenu: jest.fn() }));
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children, loading }: { children?: ReactNode; loading?: boolean }) =>
    loading ? null : require('react').createElement(require('react-native').Text, null, children),
}));
jest.mock('@/shared/ui/primitives/Pressable', () => ({
  Pressable: require('react-native').Pressable,
}));
jest.mock('@/shared/ui/primitives/View/View', () => ({ View: require('react-native').View }));
jest.mock('@/shared/ui/primitives/View/HStack', () => ({ HStack: require('react-native').View }));

const metrics = { likeCount: 0, repostCount: 3, replyCount: 0, satsZapped: 0 };

it('hides zero counts and shows real ones', () => {
  const view = render(<MetricsFooter metrics={metrics} borderColor="black" />);
  expect(view.queryByText('0')).toBeNull();
  expect(view.getByText('3')).toBeOnTheScreen();
});

it('shows a dash for tallies no source could count, never a zero', () => {
  const view = render(<MetricsFooter metrics={metrics} borderColor="black" counts="unavailable" />);
  // reply, repost and like dash; sats render no number at all
  expect(view.getAllByText('—')).toHaveLength(3);
});

it('keeps a like that is still publishing pressable, so it can be undone at once', () => {
  const onLikePress = jest.fn();
  const view = render(
    <MetricsFooter metrics={metrics} borderColor="black" onLikePress={onLikePress} likePending />
  );
  fireEvent.press(view.getByLabelText(/^Like\./));
  expect(onLikePress).toHaveBeenCalledTimes(1);
});

it('claims every touch in the bar for the card, including on a control without a handler', () => {
  const onActionPressIn = jest.fn();
  const onCommentPress = jest.fn();
  const view = render(
    <MetricsFooter
      metrics={metrics}
      borderColor="black"
      onActionPressIn={onActionPressIn}
      onCommentPress={onCommentPress}
    />
  );
  // The bar's root owns a touch-start handler: every native touch inside the
  // bar (disabled controls and gaps included) bubbles through it.
  const barRoots = view.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && typeof node.props.onTouchStart === 'function'
  );
  expect(barRoots.length).toBeGreaterThan(0);
  act(() => {
    barRoots[0].props.onTouchStart({});
  });
  expect(onActionPressIn).toHaveBeenCalledTimes(1);

  fireEvent.press(view.getByTestId('post-comment'));
  expect(onCommentPress).toHaveBeenCalledTimes(1);
});
