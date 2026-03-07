import {
  buildExactOfflineAmountIndex,
  getOfflineSendSuggestions,
} from '@/features/send/lib/offlineSendSuggestions';

function createProofService(exactAmounts: number[], readyProofAmounts: number[]) {
  const exactAmountSet = new Set(exactAmounts);

  return {
    async getReadyProofs() {
      return readyProofAmounts.map((amount) => ({ amount }));
    },
    async selectProofsToSend(_mintUrl: string, amount: number) {
      return exactAmountSet.has(amount) ? [{ amount }] : [{ amount: amount + 1 }];
    },
  };
}

describe('offline send suggestions', () => {
  it('builds a reusable exact-send index from available proofs', () => {
    const result = buildExactOfflineAmountIndex([2, 4, 8]);

    expect(result.totalReadyBalance).toBe(14);
    expect(result.reachableSums).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it('recognizes when the requested amount is already sendable offline', async () => {
    const proofService = createProofService([6, 8, 10, 12, 14], [2, 4, 8]);

    const result = await getOfflineSendSuggestions(proofService, 'mint-a', 6);

    expect(result).toEqual({
      isRequestedAmountSendableOffline: true,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance: 14,
    });
  });

  it('finds both round-down and round-up options around a swap-required amount', async () => {
    const proofService = createProofService([6, 8, 10, 12, 14], [2, 4, 8]);

    const result = await getOfflineSendSuggestions(proofService, 'mint-a', 7);

    expect(result).toEqual({
      isRequestedAmountSendableOffline: false,
      roundDownAmount: 6,
      roundUpAmount: 8,
      totalReadyBalance: 14,
    });
  });

  it('returns only a lower option when the requested amount is above every exact sendable amount', async () => {
    const proofService = createProofService([6, 8, 10, 12, 14], [2, 4, 8]);

    const result = await getOfflineSendSuggestions(proofService, 'mint-a', 15);

    expect(result).toEqual({
      isRequestedAmountSendableOffline: false,
      roundDownAmount: 14,
      roundUpAmount: null,
      totalReadyBalance: 14,
    });
  });

  it('returns only a higher option when the requested amount is below every exact sendable amount', async () => {
    const proofService = createProofService([4, 8, 12], [4, 8]);

    const result = await getOfflineSendSuggestions(proofService, 'mint-a', 1);

    expect(result).toEqual({
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: 4,
      totalReadyBalance: 12,
    });
  });

  it('returns no suggestions when no exact offline amount can be validated', async () => {
    const proofService = createProofService([], [2, 4, 8]);

    const result = await getOfflineSendSuggestions(proofService, 'mint-a', 7);

    expect(result).toEqual({
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance: 14,
    });
  });
});
