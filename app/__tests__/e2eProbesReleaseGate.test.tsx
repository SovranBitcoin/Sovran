/** @jest-environment node */
import TestRenderer, { act } from 'react-test-renderer';

import { E2EAccessibilityProbe, E2E_PROBES_ENABLED } from '@/shared/lib/e2e/E2EAccessibilityProbe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A store build: neither __DEV__ nor EXPO_PUBLIC_E2E_LOGS=1.
jest.mock('@/shared/lib/loggerCore', () => ({
  ...jest.requireActual('@/shared/lib/loggerCore'),
  SHOW_LOGS: false,
}));

it('mounts no e2e probe in a store build', () => {
  expect(E2E_PROBES_ENABLED).toBe(false);
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      <E2EAccessibilityProbe testID="wallet-probe" accessibilityLabel="probe" />
    );
  });
  expect(renderer.toJSON()).toBeNull();
});
