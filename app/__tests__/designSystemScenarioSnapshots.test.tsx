/**
 * @jest-environment node
 */

import React from 'react';
import { cleanup, render } from '@testing-library/react-native';

import { getDesignSystemFamily } from '@/features/settings/design-system/catalog';
import { canonicalizeReactTestTree } from '@/__tests__/helpers/canonicalizeReactTestTree';

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    isLevelEnabled: jest.fn(() => false),
    warn: jest.fn(),
  };

  return {
    Log: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement(ReactActual.Fragment, null, children),
    cashuLog: logger,
    feedLog: logger,
    log: logger,
    monotonicNow: jest.fn(() => 0),
    paymentLog: logger,
    redactError: (error: unknown) => error,
    storeLog: logger,
  };
});

jest.mock('@/shared/lib/version', () => ({
  supportsBlur: jest.fn(() => false),
  supportsLiquidGlass: jest.fn(() => false),
}));

jest.mock('@/shared/lib/date', () => ({
  formatDate: jest.fn(() => '2026-05-22'),
}));

jest.mock('@/shared/lib/imageCache', () => ({
  prefetchImage: jest.fn(),
}));

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { testID: 'expo-image', ...props });
  },
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => undefined),
}));

jest.mock('liquid-glass-text', () => ({
  LiquidGlassText: (props: Record<string, unknown>) => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return ReactActual.createElement(View, { testID: 'liquid-glass-text', ...props });
  },
}));

jest.mock('@/shared/lib/popup', () => ({
  copyPopup: jest.fn(),
}));

jest.mock('@rn-primitives/checkbox', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const CheckedContext = ReactActual.createContext(false);

  return {
    Root: ({
      checked,
      children,
      onCheckedChange: _onCheckedChange,
      ...props
    }: {
      checked: boolean;
      children?: React.ReactNode;
      onCheckedChange?: unknown;
      [key: string]: unknown;
    }) => {
      const viewProps: React.ComponentProps<typeof View> & { checked: boolean } = {
        testID: 'checkbox-root',
        checked,
        ...props,
      };

      return ReactActual.createElement(
        CheckedContext.Provider,
        { value: checked },
        ReactActual.createElement(View, viewProps, children)
      );
    },
    Indicator: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      ReactActual.useContext(CheckedContext)
        ? ReactActual.createElement(View, { testID: 'checkbox-indicator', ...props }, children)
        : null,
  };
});

jest.mock('heroui-native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Scale = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
    ReactActual.createElement(View, { testID: 'pressable-feedback-scale', ...props }, children);
  const Ripple = (props: Record<string, unknown>) =>
    ReactActual.createElement(View, { testID: 'pressable-feedback-ripple', ...props });
  const PressableFeedback = Object.assign(
    ({
      animation: _animation,
      children,
      ...props
    }: {
      animation?: unknown;
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => ReactActual.createElement(View, props, children),
    { Scale, Ripple }
  );

  return { PressableFeedback };
});

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) => {
    const colors: Record<string, string> = {
      accent: 'rgb(48, 96, 192)',
      background: 'rgb(8, 8, 8)',
      'blue-300': 'rgb(48, 96, 192)',
      danger: 'rgb(192, 48, 48)',
      default: 'rgb(112, 112, 112)',
      'default-foreground': 'rgb(224, 224, 224)',
      foreground: 'rgb(16, 16, 16)',
      'green-400': 'rgb(32, 128, 72)',
      muted: 'rgb(96, 96, 96)',
      success: 'rgb(32, 128, 72)',
      surface: 'rgb(240, 240, 240)',
      'surface-secondary': 'rgb(224, 224, 224)',
      'surface-tertiary': 'rgb(208, 208, 208)',
      warning: 'rgb(192, 128, 32)',
      'yellow-300': 'rgb(192, 128, 32)',
      'red-500': 'rgb(192, 48, 48)',
    };
    const resolve = (token: string) => colors[token] ?? colors.foreground;

    return typeof tokens === 'string' ? resolve(tokens) : tokens.map(resolve);
  },
}));

jest.mock('hex-color-opacity', () => ({
  __esModule: true,
  default: jest.fn((_color: string, opacity: number) => `rgba(16, 16, 16, ${opacity})`),
}));

