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
const mockWithRepeat = jest.fn((value: unknown) => value);
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: host('animated-view'),
  },
  Easing: { linear: 'linear', cubic: 'cubic', out: (e: unknown) => e },
  cancelAnimation: (...args: unknown[]) => mockCancel(...args),
  useAnimatedStyle: (fn: () => unknown) => fn(),
  withSequence: (...steps: unknown[]) => steps[steps.length - 1],
  useReducedMotion: () => mockReducedMotion,
  useSharedValue: (value: number) => ({ value }),
  withRepeat: (...args: unknown[]) => mockWithRepeat(...args),
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
  mockWithRepeat.mockClear();
});

describe('ProfileTierRing', () => {
  it('reserves the same layout with and without a tier, so the avatar never moves', () => {
    const outer = 90 + profileTierRingInset(90) * 2;
    for (const tier of ['gold', null] as const) {
      const { root } = mount(tier);
      const frame = byTestId(root, 'profile-tier-ring')[0]!;
      expect(frame.props.style).toEqual({ width: outer, height: outer });
      expect(root.findAll((n) => n.props.children === 'pfp').length).toBeGreaterThan(0);
      expect(byTestId(root, 'svg-root')).toHaveLength(tier ? 3 : 0);
    }
  });

  const blobsIn = (node: TestRenderer.ReactTestInstance) =>
    byTestId(node, 'svg-circle').filter((c) => String(c.props.fill).startsWith('url(#'));
  const bandCircle = (root: TestRenderer.ReactTestInstance) =>
    byTestId(root, 'svg-circle').find((c) => c.props.stroke && c.props.strokeWidth > 6)!;
  const centreOf = (root: TestRenderer.ReactTestInstance) =>
    byTestId(root, 'svg-root')[0]!.props.width / 2;

  it('uses GPU-rotated radial gradients with zero FeGaussianBlur filters under fixed lighting', () => {
    const { root } = mount('gold');
    // Zero SVG blur filters — CoreImage FeGaussianBlur pegs the iOS UI thread at 60fps.
    expect(byTestId(root, 'svg-filter')).toHaveLength(0);
    expect(byTestId(root, 'svg-blur')).toHaveLength(0);

    const [glow, film] = byTestId(root, 'svg-group');
    const glowBlobs = blobsIn(glow!);
    expect(glowBlobs.length).toBeGreaterThanOrEqual(4);
    const blobs = blobsIn(film!);
    expect(blobs).toHaveLength(glowBlobs.length);

    const clipId = /^url\(#(.*)\)$/.exec(film!.props.clipPath)![1];
    const clip = byTestId(root, 'svg-clip').find((c) => c.props.id === clipId)!;
    const annulus = byTestId(clip, 'svg-path')[0]!;
    expect(annulus.props.clipRule).toBe('evenodd');
    expect(annulus.props.d.match(/M /g)).toHaveLength(2);

    const ringRadius = bandCircle(root).props.r;
    const centre = centreOf(root);
    for (const blob of blobs) {
      expect(Math.hypot(blob.props.cx - centre, blob.props.cy - centre)).toBeCloseTo(ringRadius, 6);
      expect(blob.props.r).toBeGreaterThan(0);
    }

    // Bevel arcs, kisses and rim sit outside the rotating film layer.
    const bevels = byTestId(root, 'svg-path').filter((n) => n.props.strokeLinecap === 'round');
    expect(bevels).toHaveLength(2);
    expect(byTestId(film!, 'svg-path')).toHaveLength(0);

    // Engraved: the same word twice — an offset dark copy under a light face.
    const inscriptions = byTestId(root, 'svg-text-path');
    expect(inscriptions.map((n) => n.props.children)).toEqual(['GOLD', 'GOLD']);
    const [shadow, face] = byTestId(root, 'svg-text');
    expect(shadow!.props.dy).toBeLessThan(0);
    expect(face!.props.dy).toBeUndefined();
    expect(shadow!.props.fill).toMatch(/^hsla\(44,/);
    expect(face!.props.fill).toMatch(/^hsla\(44,/);
    expect(face!.props.alignmentBaseline).toBe('central');
    expect(byTestId(root, 'svg-root')[0]!.props.accessibilityLabel).toBe('GOLD tier');
  });

  it('bleeds the canvas past the layout box so the glow is never clipped, lettering lower-right', () => {
    const { root } = mount('gold');
    const outer = 90 + profileTierRingInset(90) * 2;
    const canvas = byTestId(root, 'svg-root')[0]!.props.style;
    expect(canvas.left).toBeLessThan(0);
    expect(canvas.top).toBe(canvas.left);
    expect(canvas.width).toBe(outer - 2 * canvas.left);

    const labelPath = byTestId(root, 'svg-path').find((p) =>
      String(p.props.id).endsWith('label-path')
    )!;
    const [, mx, my, , , , , , , ex, ey] = labelPath.props.d.split(' ').map(Number);
    const c = canvas.width / 2;
    expect(my).toBeGreaterThan(c);
    expect(mx).toBeLessThan(c);
    expect(ex).toBeGreaterThan(c);
    expect(ey).toBeLessThan(c);
  });

  it('rotates the film layer continuously and holds still under reduced motion', () => {
    const { root } = mount('new');
    const spinLayer = byTestId(root, 'animated-view')[1]!;
    expect(spinLayer.props.style[1]).toEqual({ transform: [{ rotate: '0deg' }] });
    expect(mockWithRepeat).toHaveBeenCalledTimes(1);

    mockWithRepeat.mockClear();
    mockReducedMotion = true;
    mount('new');
    expect(mockWithRepeat).not.toHaveBeenCalled();
  });
});
