/**
 * @jest-environment node
 */

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import MintSelector from '@/features/wallet/components/MintSelector/MintSelector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('@/features/wallet/components/MintSelector/useMintSelector', () => ({
  useMintSelector: jest.fn(() => ({
    mintName: 'Sovran Mint',
    balance: 100,
    unit: 'sat',
    isLoading: false,
    mintIconUrl: undefined,
    onRequestMintList: jest.fn(),
    dimensions: { buttonWidth: 240 },
  })),
}));
jest.mock(
  '@/shared/ui/composed/BalancePill',
  () => {
    const ReactActual = jest.requireActual<typeof import('react')>('react');
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) =>
        ReactActual.createElement('MockBalancePill', props),
    };
  },
  { virtual: true }
);
jest.mock('@/shared/ui/composed/MintIcon', () => ({ MintIcon: () => null }));
jest.mock('@/shared/lib/logger', () => ({
  Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

describe('MintSelector test seam', () => {
  it('forwards its testID to the interactive BalancePill', async () => {
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<MintSelector testID="amount-mint-selector" />);
    });

    const pill = renderer!.root.find((node) => (node.type as unknown) === 'MockBalancePill');
    expect(pill.props.testID).toBe('amount-mint-selector');
  });
});
