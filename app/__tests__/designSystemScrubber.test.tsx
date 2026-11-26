/**
 * @jest-environment node
 */

/**
 * The two inspection screens of the Design System: the state-locked UI kit
 * (one filter per state) and the animation frame scrubber (stops, slider and
 * "Scrub all"). The components inside are the real ones, so a stop pressed
 * here is the frame the component draws; the per-scenario output is pinned
 * by designSystemScenarioSnapshots.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { SCRUB_STOPS, SCRUB_TRANSITIONS } from '@/features/settings/design-system/scrubber';
import {
  UI_KIT_FILTERS,
  UI_KIT_SCENARIOS,
  type UiKitFilter,
} from '@/features/settings/design-system/uiKit';
import { SettingsDesignSystemScrubberScreen } from '@/features/settings/screens/SettingsDesignSystemScrubberScreen';
import { SettingsDesignSystemTimelineScreen } from '@/features/settings/screens/SettingsDesignSystemTimelineScreen';
import { SettingsDesignSystemUiKitScreen } from '@/features/settings/screens/SettingsDesignSystemUiKitScreen';
import { CapabilityProvider, type Capabilities } from '@/shared/ui/capability';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { UnderlineTabs } from '@/shared/ui/composed/UnderlineTabs';

const CAPABILITIES: Capabilities = {
  liquidGlass: false,
  blur: false,
  frostedSurface: false,
  linearGradient: true,
  meshGradient: true,
  icon: 'monicon',
};
function Wrapper({ children }: { children: React.ReactNode }) {
  return <CapabilityProvider value={CAPABILITIES}>{children}</CapabilityProvider>;
}

jest.mock('@/shared/lib/logger', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const logger: Record<string, unknown> = {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    isLevelEnabled: jest.fn(() => false),
    warn: jest.fn(),
  };
  logger.child = () => logger;

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
jest.mock('@/shared/lib/imageCache', () => ({ prefetchImage: jest.fn() }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('liquid-glass-text', () => ({ LiquidGlassText: 'LiquidGlassText' }));
jest.mock('@/shared/lib/popup', () => ({ copyPopup: jest.fn() }));

// The page frame owns navigation, headers and safe areas; none of it is under test.
// Pinned chrome (`stickyContent`) is drawn before the page, as the frame does.
jest.mock('@/shared/ui/composed/Screen', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Screen: ({
      children,
      stickyContent,
    }: {
      children?: React.ReactNode;
      stickyContent?: React.ReactNode;
    }) =>
      ReactActual.createElement(
        ReactActual.Fragment,
        null,
        stickyContent
          ? ReactActual.createElement('sticky-content', { testID: 'screen-sticky' }, stickyContent)
          : null,
        children
      ),
  };
});
jest.mock('@/shared/ui/composed/ScreenScrollView', () => ({ ScreenScrollView: 'ScrollView' }));

// Both resolve per platform in the app; the test draws the non-glass tier.
jest.mock(
  '@/shared/ui/composed/BalancePill',
  () => jest.requireActual('@/shared/ui/composed/BalancePill/BalancePill.flat'),
  { virtual: true }
);
jest.mock(
  '@/shared/ui/composed/GlassSearchBar',
  () => jest.requireActual('@/shared/ui/composed/GlassSearchBar/GlassSearchBar.ios'),
  { virtual: true }
);
jest.mock('@/shared/ui/composed/GlassSearchBar/searchTextInput', () => ({
  SearchTextInput: 'SearchTextInput',
}));

// The house press feedback, list group and slider stand in as host elements,
// as heroui's did: the scrubber drives the frames, not these wrappers. The
// slider is one element now (no track/fill/thumb children).
jest.mock('@/shared/ui/primitives/PressableFeedback', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      ReactActual.createElement(name, props, children);
  return {
    PressableFeedback: Object.assign(
      ({ animation: _animation, ...props }: { animation?: unknown; [key: string]: unknown }) =>
        host('PressableFeedback')(props),
      {
        Scale: host('PressableFeedbackScale'),
        Ripple: host('PressableFeedbackRipple'),
        Highlight: host('PressableFeedbackHighlight'),
      }
    ),
  };
});
jest.mock('@/shared/ui/composed/ListGroup', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      ReactActual.createElement(name, props, children);
  return {
    ListGroup: Object.assign(host('ListGroup'), {
      Item: host('ListGroupItem'),
      ItemContent: host('ListGroupItemContent'),
      ItemDescription: host('ListGroupItemDescription'),
      ItemPrefix: host('ListGroupItemPrefix'),
      ItemSuffix: host('ListGroupItemSuffix'),
      ItemTitle: host('ListGroupItemTitle'),
    }),
    Separator: host('Separator'),
    Card: Object.assign(host('Card'), {
      Body: host('CardBody'),
      Description: host('CardDescription'),
    }),
  };
});
jest.mock('@/shared/ui/primitives/Slider', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    Slider: (props: Record<string, unknown>) => ReactActual.createElement('Slider', props),
  };
});

jest.mock('@/shared/hooks/useVisualActivityEffect', () => ({
  useVisualActivityEffect: (effect: () => void | (() => void), enabled = true) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      if (enabled) return effect();
    }, [effect, enabled]);
  },
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | readonly string[]) =>
    typeof tokens === 'string' ? 'rgb(16, 16, 16)' : tokens.map(() => 'rgb(16, 16, 16)'),
}));
jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: jest.fn((_color: string, opacity: number) => `rgba(16, 16, 16, ${opacity})`),
}));

// Shared values hold plain numbers. Like the real library, writing one redraws
// the animated styles that read it (here: every mounted animated style), so a
// frame set from outside is the style the view receives.
jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const redraws = new Set<() => void>();
  const useRedrawOnWrite = () => {
    const [, redraw] = ReactActual.useReducer((count: number) => count + 1, 0);
    ReactActual.useEffect(() => {
      const listener = () => redraw();
      redraws.add(listener);
      return () => void redraws.delete(listener);
    }, []);
  };
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const easing = (value: number) => value;
  const transition: Record<string, unknown> = {};
  transition.duration = () => transition;
  transition.delay = () => transition;

  return {
    __esModule: true,
    default: {
      View,
      // A host, so the rolling balance's digits render as plain glyphs.
      Text: (props: Record<string, unknown>) => ReactActual.createElement('AnimatedText', props),
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
    makeMutable: (value: number) => ({ get: () => value, set: () => undefined }),
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
    useAnimatedStyle: <T extends object>(factory: () => T) => {
      useRedrawOnWrite();
      return factory();
    },
    useFrameCallback: () =>
      ReactActual.useMemo(() => ({ setActive: jest.fn(), isActive: false, callbackId: 1 }), []),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: <T,>(value: T) => {
      const ref = ReactActual.useRef<{ get: () => T; set: (next: T) => void } | null>(null);
      if (ref.current === null) {
        let current = value;
        ref.current = {
          get: () => current,
          set: (next: T) => {
            if (Object.is(current, next)) return;
            current = next;
            redraws.forEach((listener) => listener());
          },
        };
      }
      return ref.current;
    },
    withDelay: <T,>(_delayMs: number, value: T) => value,
    withRepeat: <T,>(value: T) => value,
    withSpring: <T,>(value: T) => value,
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
    SvgXml: createSvgHost('SvgXml'),
    Stop: createSvgHost('Stop'),
  };
});

/**
 * The outermost element carrying `testID`. Under react-native-web the host
 * nodes are DOM elements without it, so this reads the components' own props.
 */
