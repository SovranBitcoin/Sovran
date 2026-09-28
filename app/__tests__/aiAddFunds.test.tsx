/** @jest-environment node */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createPaymentMachine } from 'wallet';
import { useNavigateToAddFunds } from '@/features/ai/lib/navigateToAddFunds';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';

let mockUnit = 'usd';
const mockMachine = createPaymentMachine({
  handlers: {},
  getContext: () => ({ trustedMintUrls: [], mintBalances: {}, proofAmounts: {} }),
  getUnit: () => mockUnit,
});
jest.mock('wallet/react', () => ({ useColadaContext: () => ({ machine: mockMachine }) }));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: {
    getState: () => ({
      setActiveUnit: (unit: string) => {
        mockUnit = unit;
      },
    }),
  },
}));
jest.mock('@/shared/stores/runtime/clearPaymentContext', () => ({
  clearPaymentContext: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({ aiLog: { error: jest.fn() } }));

function FundingButton() {
  const onPress = useNavigateToAddFunds();
  return React.createElement('button', { onClick: onPress });
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test('AI funding replaces an old send with the wallet Fixed Amount receive in sats', async () => {
  mockUnit = 'usd';
  await mockMachine.startSendEcash({ reset: true, recipientPubkey: 'old-recipient' });
  expect(mockMachine.getContext().recipientPubkey).toBe('old-recipient');
  expect(mockMachine.getContext().destination).toBe('sendEcash');
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<FundingButton />);
  });
  try {
    await act(async () => {
      renderer.root.findByType('button').props.onClick();
    });
    expect(clearPaymentContext).toHaveBeenCalledWith('ai.receive');
    expect(mockUnit).toBe('sat');
    expect(mockMachine.getStep()).toBe('enterAmount');
    expect(mockMachine.getContext()).toMatchObject({
      unit: 'sat',
      destination: 'mintQuote',
      mintQuoteMethod: 'bolt11',
    });
    expect(mockMachine.getContext().recipientPubkey).toBeUndefined();
    expect(mockMachine.getContext().p2pkLock).toBeUndefined();
  } finally {
    await act(async () => renderer.unmount());
    mockMachine.reset();
  }
});
