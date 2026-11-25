/**
 * @jest-environment node
 *
 * A skeleton pulses unless it is drawn `static`, for a frame held still.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { Skeleton } from '@/shared/ui/primitives/Skeleton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-web/dist/exports/View', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) =>
    jest.requireActual<typeof import('react')>('react').createElement('RNView', props),
}));
jest.mock('@/shared/lib/contentShiftLog', () => ({
  useVisualLayoutLogger: () => ({}),
  visualLayoutScopePart: (key: string) => key,
}));
jest.mock('@/shared/lib/e2e/isAndroidE2E', () => ({ IS_ANDROID_E2E: false }));

function classOf(element: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(element);
  });
  const className = r.root.findByType('RNView' as never).props.className as string;
  act(() => r.unmount());
  return className;
}

it('pulses by default and holds still when static', () => {
  expect(classOf(<Skeleton />)).toContain('animate-pulse');
  expect(classOf(<Skeleton static />)).not.toContain('animate-pulse');
});