jest.mock('@monicon/native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');

  return {
    Monicon: ({
      name,
      pointerEvents: _pointerEvents,
      ...props
    }: {
      name: string;
      pointerEvents?: unknown;
      [key: string]: unknown;
    }) => {
      const viewProps: React.ComponentProps<typeof View> & { name: string } = {
        testID: `monicon-${name}`,
        name,
        ...props,
      };

      return ReactActual.createElement(View, viewProps);
    },
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const easing = (value: number) => value;
  const transition: Record<string, unknown> = {};
  transition.duration = () => transition;
  transition.delay = () => transition;

  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: <P extends object>(Component: React.ComponentType<P>) => Component,
    },
    Easing: {
      bezier: () => easing,
      cubic: easing,
      ease: easing,
      inOut: <T,>(fn: T) => fn,
      out: <T,>(fn: T) => fn,
      quad: easing,
    },
    cancelAnimation: jest.fn(),
    Extrapolation: { CLAMP: 'clamp' },
    FadeIn: transition,
    FadeOut: transition,
    interpolateColor: (value: number, _input: number[], colors: string[]) =>
      value >= 1 ? colors[1] : colors[0],
    interpolate: (value: number, input: number[], output: number[]) => {
      if (value <= input[0]) return output[0];
      if (value >= input[input.length - 1]) return output[output.length - 1];
      const index = input.findIndex((point) => value <= point);
      const start = index - 1;
      const ratio = (value - input[start]) / (input[index] - input[start]);
      return output[start] + ratio * (output[index] - output[start]);
    },
    ReduceMotion: { System: 'system' },
    runOnJS: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useAnimatedProps: <T extends object>(factory: () => T) => factory(),
    useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
    useFrameCallback: jest.fn(),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: <T,>(value: T) => {
      const ref = ReactActual.useRef<{
        get: () => T;
        set: (next: T | ((current: T) => T)) => void;
        value: T;
      } | null>(null);

      if (ref.current === null) {
        let current = value;
        ref.current = {
          get: () => current,
          set: (next: T | ((current: T) => T)) => {
            current = typeof next === 'function' ? (next as (current: T) => T)(current) : next;
          },
          get value() {
            return current;
          },
          set value(next: T) {
            current = next;
          },
        };
      }

      return ref.current;
    },
    withDelay: <T,>(_delayMs: number, value: T) => value,
    withRepeat: <T,>(value: T) => value,
    withSequence: <T,>(...values: T[]) => values[values.length - 1],
    withTiming: <T,>(value: T) => value,
  };
});

jest.mock('react-native-svg', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');

  const createSvgHost =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      ReactActual.createElement(name, props, children);

  return {
    __esModule: true,
    default: createSvgHost('Svg'),
    Circle: createSvgHost('Circle'),
    Defs: createSvgHost('Defs'),
    Mask: createSvgHost('Mask'),
    Ellipse: createSvgHost('Ellipse'),
    G: createSvgHost('G'),
    LinearGradient: createSvgHost('LinearGradient'),
    RadialGradient: createSvgHost('RadialGradient'),
    Path: createSvgHost('Path'),
    Rect: createSvgHost('Rect'),
    Svg: createSvgHost('Svg'),
    Stop: createSvgHost('Stop'),
  };
});

const EMPTY_STATES_FAMILY = getDesignSystemFamily('empty-states');
const FADE_REVEAL_STRESS_FAMILY = getDesignSystemFamily('fade-reveal-stress');
const FOUNDATIONS_FAMILY = getDesignSystemFamily('foundations');
const LOADING_INDICATOR_FAMILY = getDesignSystemFamily('loading-indicator');
const SEGMENTED_PROGRESS_FAMILY = getDesignSystemFamily('segmented-progress');
const SKELETON_CROSSFADE_FAMILY = getDesignSystemFamily('skeleton-crossfade');
const TIMELINE_FAMILY = getDesignSystemFamily('timeline');
const WALLET_CONTROLS_FAMILY = getDesignSystemFamily('wallet-controls');

