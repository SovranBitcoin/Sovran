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
// The pill's liveness dot reads the persisted mint metadata store; this suite
// is about the testID seam and does not stand that store up.
jest.mock('@/features/mint/hooks/useMintLiveness', () => ({ useMintLiveness: () => 'unknown' }));
jest.mock('@/shared/ui/primitives/PresenceDot', () => ({ PresenceDot: () => null }));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    Log: ({ children }: React.PropsWithChildren) => <>{children}</>,
    // The View primitive reaches a persisted store whose rehydrate hook logs.
    storeLog: sink,
    cashuLog: sink,
    log: { ...sink, child: () => sink },
    redactError: (error: unknown) => error,
  };
});

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
