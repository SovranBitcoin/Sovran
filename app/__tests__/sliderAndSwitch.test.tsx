/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Slider } from '@/shared/ui/primitives/Slider';
import { Switch } from '@/shared/ui/primitives/Switch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => require('./helpers/sheetRuntimeMocks').reanimated);
jest.mock(
  'react-native-gesture-handler',
  () => require('./helpers/sheetRuntimeMocks').gestureHandler
);
jest.mock('react-native-worklets', () => require('./helpers/sheetRuntimeMocks').worklets);
jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => ['green'] }));
jest.mock('@/shared/styles/appStyle', () => ({
  useStylePaint: () => ({ track: 'gray' }),
}));
jest.mock('@/shared/lib/logger', () => ({ log: { error: jest.fn(), warn: jest.fn() } }));

type MockGesture = {
  kind: string;
  handlers: Record<string, (...args: unknown[]) => void>;
};

let renderer: TestRenderer.ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('Slider gesture safety', () => {
  function mountSlider(props: Partial<React.ComponentProps<typeof Slider>> = {}) {
    const onChange = jest.fn();
    const onChangeEnd = jest.fn();
    act(() => {
      renderer = TestRenderer.create(
        <Slider
          value={20}
          minValue={0}
          maxValue={100}
          step={5}
          testID="fee-slider"
          accessibilityLabel="Max fee"
          onChange={onChange}
          onChangeEnd={onChangeEnd}
          {...props}
        />
      );
    });
    const host = renderer!.root.findAll(
      (node) => node.props.testID === 'fee-slider' && typeof node.props.onLayout === 'function'
    )[0]!;
    act(() => {
      host.props.onLayout({ nativeEvent: { layout: { width: 228, height: 20 } } });
    });
    // Read gestures AFTER onLayout updates width/track.
    const getGestures = () => {
      const detector = renderer!.root.findByType('GestureDetector' as never);
      const exclusive = detector.props.gesture as { kind: string; gestures: MockGesture[] };
      return {
        pan: exclusive.gestures.find((g) => g.kind === 'pan')!,
        tap: exclusive.gestures.find((g) => g.kind === 'tap')!,
      };
    };
    const { pan, tap } = getGestures();
    return { onChange, onChangeEnd, pan, tap };
  }

  it('requires horizontal movement and fails on vertical scroll', () => {
    const { onChange, onChangeEnd, pan } = mountSlider();
    expect(pan.handlers.activeOffsetX).toEqual([-6, 6]);
    expect(pan.handlers.failOffsetY).toEqual([-10, 10]);
    expect(pan.handlers.onBegin).toBeUndefined();

    // Vertical scroll fails the pan without ever calling onStart.
    act(() => {
      pan.handlers.onFinalize({ x: 180 }, false);
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(onChangeEnd).not.toHaveBeenCalled();
  });

  it('reverts and does not commit onChangeEnd when a drag is cancelled', () => {
    const { onChange, onChangeEnd, pan } = mountSlider();
    act(() => {
      pan.handlers.onStart({ x: 114 }); // mid-track => 50
      pan.handlers.onUpdate({ x: 154 }); // => 70
      pan.handlers.onEnd({ x: 154 }, false);
      pan.handlers.onFinalize({ x: 154 }, false);
    });
    expect(onChange).toHaveBeenLastCalledWith(20);
    expect(onChangeEnd).not.toHaveBeenCalled();
  });

  it('commits onChangeEnd on successful pan and on tap', () => {
    const { onChange, onChangeEnd, pan, tap } = mountSlider();
    act(() => {
      pan.handlers.onStart({ x: 114 }); // 50
      pan.handlers.onEnd({ x: 154 }, true); // 70
      pan.handlers.onFinalize({ x: 154 }, true);
    });
    expect(onChangeEnd).toHaveBeenLastCalledWith(70);

    act(() => {
      tap.handlers.onEnd({ x: 114 }, true); // 50
    });
    expect(onChange).toHaveBeenLastCalledWith(50);
    expect(onChangeEnd).toHaveBeenLastCalledWith(50);
  });
});

describe('Switch accessibility label', () => {
  const switchHost = () =>
    renderer!.root.findAll(
      (node) => node.props.testID === 'sw-1' && node.props.accessibilityRole === 'switch'
    )[0]!;

  it('forwards accessibilityLabel and falls back to aria-label', () => {
    act(() => {
      renderer = TestRenderer.create(
        <Switch testID="sw-1" isSelected accessibilityLabel="Mint A enabled" />
      );
    });
    expect(switchHost().props.accessibilityLabel).toBe('Mint A enabled');

    act(() => {
      renderer!.update(<Switch testID="sw-1" isSelected aria-label="Mint B enabled" />);
    });
    expect(switchHost().props.accessibilityLabel).toBe('Mint B enabled');
  });
});
