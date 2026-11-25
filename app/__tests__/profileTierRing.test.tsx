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
  Circle: host('svg-circle'),
  ClipPath: host('svg-clip'),
  Defs: host('svg-defs'),
  FeGaussianBlur: host('svg-blur'),
  Filter: host('svg-filter'),
  G: host('svg-group'),
  Path: host('svg-path'),
  RadialGradient: host('svg-radial'),
  Stop: host('svg-stop'),
  Text: host('svg-text'),
  TextPath: host('svg-text-path'),
}));

let mockReducedMotion = false;
const mockCancel = jest.fn();
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: host('animated-view'),
    // An animated component renders its UI-thread props as plain props.
    createAnimatedComponent:
      (Component: React.ComponentType<Record<string, unknown>>) =>
      ({ animatedProps, ...props }: { animatedProps?: object }) => {
        const ReactActual = jest.requireActual<typeof import('react')>('react');
        return ReactActual.createElement(Component, { ...props, ...animatedProps });
      },
  },
  Easing: { linear: 'linear', cubic: 'cubic', out: (e: unknown) => e },
  cancelAnimation: (...args: unknown[]) => mockCancel(...args),
  useAnimatedProps: (fn: () => unknown) => fn(),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSequence: (...steps: unknown[]) => steps[steps.length - 1],
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
      expect(byTestId(root, 'svg-root')).toHaveLength(tier ? 1 : 0);
    }
  });

  const blobsIn = (node: TestRenderer.ReactTestInstance) =>
    byTestId(node, 'svg-circle').filter((c) => String(c.props.fill).startsWith('url('));
  const bandCircle = (root: TestRenderer.ReactTestInstance) =>
    byTestId(root, 'svg-circle').find(
      (c) => c.props.stroke && !c.props.filter && c.props.strokeWidth > 6
    )!;
  const centreOf = (root: TestRenderer.ReactTestInstance) =>
    byTestId(root, 'svg-root')[0]!.props.width / 2;

  it('drifts colour blobs through the band, clipped to it, under fixed lighting', () => {
    const { root } = mount('gold');
    const [glow, film] = byTestId(root, 'svg-group');
    // Glow: a blurred wide band plus blurred blobs.
    const glowBand = byTestId(glow!, 'svg-circle')[0]!;
    expect(glowBand.props.strokeWidth).toBeGreaterThan(6);
    expect(glowBand.props.filter).toMatch(/^url\(#.*blur-glow\)$/);
    const glowBlobs = blobsIn(glow!);
    expect(glowBlobs.length).toBeGreaterThanOrEqual(4);
    for (const blob of glowBlobs) expect(blob.props.filter).toBe(glowBand.props.filter);
    // Film: the same blobs, sharp, clipped to the band annulus (two circles, even-odd).
    const blobs = blobsIn(film!);
    expect(blobs).toHaveLength(glowBlobs.length);
    for (const blob of blobs) expect(blob.props.filter).toBeUndefined();
    const clipId = /^url\(#(.*)\)$/.exec(film!.props.clipPath)![1];
    const clip = byTestId(root, 'svg-clip').find((c) => c.props.id === clipId)!;
    const annulus = byTestId(clip, 'svg-path')[0]!;
    expect(annulus.props.clipRule).toBe('evenodd');
    expect(annulus.props.d.match(/M /g)).toHaveLength(2);
    // Each blob rides the ring's centre line, driven by the shared clock.
    const ringRadius = bandCircle(root).props.r;
    const centre = centreOf(root);
    for (const blob of blobs) {
      expect(Math.hypot(blob.props.cx - centre, blob.props.cy - centre)).toBeCloseTo(ringRadius, 6);
      expect(blob.props.r).toBeGreaterThan(0);
    }
    // Bevel arcs, kisses and rim sit OUTSIDE the film group.
    const bevels = byTestId(root, 'svg-path').filter((n) => n.props.strokeLinecap === 'round');
    expect(bevels).toHaveLength(2);
    expect(byTestId(film!, 'svg-path')).toHaveLength(0);
    // Engraved: the same word twice — an offset dark copy under a light face.
    const inscriptions = byTestId(root, 'svg-text-path');
    expect(inscriptions.map((n) => n.props.children)).toEqual(['GOLD', 'GOLD']);
    const [shadow, face] = byTestId(root, 'svg-text');
    expect(shadow!.props.dy).toBeLessThan(0);
    expect(face!.props.dy).toBeUndefined();
    // Both inks are tints of the band's hue (gold = 44), centred on the band's
    // centre line and on the arc.
    expect(shadow!.props.fill).toMatch(/^hsla\(44,/);
    expect(face!.props.fill).toMatch(/^hsla\(44,/);
    expect(face!.props.alignmentBaseline).toBe('central');
    const d: string = byTestId(root, 'svg-path')[0]!.props.d;
    expect(Number(d.split(' ')[4])).toBeCloseTo(ringRadius, 6);
    expect(byTestId(root, 'svg-text-path')[0]!.props.startOffset).toBeCloseTo(
      (ringRadius * 110 * Math.PI) / 360,
      6
    );
    expect(byTestId(root, 'svg-root')[0]!.props.accessibilityLabel).toBe('GOLD tier');
  });

  it('bleeds the canvas past the layout box so the glow is never clipped, lettering lower-right', () => {
    const { root } = mount('gold');
    const outer = 90 + profileTierRingInset(90) * 2;
    const canvas = byTestId(root, 'svg-root')[0]!.props.style;
    expect(canvas.left).toBeLessThan(0);
    expect(canvas.top).toBe(canvas.left);
    expect(canvas.width).toBe(outer - 2 * canvas.left);
    // Every blur covers the whole canvas, so the glow is never cropped.
    for (const filter of byTestId(root, 'svg-filter')) {
      expect(filter.props.width).toBe(canvas.width);
    }
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
    const blob = blobsIn(byTestId(root, 'svg-group')[1]!)[0]!;
    mockReducedMotion = true; // clock held at 0
    const still = blobsIn(byTestId(mount('new').root, 'svg-group')[1]!)[0]!;
    expect(blob.props.cx).toBeCloseTo(still.props.cx, 6);
    expect(blob.props.cy).toBeCloseTo(still.props.cy, 6);
    expect(blob.props.r).toBeCloseTo(still.props.r, 6);
  });
});
