/**
 * @jest-environment node
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ProfileTierRing, profileTierRingInset } from '@/shared/ui/composed/ProfileTierRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const host = (name: string) => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return ({ children, ...props }: { children?: React.ReactNode }) =>
    ReactActual.createElement(View, { testID: name, ...props }, children);
};

jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: host('svg-root'),
  Defs: host('svg-defs'),
  Path: host('svg-path'),
  Text: host('svg-text'),
  TextPath: host('svg-text-path'),
}));

jest.mock('@shopify/react-native-skia', () => ({
  BlurMask: host('sk-blur'),
  Canvas: host('sk-canvas'),
  Circle: host('sk-circle'),
  Group: host('sk-group'),
  Path: host('sk-path'),
  SweepGradient: host('sk-sweep'),
  vec: (x: number, y: number) => ({ x, y }),
}));

let mockReducedMotion = false;
const mockCancel = jest.fn();
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: host('animated-view') },
  Easing: { linear: 'linear', cubic: 'cubic', out: (e: unknown) => e },
  cancelAnimation: (...args: unknown[]) => mockCancel(...args),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSequence: (...steps: unknown[]) => steps[steps.length - 1],
  useDerivedValue: (fn: () => unknown) => ({
    get value() {
      return fn();
    },
  }),
  useReducedMotion: () => mockReducedMotion,
  useSharedValue: (value: number) => ({ value }),
  withRepeat: (value: unknown) => value,
  withTiming: (value: unknown) => value,
}));

function mount(tier: 'gold' | 'new' | null) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ProfileTierRing tier={tier} seed="a" size={90} background="black">
        <Text>pfp</Text>
      </ProfileTierRing>
    );
  });
  return renderer;
}

const byTestId = (root: TestRenderer.ReactTestInstance, testID: string) =>
  root.findAll((node) => node.props.testID === testID && typeof node.type !== 'string');

beforeEach(() => {
  mockReducedMotion = false;
  mockCancel.mockReset();
});

describe('ProfileTierRing', () => {
  it('reserves the same layout with and without a tier, so the avatar never moves', () => {
    const outer = 90 + profileTierRingInset(90) * 2;
    for (const tier of ['gold', null] as const) {
      const { root } = mount(tier);
      const frame = byTestId(root, 'profile-tier-ring')[0]!;
      expect(frame.props.style).toEqual({ width: outer, height: outer });
      expect(root.findAll((n) => n.props.children === 'pfp').length).toBeGreaterThan(0);
      expect(byTestId(root, 'sk-canvas')).toHaveLength(tier ? 1 : 0);
      expect(byTestId(root, 'svg-root')).toHaveLength(tier ? 1 : 0);
    }
  });

  it('layers glow and film under fixed lighting, and letters the rim', () => {
    const { root } = mount('gold');
    // Glow + film: two stroked circles carrying the sweep, inside the turning group.
    const group = byTestId(root, 'sk-group')[0]!;
    expect(byTestId(group, 'sk-sweep')).toHaveLength(2);
    const [glow, film] = byTestId(group, 'sk-circle');
    expect(glow!.props.r).toBe(film!.props.r);
    expect(glow!.props.strokeWidth).toBeGreaterThan(film!.props.strokeWidth);
    expect(byTestId(glow!, 'sk-blur')).toHaveLength(1);
    // Bevel arcs, kisses and rim sit OUTSIDE the turning group.
    expect(byTestId(root, 'sk-path')).toHaveLength(2);
    expect(byTestId(root, 'sk-path').every((p) => byTestId(group, 'sk-path').indexOf(p) < 0)).toBe(
      true
    );
    // Engraved: the same word twice (light lip under dark ink).
    const inscriptions = byTestId(root, 'svg-text-path');
    expect(inscriptions.map((n) => n.props.children)).toEqual(['GOLD', 'GOLD']);
    expect(byTestId(root, 'svg-root')[0]!.props.accessibilityLabel).toBe('GOLD tier');
  });

  it('bleeds the canvas past the layout box so the glow is never clipped, lettering lower-right', () => {
    const { root } = mount('gold');
    const outer = 90 + profileTierRingInset(90) * 2;
    const canvas = byTestId(root, 'sk-canvas')[0]!.props.style;
    expect(canvas.left).toBeLessThan(0);
    expect(canvas.top).toBe(canvas.left);
    expect(canvas.width).toBe(outer - 2 * canvas.left);
    // The word's arc runs from below the centre to the right of it.
    const d: string = byTestId(root, 'svg-path')[0]!.props.d;
    const [, mx, my, , , , , , , ex, ey] = d.split(' ').map(Number);
    const c = canvas.width / 2;
    expect(my).toBeGreaterThan(c);
    expect(mx).toBeLessThan(c);
    expect(ex).toBeGreaterThan(c);
    expect(ey).toBeLessThan(c);
  });

  it('turns the film, and holds still under reduced motion', () => {
    expect(byTestId(mount('new').root, 'sk-group')[0]!.props.transform.value).toEqual([
      { rotate: Math.PI * 2 },
    ]);
    mockReducedMotion = true;
    expect(byTestId(mount('new').root, 'sk-group')[0]!.props.transform.value).toEqual([
      { rotate: 0 },
    ]);
  });
});
