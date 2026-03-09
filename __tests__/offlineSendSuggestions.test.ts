import {
  buildExactOfflineAmountIndex,
  getOfflineFiatSendSuggestions,
  getRoundedFiatMinorUnitForSats,
  getOfflineSendSuggestions,
  getSatRangeForDisplayedFiatMinorUnit,
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

  it('derives a stable sat window for a displayed fiat amount', () => {
    expect(getSatRangeForDisplayedFiatMinorUnit(1001, 100_000)).toEqual({
      minSat: 10005,
      maxSat: 10014,
    });
    expect(getRoundedFiatMinorUnitForSats(10014, 100_000)).toBe(1001);
    expect(getRoundedFiatMinorUnitForSats(10015, 100_000)).toBe(1002);
  });

  it('auto-selects the nearest offline-sendable amount that preserves the entered fiat display', async () => {
    const proofService = createProofService([10009], [10009, 3000]);

    const result = await getOfflineFiatSendSuggestions(
      proofService,
      'mint-a',
      10012,
      1001,
      100_000
    );

    expect(result).toEqual({
      autoSelectAmount: 10009,
      requestedDisplayMinorUnit: 1001,
      roundDownOption: null,
      roundUpOption: null,
      totalReadyBalance: 13009,
    });
  });

  it('returns adjacent fiat suggestions when no exact amount exists in the same displayed fiat window', async () => {
    const proofService = createProofService([10000, 10020], [10000, 10020]);

    const result = await getOfflineFiatSendSuggestions(
      proofService,
      'mint-a',
      10012,
      1001,
      100_000
    );

    expect(result).toEqual({
      autoSelectAmount: null,
      requestedDisplayMinorUnit: 1001,
      roundDownOption: {
        amount: 10000,
        displayMinorUnit: 1000,
      },
      roundUpOption: {
        amount: 10020,
        displayMinorUnit: 1002,
      },
      totalReadyBalance: 20020,
    });
  });
});
