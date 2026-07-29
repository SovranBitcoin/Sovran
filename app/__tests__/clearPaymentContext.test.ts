/**
 * clearPaymentContext must reset the runtime stores that route an ecash Send, so
 * an abandoned Routstr top-up (or a leftover Nut-Drop session) can never hijack
 * the next flow. Regression guard for the "Top up → Send pays Routstr" bug.
 */
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useAmountDraftStore } from '@/shared/stores/runtime/amountDraftStore';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { peekPendingZap, registerPendingZap } from '@/shared/stores/runtime/pendingZapStore';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';

describe('clearPaymentContext', () => {
  it('clears Routstr top-up and Nut-Drop context', () => {
    useRoutstrTopUpStore.getState().start('pending retry message');
    useNearPaySessionStore.getState().start({
      peerID: 'peer-1',
      nickname: 'bob',
      hasDirectLink: true,
      lastSeen: 0,
      creq: 'creqA-confirmed',
      delivery: { locked: true },
    });

    expect(useRoutstrTopUpStore.getState().active).toBe(true);
    expect(useNearPaySessionStore.getState().active).not.toBeNull();

    clearPaymentContext('test');

    expect(useRoutstrTopUpStore.getState().active).toBe(false);
    expect(useRoutstrTopUpStore.getState().pendingMessage).toBeNull();
    expect(useNearPaySessionStore.getState().active).toBeNull();
  });

  it('clears the remote-contact ecash-DM target', () => {
    // A leftover contact target must never re-DM a later ordinary send's token.
    useContactSendStore.getState().start({ pubkey: 'a'.repeat(64), displayName: 'Alice' });
    expect(useContactSendStore.getState().active).not.toBeNull();

    clearPaymentContext('test');

    expect(useContactSendStore.getState().active).toBeNull();
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
