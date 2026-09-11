/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  LoadingIndicator,
  normalizeConfirmationProgress,
  normalizeSegmentedProgress,
} from '@/shared/blocks/status/LoadingIndicator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useVisualActivityEffect', () => ({
  useVisualActivityEffect: (effect: () => void | (() => void), enabled = true) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      if (enabled) return effect();
    }, [effect, enabled]);
  },
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => token) : tokens,
}));

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const easingFn = (value: number) => value;

  return {
    __esModule: true,
    default: {
      View,
      createAnimatedComponent: <P extends object>(Component: React.ComponentType<P>) => Component,
    },
    Easing: {
      cubic: easingFn,
      ease: easingFn,
      inOut: <T,>(fn: T) => fn,
      out: <T,>(fn: T) => fn,
      bezier: () => easingFn,
    },
    interpolateColor: (value: number, _input: number[], colors: string[]) =>
      value >= 1 ? colors[1] : colors[0],
    useAnimatedProps: <T extends object>(factory: () => T) => factory(),
    useAnimatedStyle: <T extends object>(factory: () => T) => factory(),
    cancelAnimation: jest.fn(),
    useFrameCallback: jest.fn(() =>
      jest
        .requireActual<typeof import('react')>('react')
        .useMemo(() => ({ setActive: jest.fn(), isActive: false, callbackId: 1 }), [])
    ),
    useSharedValue: <T,>(value: T) => {
      let current = value;

      return {
        get: () => current,
        set: (next: T | ((value: T) => T)) => {
          current = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
        },
        get value() {
          return current;
        },
        set value(next: T) {
          current = next;
        },
      };
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
    Path: createSvgHost('Path'),
    Rect: createSvgHost('Rect'),
    Svg: createSvgHost('Svg'),
  };
});

type JsonNode = ReturnType<TestRenderer.ReactTestRenderer['toJSON']>;
let consoleErrorSpy: jest.SpyInstance;

function collectNodesByTestIDPrefix(
  node: JsonNode,
  prefix: string,
  matches: JsonNode[] = []
): JsonNode[] {
  if (!node || typeof node === 'string') return matches;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNodesByTestIDPrefix(child, prefix, matches));
    return matches;
  }
  const testID = node.props?.testID ?? node.props?.['data-testid'];
  if (typeof testID === 'string' && testID.startsWith(prefix)) {
    matches.push(node);
  }
  node.children?.forEach((child) => collectNodesByTestIDPrefix(child as JsonNode, prefix, matches));
  return matches;
}

function collectNodesByType(node: JsonNode, type: string, matches: JsonNode[] = []): JsonNode[] {
  if (!node || typeof node === 'string') return matches;
  if (Array.isArray(node)) {
    node.forEach((child) => collectNodesByType(child, type, matches));
    return matches;
  }
  if (node.type === type) {
    matches.push(node);
  }
  node.children?.forEach((child) => collectNodesByType(child as JsonNode, type, matches));
  return matches;
}

