/**
 * @jest-environment node
 */

import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ProfileTierRing, profileTierRingInset } from '@/shared/ui/composed/ProfileTierRing';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-svg', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactActual.createElement(View, { testID: `svg-${name}`, ...props }, children);
  return {
    __esModule: true,
    default: host('root'),
    Circle: host('circle'),
    Defs: host('defs'),
    LinearGradient: host('linear-gradient'),
    Path: host('path'),
    Stop: host('stop'),
    Text: host('text'),
    TextPath: host('text-path'),
  };
});

function mount(tier: 'gold' | 'new' | null) {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <ProfileTierRing tier={tier} seed="a" size={90} background="black">
        <Text>pfp</Text>
      </ProfileTierRing>
    );
  });
  return renderer.root;
}

const byTestId = (root: TestRenderer.ReactTestInstance, testID: string) =>
  root.findAll((node) => node.props.testID === testID && typeof node.type !== 'string');

describe('ProfileTierRing', () => {
  it('reserves the same layout with and without a tier, so the avatar never moves', () => {
    const outer = 90 + profileTierRingInset(90) * 2;
    for (const tier of ['gold', null] as const) {
      const root = mount(tier);
      const frame = byTestId(root, 'profile-tier-ring')[0]!;
      expect(frame.props.style).toEqual({ width: outer, height: outer });
      expect(root.findAll((n) => n.props.children === 'pfp').length).toBeGreaterThan(0);
      expect(byTestId(root, 'svg-root')).toHaveLength(tier ? 1 : 0);
    }
  });

  it('letters the tier name along the rim and names it for assistive tech', () => {
    const root = mount('new');
    expect(byTestId(root, 'svg-text-path')[0]!.props.children).toBe('NEW');
    expect(byTestId(root, 'svg-root')[0]!.props.accessibilityLabel).toBe('NEW tier');
    // Halo plus the gradient ring: two circles on the same radius.
    const circles = byTestId(root, 'svg-circle');
    expect(circles).toHaveLength(2);
    expect(circles[0]!.props.r).toBe(circles[1]!.props.r);
    expect(circles[1]!.props.stroke).toMatch(/^url\(#/);
  });
});
