/**
 * clearPaymentContext must reset the runtime stores that route an ecash Send, so
 * a leftover Nut Drop session or contact target can never hijack the next flow.
 */
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useAmountDraftStore } from '@/shared/stores/runtime/amountDraftStore';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { peekPendingZap, registerPendingZap } from '@/shared/stores/runtime/pendingZapStore';
import { useSendLockStore } from '@/shared/stores/runtime/sendLockStore';

describe('clearPaymentContext', () => {
  it('clears Nut-Drop context', () => {
    useNearPaySessionStore.getState().start({
      peerID: 'peer-1',
      nickname: 'bob',
      hasDirectLink: true,
      lastSeen: 0,
      creq: 'creqA-confirmed',
    });

    expect(useNearPaySessionStore.getState().active).not.toBeNull();

    clearPaymentContext('test');

    expect(useNearPaySessionStore.getState().active).toBeNull();
  });

  it('clears the remote-contact ecash-DM target', () => {
    // A leftover contact target must never re-DM a later ordinary send's token.
    useContactSendStore
      .getState()
      .start({ pubkey: 'a'.repeat(64), displayName: 'Alice', delivery: 'nip17' });
    expect(useContactSendStore.getState().active).not.toBeNull();

    clearPaymentContext('test');

    expect(useContactSendStore.getState().active).toBeNull();
  });

  it('clears a lock chosen for an abandoned send', () => {
    // The amount screen's plain Next sends on the kept choice, so one left
    // behind would lock the next payment to the same person unasked.
    useSendLockStore.getState().set({
      lockKey: `02${'ab'.repeat(32)}`,
      recipientPubkey: 'a'.repeat(64),
      durationId: '7d',
      confirmed: true,
    });

    clearPaymentContext('test');

    expect(useSendLockStore.getState().draft).toBeNull();
  });

  it('clears a pending zap left by an abandoned zap flow', () => {
    // A stale zap context must never attach its 9734 to a later unrelated
    // payment that happens to target the same lightning address.
    registerPendingZap({
      meltTarget: 'alice@example.com',
      eventId: 'e'.repeat(64),
      eventKind: 1,
      authorPubkey: 'f'.repeat(64),
      contentPreview: 'gm',
      emoji: '👍',
      comment: 'Great post 👍',
      presetSats: 21,
      createdAt: Date.now(),
    });
    expect(peekPendingZap('alice@example.com')).toBeDefined();

    clearPaymentContext('test');

    expect(peekPendingZap('alice@example.com')).toBeUndefined();
  });

  it('clears an amount draft left by an abandoned mint-selector round trip', () => {
    useAmountDraftStore.getState().stash({
      rawInput: '42',
      inputMode: 'unit',
      scope: 'sendEcash',
      unit: 'sat',
    });
    expect(useAmountDraftStore.getState().pending).not.toBeNull();

    clearPaymentContext('test');

    expect(useAmountDraftStore.getState().pending).toBeNull();
  });
});
