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
  FillType: { EvenOdd: 'evenOdd' },
  Group: host('sk-group'),
  Path: host('sk-path'),
  RadialGradient: host('sk-radial'),
  Skia: {
    Path: {
      Make: () => {
        const circles: number[][] = [];
        const path = {
          circles,
          fillType: '',
          addCircle: (x: number, y: number, r: number) => circles.push([x, y, r]),
          setFillType: (fillType: string) => (path.fillType = fillType),
        };
        return path;
      },
    },
  },
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

  it('drifts colour blobs through the band, clipped to it, under fixed lighting', () => {
    const { root } = mount('gold');
    const [glow, film] = byTestId(root, 'sk-group');
    // Glow: a blurred wide band plus blurred blobs.
    expect(byTestId(glow!, 'sk-circle')[0]!.props.strokeWidth).toBeGreaterThan(6);
    const glowBlobs = byTestId(glow!, 'sk-radial');
    expect(glowBlobs.length).toBeGreaterThanOrEqual(4);
    // Film: the same blobs, sharp, clipped to the band annulus (two circles, even-odd).
    const blobs = byTestId(film!, 'sk-radial');
    expect(blobs).toHaveLength(glowBlobs.length);
    expect(film!.props.clip.circles).toHaveLength(2);
    expect(film!.props.clip.fillType).toBe('evenOdd');
    expect(byTestId(film!, 'sk-blur')).toHaveLength(0);
    // Each blob rides the ring's centre line, driven by the shared clock.
    const ringRadius = byTestId(root, 'sk-circle').find((c) => c.props.color)!.props.r;
    const centre = byTestId(root, 'sk-canvas')[0]!.props.style.width / 2;
    for (const blob of blobs) {
      const { x, y } = blob.props.c.value;
      expect(Math.hypot(x - centre, y - centre)).toBeCloseTo(ringRadius, 6);
      expect(blob.props.r.value).toBeGreaterThan(0);
    }
    // Bevel arcs, kisses and rim sit OUTSIDE the film group.
    expect(byTestId(root, 'sk-path')).toHaveLength(2);
    expect(byTestId(film!, 'sk-path')).toHaveLength(0);
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

  it('the film loops seamlessly: a blob is where it started when the clock wraps', () => {
    // The mocked clock lands on the loop's end (1); the blob must sit exactly
    // where a clock of 0 would put it.
    const { root } = mount('new');
    const film = byTestId(root, 'sk-group')[1]!;
    const blob = byTestId(film, 'sk-radial')[0]!;
    const atWrap = blob.props.c.value;
    mockReducedMotion = true; // clock held at 0
    const still = byTestId(byTestId(mount('new').root, 'sk-group')[1]!, 'sk-radial')[0]!;
    expect(atWrap.x).toBeCloseTo(still.props.c.value.x, 6);
    expect(atWrap.y).toBeCloseTo(still.props.c.value.y, 6);
    expect(blob.props.r.value).toBeCloseTo(still.props.r.value, 6);
  });
});