describe('Design System exact structural snapshots', () => {
  afterEach(cleanup);

  it('removes unstable renderer fields without dropping visual or accessibility output', () => {
    const callback = jest.fn();

    expect(
      canonicalizeReactTestTree({
        type: 'View',
        props: {
          ref: callback,
          onPress: callback,
          __source: { fileName: 'fixture.tsx' },
          accessibilityLabel: 'Fixture',
          className: 'fixture',
          style: { minHeight: 44 },
          testID: 'fixture',
        },
        children: ['Visible text'],
      })
    ).toEqual({
      children: ['Visible text'],
      props: {
        accessibilityLabel: 'Fixture',
        className: 'fixture',
        style: { minHeight: 44 },
        testID: 'fixture',
      },
      type: 'View',
    });
  });

  it('keeps the existing empty-state surface catalog complete', () => {
    expect(EMPTY_STATES_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'feed',
      'notifications',
      'mentions',
      'search-results',
      'contacts',
      'transactions',
      'nearby-bitchat',
    ]);
  });

  for (const scenario of EMPTY_STATES_FAMILY.scenarios) {
    it(`renders ${scenario.id}`, () => {
      const view = render(scenario.render());

      expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
    });
  }

  it('keeps the foundations catalog complete', () => {
    expect(FOUNDATIONS_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'type-ramp',
      'text-loading-fallback',
      'stack-layout',
      'button-variants',
      'button-states',
      'badge-statuses',
      'skeleton-shapes',
      'spinner-sizes',
      'notice-cards',
      'detail-rows',
      'row-stats-loading',
      'row-stats',
      'selection-circles',
      'pill-tabs',
      'sheet-grabber',
    ]);
  });

  for (const scenario of FOUNDATIONS_FAMILY.scenarios) {
    it(`renders foundations/${scenario.id}`, () => {
      const usesVirtualizedList = scenario.id === 'pill-tabs';
      if (usesVirtualizedList) jest.useFakeTimers();

      const view = render(scenario.render());

      try {
        view.rerender(scenario.render());
        expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
      } finally {
        view.unmount();
        if (usesVirtualizedList) {
          jest.runOnlyPendingTimers();
          jest.useRealTimers();
        }
      }
    });
  }

  it('keeps the wallet-facing control catalog complete', () => {
    expect(WALLET_CONTROLS_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'amount-sat-modes',
      'amount-direction-and-fiat',
      'keypad-sats',
      'keypad-fiat-loading',
      'action-segments',
      'circle-actions',
      'mint-icon-states',
      'copyable-value',
      'selection-squares',
      'details-collapsed',
      'details-expanded',
      'transfer-feedback',
    ]);
  });

  for (const scenario of WALLET_CONTROLS_FAMILY.scenarios) {
    it(`renders wallet-controls/${scenario.id}`, () => {
      const view = render(scenario.render());

      view.rerender(scenario.render());
      expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
    });
  }

  it('keeps the loading-indicator state and size catalog complete', () => {
    expect(LOADING_INDICATOR_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'state-idle',
      'state-loading',
      'state-success',
      'state-error',
      'state-reverted',
      'size-16',
      'size-20',
      'size-32',
      'size-48',
      'size-72',
    ]);
  });

  for (const scenario of LOADING_INDICATOR_FAMILY.scenarios) {
    it(`renders loading-indicator/${scenario.id}`, () => {
      const view = render(scenario.render());

      view.rerender(scenario.render());
      expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
    });
  }

  it('keeps the segmented-progress and transfer-state catalog complete', () => {
    expect(SEGMENTED_PROGRESS_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'segments-empty',
      'segments-progress',
      'segments-dense',
      'segments-complete',
      'checkpoint-status-matrix',
      'transfer-pending',
      'transfer-invoice',
      'transfer-routing',
      'transfer-success',
      'transfer-failure',
      'transfer-skipped',
    ]);
  });

  for (const scenario of SEGMENTED_PROGRESS_FAMILY.scenarios) {
    it(`renders segmented-progress/${scenario.id}`, () => {
      const view = render(scenario.render());

      view.rerender(scenario.render());
      expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
    });
  }

  it('keeps the timeline status catalog complete', () => {
    expect(TIMELINE_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'cashu-send-pending',
      'cashu-send-success',
      'cashu-send-rolled-back',
      'cashu-receive-already-spent',
      'lightning-receive-waiting',
      'lightning-mint-failed',
      'onchain-send-mempool',
      'onchain-send-confirmed',
      'payment-request-delivered',
    ]);
  });

  for (const scenario of TIMELINE_FAMILY.scenarios) {
    it(`renders timeline/${scenario.id}`, () => {
      jest.useFakeTimers();
      jest.setSystemTime(Date.UTC(2026, 4, 22, 12, 0, 0));
      const view = render(scenario.render());

      try {
        view.rerender(scenario.render());
        expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
      } finally {
        view.unmount();
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
      }
    });
  }

  it('keeps the skeleton/content parity catalog complete', () => {
    expect(SKELETON_CROSSFADE_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'profile-skeleton-region',
      'profile-content-parity',
      'inline-skeleton',
      'inline-content',
      'avatar-image-pending',
      'avatar-fallback',
    ]);
  });

  for (const scenario of SKELETON_CROSSFADE_FAMILY.scenarios) {
    it(`renders skeleton-crossfade/${scenario.id}`, () => {
      const view = render(scenario.render());

      view.rerender(scenario.render());
      expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
    });
  }

  it('keeps the fade-reveal diagnostic catalog complete', () => {
    expect(FADE_REVEAL_STRESS_FAMILY.scenarios.map((scenario) => scenario.id)).toEqual([
      'tiles-visible',
      'tiles-hidden',
      'tiles-stuck',
    ]);
  });

  for (const scenario of FADE_REVEAL_STRESS_FAMILY.scenarios) {
    it(`renders fade-reveal-stress/${scenario.id}`, () => {
      const view = render(scenario.render());

      view.rerender(scenario.render());
      expect(canonicalizeReactTestTree(view.toJSON())).toMatchSnapshot(scenario.id);
    });
  }
});
