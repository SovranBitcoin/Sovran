/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { NotFoundScreen } from '@/shared/blocks/NotFoundScreen';

// react-test-renderer needs this flag to support act() under the node env.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockWarn = jest.fn();
const mockReplace = jest.fn();
const pathnameRef = { current: '/does/not/exist' };

jest.mock('expo-router', () => ({
  usePathname: () => pathnameRef.current,
}));

jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { replace: (...a: unknown[]) => mockReplace(...a) },
}));

jest.mock('@/shared/lib/logger', () => ({
  log: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: (...a: unknown[]) => mockWarn(...a),
    error: jest.fn(),
  },
}));

jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: () => ['surface', 'foreground', 'muted'],
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

// Presentational primitives are mocked to trivial passthroughs so the test
// isolates behaviour (logging + recovery action) from native rendering.
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/shared/ui/primitives/Button', () => ({
  Button: (props: { testID?: string; onPress: () => void }) => {
    void props;
    return null;
  },
}));
jest.mock('@/shared/ui/primitives/Text', () => ({ Text: () => null }));
jest.mock('@/shared/ui/primitives/View/View', () => ({
  View: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));
jest.mock('@/shared/ui/primitives/View/VStack', () => ({
  VStack: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

describe('NotFoundScreen', () => {
  beforeEach(() => {
    mockWarn.mockReset();
    mockReplace.mockReset();
    pathnameRef.current = '/does/not/exist';
  });

  it('logs the unresolved path once on mount', () => {
    act(() => {
      TestRenderer.create(<NotFoundScreen />);
    });
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith('nav.unknown_route', { path: '/does/not/exist' });
  });

  it('replaces to the wallet route when the recovery button is pressed', () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(<NotFoundScreen />);
    });
    const button = renderer.root.findByProps({ testID: 'not-found-go-wallet' });
    act(() => {
      (button.props as { onPress: () => void }).onPress();
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/(drawer)/(tabs)/index');
  });
});
