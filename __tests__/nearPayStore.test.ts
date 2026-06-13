/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => {
  const noop = jest.fn();
  return {
    storeLog: {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
    },
  };
});

import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';

const RECIPIENT = {
  peerID: 'peer-abc',
  nickname: 'Nearby Alice',
  hasDirectLink: true,
  lastSeen: 123,
  delivery: { locked: true } as const,
};

describe('near pay session store', () => {
  beforeEach(() => {
    useNearPaySessionStore.setState({ active: null });
  });

  it('sets the transient recipient session', () => {
    useNearPaySessionStore.getState().start(RECIPIENT);

    const active = useNearPaySessionStore.getState().active;
    expect(active?.recipient).toEqual(RECIPIENT);
    expect(active?.id).toContain(RECIPIENT.peerID);
    expect(typeof active?.startedAt).toBe('number');
    expect(active?.phase).toBe('picking');
    expect(active?.amountEntry).toBeNull();
  });

  it('stores the inline amount entry and moves into transition state', () => {
    useNearPaySessionStore.getState().start(RECIPIENT);
    useNearPaySessionStore.getState().setAmountEntry('{"destination":"sendEcash"}');

    const active = useNearPaySessionStore.getState().active;
    expect(active?.phase).toBe('transitioning');
    expect(active?.amountEntry).toBe('{"destination":"sendEcash"}');
  });

  it('marks the inline amount selector visible after the transition', () => {
    useNearPaySessionStore.getState().start(RECIPIENT);
    useNearPaySessionStore.getState().setAmountEntry('{"destination":"sendEcash"}');
    useNearPaySessionStore.getState().showAmount();

    expect(useNearPaySessionStore.getState().active?.phase).toBe('amount');
  });

  it('returns to the picker by clearing the active inline session', () => {
    useNearPaySessionStore.getState().start(RECIPIENT);
    useNearPaySessionStore.getState().setAmountEntry('{"destination":"sendEcash"}');
    useNearPaySessionStore.getState().resetToPicker();

    expect(useNearPaySessionStore.getState().active).toBeNull();
  });

  it('ignores amount entries when no session is active', () => {
    useNearPaySessionStore.getState().setAmountEntry('{"destination":"sendEcash"}');

    expect(useNearPaySessionStore.getState().active).toBeNull();
  });

  it('clears a cancelled picker or amount-flow session', () => {
    useNearPaySessionStore.getState().start(RECIPIENT);
    useNearPaySessionStore.getState().clear();

    expect(useNearPaySessionStore.getState().active).toBeNull();
  });

  it('clears stale recipient state after send completion', () => {
    useNearPaySessionStore.getState().start(RECIPIENT);
    useNearPaySessionStore.getState().complete();

    expect(useNearPaySessionStore.getState().active).toBeNull();
  });

  it('tracks radar visibility independently of the send session', () => {
    expect(useNearPaySessionStore.getState().radarVisible).toBe(false);

    useNearPaySessionStore.getState().setRadarVisible(true);
    expect(useNearPaySessionStore.getState().radarVisible).toBe(true);

    // Session lifecycle never touches the visibility flag — the gold toast
    // depends on "is the radar up", not "is a send in progress".
    useNearPaySessionStore.getState().start(RECIPIENT);
    useNearPaySessionStore.getState().clear();
    expect(useNearPaySessionStore.getState().radarVisible).toBe(true);

    useNearPaySessionStore.getState().setRadarVisible(false);
    expect(useNearPaySessionStore.getState().radarVisible).toBe(false);
  });
});
