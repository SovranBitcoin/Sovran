/* eslint-disable import/first */

jest.mock('@/shared/lib/popup/popups/actionMenu', () => ({
  actionMenuPopup: jest.fn(),
}));

import { nearPaySendPlan, planDelivery } from '@/features/nearPay/lib/startNearPaySend';

const LOCK_KEY = `02${'ab'.repeat(32)}`;

describe('nearPaySendPlan', () => {
  it('locks to the announced key for capability peers', () => {
    expect(nearPaySendPlan({ supportsP2pkEcash: true, p2pkPubkeyHex: LOCK_KEY })).toEqual({
      mode: 'p2pk',
      p2pkLockPubkey: LOCK_KEY,
      recipientPubkey: 'ab'.repeat(32),
    });
  });

  it('falls back to bearer for vanilla peers', () => {
    expect(nearPaySendPlan({ supportsP2pkEcash: false })).toEqual({ mode: 'bearer' });
    expect(nearPaySendPlan({ supportsP2pkEcash: false, p2pkPubkeyHex: '' })).toEqual({
      mode: 'bearer',
    });
  });

  it('never synthesizes a lock from a half-claimed capability', () => {
    // Capability flag without a key (or vice versa) must not produce a lock
    // the recipient cannot redeem.
    expect(nearPaySendPlan({ supportsP2pkEcash: true, p2pkPubkeyHex: undefined })).toEqual({
      mode: 'bearer',
    });
    expect(nearPaySendPlan({ supportsP2pkEcash: true, p2pkPubkeyHex: '' })).toEqual({
      mode: 'bearer',
    });
    expect(nearPaySendPlan({ supportsP2pkEcash: false, p2pkPubkeyHex: LOCK_KEY })).toEqual({
      mode: 'bearer',
    });
  });
});

describe('planDelivery', () => {
  it('maps plans onto the session delivery descriptor', () => {
    expect(
      planDelivery({ mode: 'p2pk', p2pkLockPubkey: LOCK_KEY, recipientPubkey: 'ab'.repeat(32) })
    ).toEqual({ mode: 'p2pk', p2pkPubkeyHex: LOCK_KEY });
    expect(planDelivery({ mode: 'bearer' })).toEqual({ mode: 'bearer' });
  });
});
