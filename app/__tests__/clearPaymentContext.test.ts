/**
 * clearPaymentContext must reset the runtime stores that route an ecash Send, so
 * an abandoned Routstr top-up (or a leftover Nut-Drop session) can never hijack
 * the next flow. Regression guard for the "Top up → Send pays Routstr" bug.
 */
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
import { useContactSendStore } from '@/shared/stores/runtime/contactSendStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
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
});