function byTestId(testID: string) {
  const [node] = screen.UNSAFE_root.findAll((candidate) => candidate.props.testID === testID);
  if (!node) throw new Error(`No element with testID ${testID}`);
  return node;
}

function queryByTestId(testID: string) {
  return screen.UNSAFE_root.findAll((candidate) => candidate.props.testID === testID)[0] ?? null;
}

function allByTestId(testID: string) {
  // Each testID passes down a wrapper chain; count the outermost of each chain.
  return screen.UNSAFE_root.findAll(
    (candidate) => candidate.props.testID === testID && candidate.parent?.props.testID !== testID
  );
}

/** Every style a node and its descendants receive, flattened. */
function stylesUnder(testID: string): Record<string, unknown>[] {
  const node = byTestId(testID);
  const collect = (style: unknown): Record<string, unknown>[] =>
    Array.isArray(style)
      ? style.flatMap(collect)
      : style && typeof style === 'object'
        ? [style as Record<string, unknown>]
        : [];
  return [node, ...node.findAll(() => true)].flatMap((child) => collect(child.props.style));
}

/** The scale transforms drawn inside one transition's card. */
function scalesUnder(testID: string): number[] {
  return stylesUnder(testID)
    .flatMap((style) => (Array.isArray(style.transform) ? style.transform : []))
    .flatMap((step: Record<string, unknown>) =>
      typeof step.scale === 'number' ? [step.scale] : []
    );
}

