/**
 * @jest-environment node
 *
 * Segment-cascade timing regression tests.
 *
 * The old implementation tracked the previously-completed segment count in a
 * ref written from a useEffect but READ during render. The render that
 * flipped `completedSegments` computed correct cascade delays, but the ref
 * caught up after the effect flush, so the very next re-render — however
 * unrelated — recomputed `resultDelayMs` (505 → 340 for a 4-segment batch)
 * and, because `resultDelayMs` is a dependency of the phase-choreography
 * effect, re-fired the whole transition with the shrunken delay mid-flight.
 *
 * These tests pin the fixed behavior: the cascade base is captured in the
 * SAME render the count flips (render-adjust state, never stale) and stays
 * put across later re-renders, so delays are computed once and the
 * choreography never re-fires without a real input change.
 *
 * Unlike the confirmation-progress suite, this harness keeps shared values
 * STABLE across renders (like real Reanimated), so an effect re-fire here
 * means its declared inputs actually changed.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { LoadingIndicator } from '@/shared/blocks/status/LoadingIndicator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map((token) => token) : tokens,
}));

jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
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
    useFrameCallback: jest.fn(),
    // Stable across renders, like the real hook: effects keyed on shared
    // values must not re-fire just because the component re-rendered.
    useSharedValue: <T,>(value: T) => {
      const ref = ReactActual.useRef<{ get: () => T; set: (next: T) => void } | null>(null);
      if (ref.current === null) {
        let current = value;
        ref.current = {
          get: () => current,
          set: (next: T) => {
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
    Path: createSvgHost('Path'),
    Rect: createSvgHost('Rect'),
    Svg: createSvgHost('Svg'),
  };
});

type DebugEvent = { event: string; params: Record<string, unknown> };

const SEGMENT_ANIM_MS = 340;
const SEGMENT_STAGGER_MS = 55;

describe('LoadingIndicator segment cascade timing', () => {
  function renderHarness(initialCompleted: number, segmentCount: number) {
    const events: DebugEvent[] = [];
    const onDebugEvent = (event: string, params: Record<string, unknown>) => {
      events.push({ event, params });
    };
    const element = (completedSegments: number) => (
      <LoadingIndicator
        segmentedProgress={{ completedSegments, segmentCount }}
        phase="loading"
        onDebugEvent={onDebugEvent}
      />
    );

    let renderer: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(element(initialCompleted));
    });

    return {
      events,
      update: (completedSegments: number) => {
        act(() => {
          renderer.update(element(completedSegments));
        });
      },
      unmount: () => {
        act(() => {
          renderer.unmount();
        });
      },
    };
  }

  const ofType = (events: DebugEvent[], type: string) => events.filter((e) => e.event === type);

  it('computes batch delays and the result hold from the flip in the same render', () => {
    const { events, update, unmount } = renderHarness(0, 4);
    events.length = 0;

    // All four segments complete in one frame.
    update(4);

    // The render that flipped the count already carries the correct batch:
    // base 0, four newly completing, and the success disc held until the
    // final segment of the batch has started filling.
    const segmentsEvents = ofType(events, 'dot.segments');
    expect(segmentsEvents).toHaveLength(1);
    expect(segmentsEvents[0].params).toMatchObject({
      completedSegments: 4,
      prevCompletedSegments: 0,
      newlyCompleting: 4,
      resultDelayMs: SEGMENT_ANIM_MS + 3 * SEGMENT_STAGGER_MS, // 505
    });

    // Each newly-completing segment fills at its slot within the batch.
    const fills = ofType(events, 'dot.segment_fill');
    expect(fills.map((e) => [e.params.segmentIndex, e.params.delayMs])).toEqual([
      [0, 0 * SEGMENT_STAGGER_MS],
      [1, 1 * SEGMENT_STAGGER_MS],
      [2, 2 * SEGMENT_STAGGER_MS],
      [3, 3 * SEGMENT_STAGGER_MS],
    ]);

    // The phase choreography scheduled in that same commit uses the held
    // delay — not a later, caught-up recomputation.
    const transitions = ofType(events, 'dot.transition');
    expect(transitions).toHaveLength(1);
    expect(transitions[0].params).toMatchObject({
      effectivePhase: 'done',
      resultDelayMs: SEGMENT_ANIM_MS + 3 * SEGMENT_STAGGER_MS,
    });

    unmount();
  });

  it('keeps the computed delays stable across an unrelated re-render (the old desync)', () => {
    const { events, update, unmount } = renderHarness(0, 4);

    update(4);
    events.length = 0;

    // Unrelated re-render with identical inputs. The old ref-in-effect
    // tracking had caught up by now (prev = 4), so this render recomputed
    // resultDelayMs as 340 and RE-FIRED the phase choreography with the
    // shrunken delay. The fixed cascade keeps the batch base until the next
    // flip: nothing may re-fire.
    update(4);

    expect(ofType(events, 'dot.transition')).toHaveLength(0);
    expect(ofType(events, 'dot.segment_fill')).toHaveLength(0);
    expect(ofType(events, 'dot.segments')).toHaveLength(0);

    unmount();
  });

  it('staggers only the newly-completing batch and never re-pulses filled segments', () => {
    const { events, update, unmount } = renderHarness(1, 5);
    events.length = 0;

    // 1 → 3: segments 1 and 2 are the new batch (slots 0 and 1); segment 0
    // is already filled and must not animate again.
    update(3);
    let fills = ofType(events, 'dot.segment_fill');
    expect(fills.map((e) => [e.params.segmentIndex, e.params.delayMs])).toEqual([
      [1, 0 * SEGMENT_STAGGER_MS],
      [2, 1 * SEGMENT_STAGGER_MS],
    ]);
    expect(ofType(events, 'dot.segments')[0].params).toMatchObject({
      completedSegments: 3,
      prevCompletedSegments: 1,
      newlyCompleting: 2,
    });

    // Next flip 3 → 4: only segment 3 fills. Segments 1–2 get a fresh delay
    // prop (their cascade slot resets to 0) but their completed state did not
    // change, so they must not re-fire the fill/pulse.
    events.length = 0;
    update(4);
    fills = ofType(events, 'dot.segment_fill');
    expect(fills.map((e) => [e.params.segmentIndex, e.params.delayMs])).toEqual([[3, 0]]);
    expect(ofType(events, 'dot.segments')[0].params).toMatchObject({
      completedSegments: 4,
      prevCompletedSegments: 3,
      newlyCompleting: 1,
    });

    unmount();
  });
});
