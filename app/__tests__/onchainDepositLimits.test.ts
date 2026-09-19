import type { MintMethodUnitCapability } from 'wallet';

import { getOnchainDepositLimitsNotice } from '@/features/receive/lib/onchainDepositLimits';

describe('getOnchainDepositLimitsNotice', () => {
  const capability: MintMethodUnitCapability = {
    supported: true,
    disabled: false,
    method: 'onchain',
    unit: 'sat',
    minAmount: 10_000,
    maxAmount: 5_000_000,
  };

  it('states the bounds on an amountless QR', () => {
    expect(getOnchainDepositLimitsNotice(capability, null, 'sat')).toEqual({
      outOfRange: null,
      title: 'Onchain deposit limits',
      description:
        "Send between 10,000 and 5,000,000 sats. Deposits outside this range won't be credited and could be lost.",
    });
  });

  it('still states the bounds when the requested amount fits them', () => {
    expect(getOnchainDepositLimitsNotice(capability, 10_000, 'sat')?.outOfRange).toBeNull();
    expect(getOnchainDepositLimitsNotice(capability, 5_000_000, 'sat')?.outOfRange).toBeNull();
  });

  it('names the broken bound when the requested amount is outside them', () => {
    expect(getOnchainDepositLimitsNotice(capability, 1_000, 'sat')).toEqual({
      outOfRange: 'min',
      title: 'Amount below mint minimum',
      description:
        "This mint only credits onchain deposits of at least 10,000 sats. A smaller deposit won't be credited and could be lost.",
    });
    expect(getOnchainDepositLimitsNotice(capability, 6_000_000, 'sat')?.title).toBe(
      'Amount above mint maximum'
    );
  });

  it('stays quiet when the QR receives in a unit the capability was not derived for', () => {
    expect(getOnchainDepositLimitsNotice(capability, null, 'usd')).toBeNull();
  });

  it('words a one-sided bound, and stays quiet with no bounds or no onchain support', () => {
    expect(
      getOnchainDepositLimitsNotice({ ...capability, maxAmount: undefined }, null, 'sat')
        ?.description
    ).toBe("Send at least 10,000 sats. Smaller deposits won't be credited and could be lost.");
    expect(
      getOnchainDepositLimitsNotice(
        { ...capability, minAmount: undefined, maxAmount: undefined },
        null,
        'sat'
      )
    ).toBeNull();
    expect(
      getOnchainDepositLimitsNotice({ ...capability, supported: false }, null, 'sat')
    ).toBeNull();
    expect(getOnchainDepositLimitsNotice(null, null, 'sat')).toBeNull();
  });
});
