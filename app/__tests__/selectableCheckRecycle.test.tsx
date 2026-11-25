/**
 * @jest-environment node
 *
 * A FlashList cell rebinding to another mint must show that mint's mark at
 * once, not replay the 150 ms fill from the previous mint's state. A tap on
 * the same row still animates.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SelectableCheckCircle } from '@/shared/ui/primitives/SelectableCheck/SelectableCheck.circle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockWrites: unknown[] = [];

jest.mock('react-native-reanimated', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    __esModule: true,
    default: { View: (props: Record<string, unknown>) => R.createElement('AnimatedView', props) },
    useReducedMotion: () => false,
    useSharedValue: (initial: number) =>
      R.useState(() => ({
        value: initial,
        get() {
          return this.value;
        },
        set(next: unknown) {
          mockWrites.push(next);
        },
      }))[0],
    useAnimatedStyle: (factory: () => object) => factory(),
    withTiming: (to: number) => ({ timing: to }),
  };
});
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'accent-fg' }));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/ui/primitives/Pressable', () => ({ Pressable: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: (props: Record<string, unknown>) =>
    jest
      .requireActual<typeof import('react')>('react')
      .createElement('RNView', props, props.children as React.ReactNode),
}));

it('snaps when the row is recycled to another item, and animates a tap on the same one', () => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<SelectableCheckCircle selected recycleKey="mint-a" />);
  });
  mockWrites.length = 0;

  act(() => r.update(<SelectableCheckCircle selected={false} recycleKey="mint-b" />));
  expect(mockWrites).toEqual([0]);

  mockWrites.length = 0;
  act(() => r.update(<SelectableCheckCircle selected recycleKey="mint-b" />));
  expect(mockWrites).toEqual([{ timing: 1 }]);
  act(() => r.unmount());
});