describe('LoadingIndicator confirmation progress', () => {
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('react-test-renderer is deprecated')) return;
      throw new Error(`Unexpected console.error: ${args.map(String).join(' ')}`);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('normalizes null, partial, complete, and invalid confirmation counts', () => {
    expect(
      normalizeConfirmationProgress({ currentConfirmations: null, requiredConfirmations: 3 })
    ).toMatchObject({
      currentConfirmations: 0,
      requiredConfirmations: 3,
      segmentCount: 3,
      completedSegments: 0,
    });
    expect(
      normalizeConfirmationProgress({ currentConfirmations: 2, requiredConfirmations: 3 })
    ).toMatchObject({
      currentConfirmations: 2,
      requiredConfirmations: 3,
      segmentCount: 3,
      completedSegments: 2,
    });
    expect(
      normalizeConfirmationProgress({ currentConfirmations: 7, requiredConfirmations: 3 })
    ).toMatchObject({
      currentConfirmations: 3,
      requiredConfirmations: 3,
      segmentCount: 3,
      completedSegments: 3,
    });
    expect(
      normalizeConfirmationProgress({ currentConfirmations: 1, requiredConfirmations: 0 })
    ).toMatchObject({
      currentConfirmations: 1,
      requiredConfirmations: 6,
      segmentCount: 6,
      completedSegments: 1,
    });
  });

  it('normalizes generic segmented progress with custom segment counts', () => {
    expect(normalizeSegmentedProgress({ completedSegments: null, segmentCount: 2 })).toMatchObject({
      segmentCount: 2,
      completedSegments: 0,
    });
    expect(normalizeSegmentedProgress({ completedSegments: 7, segmentCount: 5 })).toMatchObject({
      segmentCount: 5,
      completedSegments: 5,
    });
    expect(normalizeSegmentedProgress({ completedSegments: 25, segmentCount: 30 })).toMatchObject({
      segmentCount: 24,
      completedSegments: 20,
    });
  });

  it('renders one visible segment per required confirmation', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator
          confirmationProgress={{ currentConfirmations: 2, requiredConfirmations: 4 }}
          phase="idle"
        />
      );
    });

    const segments = collectNodesByTestIDPrefix(
      renderer!.toJSON(),
      'loading-indicator-confirmation-segment-'
    );
    expect(segments).toHaveLength(4);

    act(() => {
      renderer.unmount();
    });
  });

  it('renders ring and segment strokes at strokeWidthPx for the indicator size', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    // Segmented ring: 3px at size 20 → 15 viewBox units. The completed
    // segment renders at full thickness.
    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator
          size={20}
          strokeWidthPx={3}
          pendingColor="rail-track"
          confirmationProgress={{ currentConfirmations: 1, requiredConfirmations: 3 }}
          phase="idle"
        />
      );
    });
    const segments = collectNodesByTestIDPrefix(
      renderer!.toJSON(),
      'loading-indicator-confirmation-segment-'
    );
    expect(segments).toHaveLength(3);
    const segmentStrokeWidth = (segment: JsonNode) =>
      segment && typeof segment !== 'string' && !Array.isArray(segment)
        ? segment.props.animatedProps.strokeWidth
        : null;
    // Completed AND pending segments render at the target weight: a px-matched
    // ring must not sit thinner than the neighbouring idle dashes/rail.
    expect(segmentStrokeWidth(segments[0])).toBeCloseTo(15);
    expect(segmentStrokeWidth(segments[1])).toBeCloseTo(15);
    // Seams scale with the stroke: gap = stroke + 0.75·stroke = 26.25 units,
    // so the dash is the per-segment step minus that gap.
    const CIRC = 2 * Math.PI * 38;
    const expectedGap = 15 * 1.75;
    const segmentDash =
      segments[0] && typeof segments[0] !== 'string' && !Array.isArray(segments[0])
        ? (segments[0].props.strokeDasharray as number[])[0]
        : null;
    expect(segmentDash).toBeCloseTo(CIRC / 3 - expectedGap);
    // Dashes center within their step (offset by half a gap) so the seams
    // straddle 12 o'clock and the step boundaries — no half-gap slant.
    const segmentOffset = (segment: JsonNode, index: number) =>
      segment && typeof segment !== 'string' && !Array.isArray(segment)
        ? segment.props.strokeDashoffset + (index * CIRC) / 3
        : null;
    expect(segmentOffset(segments[0], 0)).toBeCloseTo(-expectedGap / 2);
    expect(segmentOffset(segments[1], 1)).toBeCloseTo(-expectedGap / 2);
    // Pending arcs take the supplied rail-track color at full opacity so ring
    // and connector read as one piece of chrome; completed arcs stay success.
    const segmentAnimated = (segment: JsonNode) =>
      segment && typeof segment !== 'string' && !Array.isArray(segment)
        ? segment.props.animatedProps
        : null;
    expect(segmentAnimated(segments[1])?.stroke).toBe('rail-track');
    expect(segmentAnimated(segments[1])?.opacity).toBe(1);
    expect(segmentAnimated(segments[0])?.opacity).toBe(1);
    // The result disc colourises from the chrome the ring wears — not the
    // foreground — so resolving never flashes white.
    const disc = collectNodesByType(renderer!.toJSON(), 'Circle').find(
      (circle) =>
        circle && typeof circle !== 'string' && !Array.isArray(circle) && circle.props.mask != null
    );
    expect(
      disc && typeof disc !== 'string' && !Array.isArray(disc)
        ? disc.props.animatedProps.fill
        : null
    ).toBe('rail-track');
    act(() => {
      renderer.unmount();
    });

    // Without the px target, pending arcs keep the grow-on-fill thinning.
    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator
          confirmationProgress={{ currentConfirmations: 1, requiredConfirmations: 3 }}
          phase="idle"
        />
      );
    });
    const defaultSegments = collectNodesByTestIDPrefix(
      renderer!.toJSON(),
      'loading-indicator-confirmation-segment-'
    );
    expect(segmentStrokeWidth(defaultSegments[0])).toBeCloseTo(8.5);
    expect(segmentStrokeWidth(defaultSegments[1])).toBeCloseTo(8.5 * 0.72);
    // Default consumers keep the pending fade.
    expect(
      defaultSegments[1] &&
        typeof defaultSegments[1] !== 'string' &&
        !Array.isArray(defaultSegments[1])
        ? defaultSegments[1].props.animatedProps.opacity
        : null
    ).toBeCloseTo(0.45);
    act(() => {
      renderer.unmount();
    });

    // Plain idle ring: the outline stroke follows the same px target, and the
    // dash gaps widen so round caps don't merge the dashes.
    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator size={20} strokeWidthPx={3} pendingColor="rail-track" phase="idle" />
      );
    });
    const circles = collectNodesByType(renderer!.toJSON(), 'Circle');
    const ring = circles.find(
      (circle) =>
        circle &&
        typeof circle !== 'string' &&
        !Array.isArray(circle) &&
        circle.props.strokeLinecap === 'round'
    );
    expect(
      ring && typeof ring !== 'string' && !Array.isArray(ring) ? ring.props.strokeWidth : null
    ).toBeCloseTo(15);
    const ringAnimated =
      ring && typeof ring !== 'string' && !Array.isArray(ring) ? ring.props.animatedProps : null;
    const dashArray = (ringAnimated?.strokeDasharray as number[]) ?? [];
    // Idle dashes share the segment-ring seam policy: gap = stroke + 0.75·stroke.
    expect(dashArray[1]).toBeCloseTo(15 * 1.75);
    // Idle dashes are unfilled chrome too: rail-track colour at full opacity,
    // same as the pending segment arcs.
    expect(ringAnimated?.stroke).toBe('rail-track');
    expect(ringAnimated?.opacity).toBe(1);
    // Same seam frame as the segment ring: 12 o'clock start, dash centered
    // within its step (offset by half a gap).
    const ringProps = ring && typeof ring !== 'string' && !Array.isArray(ring) ? ring.props : null;
    expect(ringProps?.strokeDashoffset).toBeCloseTo(-(15 * 1.75) / 2);
    expect(ringProps?.transform).toBe('rotate(-90 50 50)');
    act(() => {
      renderer.unmount();
    });

    // The spinning loading arc wears the same chrome colour as the idle
    // dashes — pendingColor covers every non-result stroke.
    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator size={20} strokeWidthPx={3} pendingColor="rail-track" phase="loading" />
      );
    });
    const loadingRing = collectNodesByType(renderer!.toJSON(), 'Circle').find(
      (circle) =>
        circle &&
        typeof circle !== 'string' &&
        !Array.isArray(circle) &&
        circle.props.strokeLinecap === 'round'
    );
    expect(
      loadingRing && typeof loadingRing !== 'string' && !Array.isArray(loadingRing)
        ? loadingRing.props.animatedProps.stroke
        : null
    ).toBe('rail-track');
    act(() => {
      renderer.unmount();
    });

    // Without the prop the viewBox-relative default is untouched.
    act(() => {
      renderer = TestRenderer.create(<LoadingIndicator size={20} phase="idle" />);
    });
    const defaultRing = collectNodesByType(renderer!.toJSON(), 'Circle').find(
      (circle) =>
        circle &&
        typeof circle !== 'string' &&
        !Array.isArray(circle) &&
        circle.props.strokeLinecap === 'round'
    );
    expect(
      defaultRing && typeof defaultRing !== 'string' && !Array.isArray(defaultRing)
        ? defaultRing.props.strokeWidth
        : null
    ).toBeCloseTo(3.5);
    // Default idle chrome unchanged: ring `color` at the dimmed idle opacity.
    const defaultRingAnimated =
      defaultRing && typeof defaultRing !== 'string' && !Array.isArray(defaultRing)
        ? defaultRing.props.animatedProps
        : null;
    expect(defaultRingAnimated?.stroke).toBe('foreground');
    expect(defaultRingAnimated?.opacity).toBe(0.5);
    // Default consumers keep the legacy foreground→result disc bloom.
    const defaultDisc = collectNodesByType(renderer!.toJSON(), 'Circle').find(
      (circle) =>
        circle && typeof circle !== 'string' && !Array.isArray(circle) && circle.props.mask != null
    );
    expect(
      defaultDisc && typeof defaultDisc !== 'string' && !Array.isArray(defaultDisc)
        ? defaultDisc.props.animatedProps.fill
        : null
    ).toBe('foreground');
    act(() => {
      renderer.unmount();
    });
  });

  it('breathes the next segment only when the step is in progress', () => {
    const reanimated = jest.requireMock('react-native-reanimated') as {
      withRepeat: (...args: unknown[]) => unknown;
    };
    const withRepeatSpy = jest.spyOn(reanimated, 'withRepeat');
    let renderer: TestRenderer.ReactTestRenderer;

    // Default: the first not-yet-filled segment runs the looping breathe.
    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator
          confirmationProgress={{ currentConfirmations: 1, requiredConfirmations: 3 }}
          phase="idle"
        />
      );
    });
    expect(withRepeatSpy).toHaveBeenCalled();
    act(() => {
      renderer.unmount();
    });

    // Preview mode (segmentedInProgress={false}): no segment breathes — the
    // ring only shows the upcoming confirmation count.
    withRepeatSpy.mockClear();
    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator
          confirmationProgress={{ currentConfirmations: null, requiredConfirmations: 3 }}
          phase="idle"
          segmentedInProgress={false}
        />
      );
    });
    expect(withRepeatSpy).not.toHaveBeenCalled();
    act(() => {
      renderer.unmount();
    });

    withRepeatSpy.mockRestore();
  });

  it('keeps generic segments mounted while completion resolves through success', () => {
    let renderer: TestRenderer.ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(
        <LoadingIndicator
          segmentedProgress={{ completedSegments: 3, segmentCount: 4 }}
          phase="loading"
        />
      );
    });

    expect(
      collectNodesByTestIDPrefix(renderer!.toJSON(), 'loading-indicator-confirmation-segment-')
    ).toHaveLength(4);

    act(() => {
      renderer.update(
        <LoadingIndicator
          segmentedProgress={{ completedSegments: 4, segmentCount: 4 }}
          phase="loading"
        />
      );
    });

    expect(
      collectNodesByTestIDPrefix(renderer!.toJSON(), 'loading-indicator-confirmation-segment-')
    ).toHaveLength(4);

    act(() => {
      renderer.unmount();
    });
  });
});
