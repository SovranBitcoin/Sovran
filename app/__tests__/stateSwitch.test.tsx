/**
 * @jest-environment node
 *
 * `<StateSwitch>` over the real `SkeletonContentCrossfade`: loading shows the
 * skeleton, each settled state its own branch, and the three data states
 * (`ready`, `refreshing`, `stale`) keep the same content mounted.
 */

import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import type { ViewState } from '@/shared/lib/viewState';
import { StateSwitch } from '@/shared/ui/composed/StateSwitch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockReducedMotion = false;
let mockFinishAnimation: ((finished: boolean) => void) | undefined;

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
    // Kept across renders, as Reanimated's is: `initial` is read once.
    useSharedValue: (initial: number) =>
      ReactActual.useState(() => ({
        value: initial,
        get() {
          return this.value;
        },
        set(next: number) {
          this.value = next;
        },
      }))[0],
    // Hold the animation at its start and expose completion to the test,
    // so the exiting frame and content mount lifecycle stay observable.
    withTiming: (_toValue: number, _config: unknown, callback: (finished: boolean) => void) => {
      mockFinishAnimation = callback;
      return 0;
    },
    cancelAnimation: () => {},
    useAnimatedStyle: (factory: () => object) => factory(),
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    interpolate: (value: number, input: number[], output: number[]) => {
      const fraction = Math.max(0, Math.min(1, (value - input[0]) / (input[1] - input[0])));
      return output[0] + fraction * (output[1] - output[0]);
    },
    Extrapolation: { CLAMP: 'clamp' },
    Easing: {
      out: () => (t: number) => t,
      inOut: () => (t: number) => t,
      cubic: (t: number) => t,
      quad: (t: number) => t,
    },
    ReduceMotion: { System: 'system' },
  };
});

jest.mock('@/shared/hooks/useThemeColor', () => ({
  // SkeletonLoadingShimmer is mocked here, so the value is never run through
  // hex-color-opacity — a plain token string is fine.
  useThemeColor: (tokens: string | readonly string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'theme-surface') : 'theme-surface',
}));

jest.mock('@/shared/ui/composed/SkeletonExitShimmer', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SkeletonLoadingShimmer: ({
      active,
      highlightColor,
    }: {
      active?: boolean;
      highlightColor?: string;
    }) =>
      active
        ? ReactActual.createElement(View, { testID: 'shimmer', accessibilityLabel: highlightColor })
        : null,
  };
});

const View = jest.requireActual<typeof import('react-native')>('react-native').View;

let mounts = 0;
let unmounts = 0;
function Rows({ items, mark }: { items: string[]; mark: string }) {
  useEffect(() => {
    mounts++;
    return () => {
      unmounts++;
    };
  }, []);
  return <View testID={`rows:${mark}:${items.join(',')}`} />;
}

function element(state: ViewState<string[]>) {
  return (
    <StateSwitch
      state={state}
      exit="none"
      renderLoading={() => <View testID="skeleton" />}
      renderEmpty={() => <View testID="empty" />}
      renderError={(error) => <View testID={`error:${String(error)}`} />}
      renderData={(items, info) => <Rows items={items} mark={info.status} />}
    />
  );
}

function render(state: ViewState<string[]>) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element(state));
  });
  return {
    renderer,
    to: (next: ViewState<string[]>) => act(() => renderer.update(element(next))),
    has: (testID: string) => renderer.root.findAll((n) => n.props?.testID === testID).length > 0,
  };
}

beforeEach(() => {
  mounts = 0;
  unmounts = 0;
  mockReducedMotion = false;
});

describe('StateSwitch', () => {
  it('shows the skeleton while loading, then the branch that arrived', () => {
    const view = render({ status: 'loading' });
    expect(view.has('skeleton')).toBe(true);
    view.to({ status: 'empty' });
    expect(view.has('skeleton')).toBe(false);
    expect(view.has('empty')).toBe(true);
    view.to({ status: 'error', error: 'offline' });
    expect(view.has('error:offline')).toBe(true);
    view.to({ status: 'ready', data: ['a'] });
    expect(view.has('rows:ready:a')).toBe(true);
  });

  it('keeps the content mounted across ready, refreshing and stale', () => {
    const view = render({ status: 'ready', data: ['a'] });
    view.to({ status: 'refreshing', data: ['a'] });
    expect(view.has('rows:refreshing:a')).toBe(true);
    view.to({ status: 'stale', data: ['a', 'b'], error: 'timeout' });
    expect(view.has('rows:stale:a,b')).toBe(true);
    view.to({ status: 'ready', data: ['a', 'b'] });
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('swaps the content for empty or error', () => {
    const view = render({ status: 'ready', data: ['a'] });
    view.to({ status: 'empty' });
    expect(unmounts).toBe(1);
    expect(view.has('empty')).toBe(true);
  });

  it('crossfades from the skeleton into data with a fading overlay', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const fading = (state: ViewState<string[]>) => (
      <StateSwitch
        state={state}
        renderLoading={() => <View testID="skeleton" />}
        renderData={(items) => <Rows items={items} mark="d" />}
      />
    );
    act(() => {
      renderer = TestRenderer.create(fading({ status: 'loading' }));
    });
    act(() => renderer.update(fading({ status: 'ready', data: ['a'] })));
    const has = (id: string) => renderer.root.findAll((n) => n.props?.testID === id).length > 0;
    // Mid-fade: content mounted under the still-present skeleton.
    expect(has('rows:d:a')).toBe(true);
    expect(has('skeleton')).toBe(true);
    act(() => mockFinishAnimation?.(true));
    expect(has('skeleton')).toBe(false);
    expect(mounts).toBe(1);
  });
});