function isSelected(testID: string): boolean {
  // The element that announces the state, not a component above it that only forwards the id.
  const [node] = screen.UNSAFE_root.findAll(
    (candidate) => candidate.props.testID === testID && candidate.props.accessibilityState
  );
  if (!node) throw new Error(`No element with testID ${testID} announces a state`);
  return node.props.accessibilityState.selected === true;
}

function pressAndFlush(testID: string) {
  // The pressable itself, not a component above it that only forwards the id.
  const [node] = screen.UNSAFE_root.findAll(
    (candidate) =>
      candidate.props.testID === testID && typeof candidate.props.onPress === 'function'
  );
  if (!node) throw new Error(`No pressable with testID ${testID}`);
  act(() => {
    fireEvent.press(node);
  });
  act(() => {
    jest.runOnlyPendingTimers();
  });
}

/**
 * Chooses a filter the way its pill does. The bar is a horizontal list that
 * mounts only the pills near the start, so the far ones are reached through
 * the bar's own handler, as a scroll-then-tap would.
 */
function chooseFilter(filter: UiKitFilter) {
  act(() => {
    screen.UNSAFE_root.findByType(PillTabs).props.onTabChange(filter);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('State-locked UI kit screen', () => {
  it('locks each scenario to one state the filter bar offers', () => {
    const offered = new Set<string>(UI_KIT_FILTERS);
    expect(UI_KIT_SCENARIOS.filter((scenario) => !offered.has(scenario.state))).toEqual([]);
    // Every filter but "All" finds something.
    for (const filter of UI_KIT_FILTERS.filter((entry) => entry !== 'all')) {
      expect(UI_KIT_SCENARIOS.some((scenario) => scenario.state === filter)).toBe(true);
    }
  });

  it('shows every scenario under All, then only the chosen state', () => {
    const view = render(<SettingsDesignSystemUiKitScreen />, { wrapper: Wrapper });
    try {
      expect(byTestId('design-system-ui-kit-count').props.children).toBe(
        `${UI_KIT_SCENARIOS.length} states`
      );
      for (const scenario of UI_KIT_SCENARIOS) {
        expect(byTestId(`design-system-scenario-ui-kit-${scenario.id}`)).toBeTruthy();
      }

      for (const filter of UI_KIT_FILTERS) {
        chooseFilter(filter);
        const expected = UI_KIT_SCENARIOS.filter(
          (scenario) => filter === 'all' || scenario.state === filter
        );
        const shown = UI_KIT_SCENARIOS.filter(
          (scenario) => queryByTestId(`design-system-scenario-ui-kit-${scenario.id}`) !== null
        );
        expect({ filter, shown: shown.map((scenario) => scenario.id) }).toEqual({
          filter,
          shown: expected.map((scenario) => scenario.id),
        });
      }
    } finally {
      view.unmount();
    }
  });

  it('pins the filter bar above the scrolling states', () => {
    const view = render(<SettingsDesignSystemUiKitScreen />, { wrapper: Wrapper });
    try {
      const pinned = screen.getByTestId('screen-sticky');
      expect(pinned.findByType(PillTabs).props.tabs).toEqual(UI_KIT_FILTERS);
      expect(pinned.findAllByProps({ testID: 'design-system-ui-kit-count' })).toHaveLength(0);
    } finally {
      view.unmount();
    }
  });

  it('marks the chosen pill selected and counts its states', () => {
    const view = render(<SettingsDesignSystemUiKitScreen />, { wrapper: Wrapper });
    try {
      expect(isSelected('design-system-ui-kit-filter-all')).toBe(true);
      chooseFilter('error');
      expect(isSelected('design-system-ui-kit-filter-error')).toBe(true);
      expect(isSelected('design-system-ui-kit-filter-all')).toBe(false);
      const errors = UI_KIT_SCENARIOS.filter((scenario) => scenario.state === 'error');
      expect(byTestId('design-system-ui-kit-count').props.children).toBe(`${errors.length} states`);
      expect(queryByTestId('design-system-scenario-ui-kit-mint-header-error')).not.toBeNull();
      expect(queryByTestId('design-system-scenario-ui-kit-button-default')).toBeNull();
    } finally {
      view.unmount();
    }
  });

  it('frames every large-text scenario so the stand-in is visible', () => {
    const view = render(<SettingsDesignSystemUiKitScreen />, { wrapper: Wrapper });
    try {
      chooseFilter('large-text');
      const largeText = UI_KIT_SCENARIOS.filter((scenario) => scenario.state === 'large-text');
      expect(allByTestId('design-system-ui-kit-large-text-frame')).toHaveLength(largeText.length);
    } finally {
      view.unmount();
    }
  });
});

describe('Animation frame scrubber screen', () => {
  it('starts every transition at 0%', () => {
    const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
    try {
      expect(byTestId('design-system-scrub-all-value').props.children).toBe('0.0%');
      for (const transition of SCRUB_TRANSITIONS) {
        expect(isSelected(`design-system-scrub-${transition.id}-0`)).toBe(true);
      }
    } finally {
      view.unmount();
    }
  });

  it.each(SCRUB_TRANSITIONS.map((transition) => transition.id))(
    'snaps %s to each stop and marks only that stop',
    (id) => {
      const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
      try {
        for (const stop of SCRUB_STOPS) {
          pressAndFlush(`design-system-scrub-${id}-${stop}`);
          expect(byTestId(`design-system-scrub-${id}-value`).props.children).toBe(
            `${stop.toFixed(1)}%`
          );
          expect(
            SCRUB_STOPS.filter((other) => isSelected(`design-system-scrub-${id}-${other}`))
          ).toEqual([stop]);
        }
        // One transition moved, so "Scrub all" has no single frame to mark.
        expect(byTestId('design-system-scrub-all-value').props.children).toBe('Mixed');
      } finally {
        view.unmount();
      }
    }
  );

  it('draws the held frame: the button squeezes in proportion to the stop', () => {
    const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
    try {
      const scales = SCRUB_STOPS.map((stop) => {
        pressAndFlush(`design-system-scrub-button-press-${stop}`);
        return Math.min(...scalesUnder('design-system-scrub-button-press'));
      });
      // Button presses to 0.97: 0% is at rest, 100% fully pressed, evenly between.
      expect(scales.map((scale) => Number(scale.toFixed(4)))).toEqual([
        1, 0.9925, 0.985, 0.9775, 0.97,
      ]);
    } finally {
      view.unmount();
    }
  });

  it('draws the held frame dimmed as a real press dims it', () => {
    const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
    try {
      // A real press dims the button to 0.88 as it squeezes; the held frame too.
      const opacities = SCRUB_STOPS.map((stop) => {
        pressAndFlush(`design-system-scrub-button-press-${stop}`);
        const values = stylesUnder('design-system-scrub-button-press')
          .map((style) => style.opacity)
          .filter((value): value is number => typeof value === 'number');
        return Number(Math.min(1, ...values).toFixed(4));
      });
      expect(opacities).toEqual([1, 0.97, 0.94, 0.91, 0.88]);
    } finally {
      view.unmount();
    }
  });

  it('moves every transition together from Scrub all', () => {
    const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
    try {
      pressAndFlush('design-system-scrub-button-press-75');
      for (const stop of SCRUB_STOPS) {
        pressAndFlush(`design-system-scrub-all-${stop}`);
        expect(byTestId('design-system-scrub-all-value').props.children).toBe(
          `${stop.toFixed(1)}%`
        );
        expect(isSelected(`design-system-scrub-all-${stop}`)).toBe(true);
        for (const transition of SCRUB_TRANSITIONS) {
          expect(isSelected(`design-system-scrub-${transition.id}-${stop}`)).toBe(true);
        }
      }
    } finally {
      view.unmount();
    }
  });

  it('moves the Scrub all slider to the frame every transition agrees on and keeps it there when one diverges', () => {
    const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
    try {
      const master = () =>
        byTestId('design-system-scrub-all-slider').findByType('Slider' as never).props.value;
      pressAndFlush('design-system-scrub-all-25');
      expect(master()).toBe(25);
      for (const transition of SCRUB_TRANSITIONS) {
        pressAndFlush(`design-system-scrub-${transition.id}-75`);
      }
      expect(byTestId('design-system-scrub-all-value').props.children).toBe('75.0%');
      expect(master()).toBe(75);
      pressAndFlush(`design-system-scrub-${SCRUB_TRANSITIONS[0].id}-50`);
      expect(byTestId('design-system-scrub-all-value').props.children).toBe('Mixed');
      expect(master()).toBe(75);
    } finally {
      view.unmount();
    }
  });

  it('holds an arbitrary slider frame exactly, between stops', () => {
    const view = render(<SettingsDesignSystemScrubberScreen />, { wrapper: Wrapper });
    try {
      const slider = byTestId('design-system-scrub-selectable-check-slider').findByType(
        'Slider' as never
      );
      act(() => {
        slider.props.onChange(37.5);
      });
      expect(byTestId('design-system-scrub-selectable-check-value').props.children).toBe('37.5%');
      expect(
        SCRUB_STOPS.filter((stop) => isSelected(`design-system-scrub-selectable-check-${stop}`))
      ).toEqual([]);
      // The mark's fill sits at exactly that frame: no timing runs on top of it.
      expect(stylesUnder('design-system-scrub-selectable-check').map((s) => s.opacity)).toContain(
        0.375
      );
    } finally {
      view.unmount();
    }
  });
});

describe('Timeline screen', () => {
  it('pins the payment-type tabs and path pills under the header, outside the scroll', () => {
    const view = render(<SettingsDesignSystemTimelineScreen />, { wrapper: Wrapper });
    try {
      const pinned = screen.getByTestId('screen-sticky');
      expect(pinned.findByType(UnderlineTabs).props.tabs).toEqual([
        'Cashu',
        'Locked',
        'Lightning',
        'Onchain',
        'Request',
      ]);
      expect(pinned.findAllByType(PillTabs)).toHaveLength(1);
      // The transport controls scroll with the page.
      expect(pinned.findAllByProps({ testID: 'design-system-timeline-step' })).toHaveLength(0);
      expect(
        screen.UNSAFE_root.findAllByProps({ testID: 'design-system-timeline-step' }).length
      ).toBeGreaterThan(0);
    } finally {
      view.unmount();
    }
  });
});
