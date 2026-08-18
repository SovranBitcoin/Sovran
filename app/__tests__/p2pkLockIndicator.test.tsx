/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { hasP2PKLock, P2PKLockIndicator } from '@/features/send/components/P2PKLockIndicator';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/shared/lib/color', () => ({
  ...jest.requireActual('@/shared/lib/color'),
  withAlpha: (color: string) => color,
}));
jest.mock('@/shared/hooks/useThemeColor', () => ({
  useThemeColor: (tokens: string | string[]) =>
    Array.isArray(tokens) ? tokens.map(() => 'white') : 'white',
}));
jest.mock('@/shared/ui/primitives/View/HStack', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    HStack: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
      ReactActual.createElement('MockHStack', props, children),
  };
});
jest.mock('@/shared/ui/primitives/Text', () => ({
  Text: ({ children }: React.PropsWithChildren) => <text>{children}</text>,
}));
jest.mock('assets/icons', () => ({ __esModule: true, default: () => null }));

describe('P2PK lock indicator', () => {
  it('detects amount and decorated send-token lock state', () => {
    expect(hasP2PKLock({ p2pkLockPubkey: '02-public-key' })).toBe(true);
    expect(hasP2PKLock({ p2pkPubkey: { truncate: jest.fn() } })).toBe(true);
    expect(hasP2PKLock({ metadata: { p2pkLockPubkey: '02-decorated-public-key' } })).toBe(true);
    expect(hasP2PKLock({})).toBe(false);
  });

  it('exposes only lock presence through the stable selector', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<P2PKLockIndicator />);
    });

    const indicator = renderer!.root.findByProps({ testID: 'p2pk-lock-indicator' });
    expect(indicator.props.accessibilityLabel).toBe('P2PK lock enabled');
    expect(indicator.props.accessibilityValue).toBeUndefined();
    expect(Object.keys(indicator.props)).not.toContain('p2pkLockPubkey');
  });
});
