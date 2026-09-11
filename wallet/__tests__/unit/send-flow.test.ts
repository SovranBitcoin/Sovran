import { describe, expect, it } from 'vitest';

import { sendFlow, startSendFlow, startSendEcashFlow } from '../../src/machine/flows/send';
import { MINT1, WALLETS } from '../_harness/fixtures';
import { assertStep } from '../_harness/assertStep';

describe('send flow', () => {
  it('opens the destination chooser without selecting a mint or amount', () => {
    const result = startSendFlow('sat');

    expect(result.step).toBe('selectDestination');
    expect(result.context).toEqual({ unit: 'sat' });
    expect(result.data).toEqual({ unit: 'sat' });
    // No mint/amount/destination committed yet — the method pick drives that.
    expect(result.context.mintUrl).toBeUndefined();
    expect(result.context.destination).toBeUndefined();
  });

  it('starts ecash send at amount entry when a mint is selected', () => {
    const result = startSendEcashFlow(WALLETS.default, 'sat');

    assertStep(result, 'enterAmount');
    expect(result.context).toMatchObject({
      destination: 'sendEcash',
      mintUrl: MINT1,
      unit: 'sat',
    });
    expect(result.data.preselectedMintUrl).toBe(MINT1);
    expect(result.data.constraints.destination).toBe('sendEcash');
  });

  it('carries chat recipient context into amount entry', () => {
    const result = startSendEcashFlow(WALLETS.default, 'sat', {
      meltTarget: 'alice@example.com',
      recipientPubkey: 'abc123',
      recipientProfile: {
        displayName: 'Alice',
        avatarUrl: null,
        nip05: 'alice@example.com',
      },
    });

    // Also pins the step this flow lands on, which the assertion below was
    // silently assuming.
    assertStep(result, 'enterAmount');
    expect(result.context).toMatchObject({
      meltTarget: 'alice@example.com',
      recipientPubkey: 'abc123',
    });
    expect(result.data.constraints).toMatchObject({
      meltTarget: 'alice@example.com',
      recipientPubkey: 'abc123',
    });
  });

  it('routes to error when there is no spendable mint', () => {
    const result = startSendEcashFlow(WALLETS.noBalance, 'sat');

    expect(result.step).toBe('error');
    expect(result.data).toMatchObject({ code: 'NO_BALANCE' });
  });

  it('declares actions and copy keys for send states', () => {
    expect(sendFlow.actions({ type: 'select-mint', unit: 'sat' })).toEqual(['selectMint']);
    expect(sendFlow.copyKeys({ type: 'enter-amount', unit: 'sat', mintUrl: MINT1 })).toEqual([
      'timeline.flow.send',
    ]);
  });
});
