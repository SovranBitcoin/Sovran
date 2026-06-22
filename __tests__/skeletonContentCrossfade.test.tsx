/**
 * @jest-environment node
 *
 * `SkeletonContentCrossfade` phase machine. These pin the behaviors the whole
 * app's skeleton→content swaps rely on:
 *  - loading shows the skeleton (+ region wave), never the content;
 *  - `wave="none"` and reduced motion suppress the shimmer;
 *  - on the loading→loaded edge the content mounts under a still-present
 *    skeleton overlay (the crossfade), while reduced motion / `exit="none"`
 *    swap instantly;
 *  - re-entering loading cancels an in-flight exit (no stacked overlays);
 *  - a row that mounts already-loaded never plays a fade.
 *
 * Reanimated is mocked so `withTiming` does NOT auto-complete — that lets us
 * observe the live "exiting" frame (content + fading skeleton) deterministically.
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockReducedMotion = false;

jest.mock('react-native-reanimated', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactActual.createElement(View, props, children),
    },
    useReducedMotion: () => mockReducedMotion,
    useSharedValue: (initial: number) => ({
      value: initial,
      get() {
        return this.value;
      },
      set(next: number) {
        this.value = next;
      },
    }),
    // Return the target but never invoke the completion callback, so the
    // component stays in its 'exiting' frame for assertions.
    withTiming: (toValue: number) => toValue,
    cancelAnimation: () => {},
    useAnimatedStyle: () => ({}),
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    Easing: { out: () => (t: number) => t, inOut: () => (t: number) => t, cubic: (t: number) => t },
    ReduceMotion: { System: 'system' },
  };
});

jest.mock('@/shared/ui/composed/SkeletonExitShimmer', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SkeletonLoadingShimmer: ({ active }: { active?: boolean }) =>
      active ? ReactActual.createElement(View, { testID: 'shimmer' }) : null,
  };
});

const skeletonNode = () => <View testID="sk" />;
const contentNode = () => <View testID="ct" />;

function makeView() {
  return jest.requireActual<typeof import('react-native')>('react-native').View;
}
const View = makeView();

function present(renderer: TestRenderer.ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAll((n) => n.props?.testID === testID).length > 0;
}

function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

describe('SkeletonContentCrossfade', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it('shows skeleton + region wave while loading, not content', () => {
    const r = render(
      <SkeletonContentCrossfade loading renderSkeleton={skeletonNode} renderContent={contentNode} />
    );
    expect(present(r, 'sk')).toBe(true);
    expect(present(r, 'shimmer')).toBe(true);
    expect(present(r, 'ct')).toBe(false);
    act(() => r.unmount());
  });

  it('omits the wave when wave="none"', () => {
    const r = render(
      <SkeletonContentCrossfade
        loading
        wave="none"
        renderSkeleton={skeletonNode}
        renderContent={contentNode}
      />
    );
    expect(present(r, 'sk')).toBe(true);
    expect(present(r, 'shimmer')).toBe(false);
    act(() => r.unmount());
  });

  it('omits the wave under reduced motion', () => {
    mockReducedMotion = true;
    const r = render(
      <SkeletonContentCrossfade loading renderSkeleton={skeletonNode} renderContent={contentNode} />
    );
    expect(present(r, 'shimmer')).toBe(false);
    act(() => r.unmount());
  });

  it('crossfades on the loading→loaded edge: content mounts under a fading skeleton', () => {
    const r = render(
      <SkeletonContentCrossfade loading renderSkeleton={skeletonNode} renderContent={contentNode} />
    );
    act(() => {
      r.update(
        <SkeletonContentCrossfade
          loading={false}
          renderSkeleton={skeletonNode}
          renderContent={contentNode}
        />
      );
    });
    // Exiting frame: real content present AND skeleton overlay still fading out.
    expect(present(r, 'ct')).toBe(true);
    expect(present(r, 'sk')).toBe(true);
    act(() => r.unmount());
  });

  it('swaps instantly under reduced motion (no lingering skeleton)', () => {
    mockReducedMotion = true;
    const r = render(
      <SkeletonContentCrossfade loading renderSkeleton={skeletonNode} renderContent={contentNode} />
    );
    act(() => {
      r.update(
        <SkeletonContentCrossfade
          loading={false}
          renderSkeleton={skeletonNode}
          renderContent={contentNode}
        />
      );
    });
    expect(present(r, 'ct')).toBe(true);
    expect(present(r, 'sk')).toBe(false);
    act(() => r.unmount());
  });

  it('swaps instantly with exit="none" (no fading skeleton overlay)', () => {
    const r = render(
      <SkeletonContentCrossfade
        loading
        exit="none"
        renderSkeleton={skeletonNode}
        renderContent={contentNode}
      />
    );
    act(() => {
      r.update(
        <SkeletonContentCrossfade
          loading={false}
          exit="none"
          renderSkeleton={skeletonNode}
          renderContent={contentNode}
        />
      );
    });
    expect(present(r, 'ct')).toBe(true);
    expect(present(r, 'sk')).toBe(false);
    act(() => r.unmount());
  });

  it('re-entering loading cancels the exit: skeleton returns, content gone (no stacked overlay)', () => {
    const r = render(
      <SkeletonContentCrossfade loading renderSkeleton={skeletonNode} renderContent={contentNode} />
    );
    act(() => {
      r.update(
        <SkeletonContentCrossfade
          loading={false}
          renderSkeleton={skeletonNode}
          renderContent={contentNode}
        />
      );
    });
    act(() => {
      r.update(
        <SkeletonContentCrossfade
          loading
          renderSkeleton={skeletonNode}
          renderContent={contentNode}
        />
      );
    });
    expect(present(r, 'sk')).toBe(true);
    expect(present(r, 'ct')).toBe(false);
    act(() => r.unmount());
  });

  it('a row mounted already-loaded shows content with no skeleton (no spurious fade)', () => {
    const r = render(
      <SkeletonContentCrossfade
        loading={false}
        renderSkeleton={skeletonNode}
        renderContent={contentNode}
      />
    );
    expect(present(r, 'ct')).toBe(true);
    expect(present(r, 'sk')).toBe(false);
    act(() => r.unmount());
  });
});
