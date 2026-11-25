/**
 * @jest-environment node
 *
 * An idle `SkeletonLoadingShimmer` keeps an absolute-fill host over its
 * region (for layout telemetry); it must let taps through to what is under it,
 * since `<SkeletonLoadingShimmer active={isLoading} />` now sits over the
 * profile header's buttons.
 */

import React from 'react';
import { View } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/hooks/useThemeColor', () => ({ useThemeColor: () => 'surface' }));
jest.mock('@/shared/lib/color', () => ({ withAlpha: (color: string) => color }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));

it('lets taps through while idle', () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<SkeletonLoadingShimmer active={false} />);
  });
  const hosts = renderer.root.findAll((n) => n.type === View);
  expect(hosts.length).toBeGreaterThan(0);
  expect(hosts[0].props.pointerEvents).toBe('none');
});
