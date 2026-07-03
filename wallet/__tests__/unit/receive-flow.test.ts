import { describe, expect, it } from 'vitest';

import {
  receiveFlow,
  startReceiveFlow,
  startReceiveLightningFlow,
  startReceiveQrFlow,
} from '../../src/machine/flows/receive';
import { MINT1, WALLETS } from '../_harness/fixtures';

describe('receive flow', () => {
  it('starts Lightning receive at amount entry with the preferred mint', () => {
    const result = startReceiveLightningFlow(WALLETS.default, 'sat');

    expect(result.step).toBe('enterAmount');
    expect(result.context).toMatchObject({
      destination: 'mintQuote',
      mintQuoteMethod: 'bolt11',
      mintUrl: MINT1,
      unit: 'sat',
    });
    expect(result.data.constraints.destination).toBe('mintQuote');
    expect(result.data.preselectedMintUrl).toBe(MINT1);
  });

  it('starts the receive hub without selecting a payment method', () => {
    const result = startReceiveFlow(WALLETS.default, 'sat');

    expect(result.step).toBe('receiveHub');
    expect(result.context).toEqual({ unit: 'sat' });
    expect(result.data.methodContext).toBeTruthy();
  });

  it('opens the QR display with a clean context (no stale destination)', () => {
    const result = startReceiveQrFlow(WALLETS.default, 'sat');

    expect(result.step).toBe('navigateToReceive');
    expect(result.context).toEqual({ unit: 'sat' });
    expect(result.data.methodContext).toBeTruthy();
  });

  it('preserves the existing empty mint marker when no receive mint is available', () => {
    const result = startReceiveLightningFlow(WALLETS.noMints, 'sat');

    expect(result.context.mintUrl).toBe('');
    expect(result.data.preselectedMintUrl).toBeUndefined();
  });

  it('declares actions and copy keys for receive states', () => {
    expect(receiveFlow.actions({ type: 'receive-hub', unit: 'sat' })).toEqual(['showReceiveHub']);
    expect(
      receiveFlow.copyKeys({
        type: 'enter-lightning-amount',
        unit: 'sat',
        mintUrl: MINT1,
        method: 'bolt11',
      }),
    ).toEqual(['timeline.mint.unpaid.label', 'timeline.mint.unpaid.info']);
  });
});
