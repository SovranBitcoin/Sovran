/**
 * clearPaymentContext must reset the runtime stores that route an ecash Send, so
 * an abandoned Routstr top-up (or a leftover Nut-Drop session) can never hijack
 * the next flow. Regression guard for the "Top up → Send pays Routstr" bug.
 */
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';
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
      p2pkPubkeyHex: `02${'ab'.repeat(32)}`,
    });

    expect(useRoutstrTopUpStore.getState().active).toBe(true);
    expect(useNearPaySessionStore.getState().active).not.toBeNull();

    clearPaymentContext('test');

    expect(useRoutstrTopUpStore.getState().active).toBe(false);
    expect(useRoutstrTopUpStore.getState().pendingMessage).toBeNull();
    expect(useNearPaySessionStore.getState().active).toBeNull();
  });
});
