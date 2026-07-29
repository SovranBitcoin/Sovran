/**
 * Durable zapped record + settled optimistic count bump (`recordZapPaid`).
 * The highlight regression this guards: tinting off the optimistic overlay
 * alone made the bolt un-highlight the moment nagg's aggregated satsZapped
 * caught up (the overlay is deliberately cleared then), and fiat-unit melts
 * (sats unknown app-side) never highlighted at all.
 */
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

const EVENT_A = 'a'.repeat(64);

beforeEach(() => {
  useNostrSocialStore.setState({ optimisticZapsByEventId: {}, zappedByEventId: {} });
});

describe('recordZapPaid', () => {
  it('sets the durable record and a settled optimistic bump with expectedSats', () => {
    useNostrSocialStore.getState().recordZapPaid(EVENT_A, 21, 500);

    const { zappedByEventId, optimisticZapsByEventId } = useNostrSocialStore.getState();
    expect(zappedByEventId[EVENT_A]).toMatchObject({ totalSats: 21 });
    expect(optimisticZapsByEventId[EVENT_A]).toMatchObject({
      deltaSats: 21,
      pending: false,
      expectedSats: 521,
    });
  });

  it('accumulates across repeat zaps on the same post', () => {
    useNostrSocialStore.getState().recordZapPaid(EVENT_A, 21, 500);
    useNostrSocialStore.getState().recordZapPaid(EVENT_A, 1000, 500);

    const { zappedByEventId, optimisticZapsByEventId } = useNostrSocialStore.getState();
    expect(zappedByEventId[EVENT_A]).toMatchObject({ totalSats: 1021 });
    expect(optimisticZapsByEventId[EVENT_A]).toMatchObject({
      deltaSats: 1021,
      expectedSats: 1521,
    });
  });

  it('sats 0 (fiat-unit melt) records the highlight without an optimistic entry', () => {
    useNostrSocialStore.getState().recordZapPaid(EVENT_A, 0, 500);

    const { zappedByEventId, optimisticZapsByEventId } = useNostrSocialStore.getState();
    expect(zappedByEventId[EVENT_A]).toMatchObject({ totalSats: 0 });
    expect(optimisticZapsByEventId[EVENT_A]).toBeUndefined();
  });

  it('the durable record survives the optimistic settle-clear', () => {
    useNostrSocialStore.getState().recordZapPaid(EVENT_A, 21, 500);
    useNostrSocialStore.getState().clearZapOptimistic(EVENT_A);

    const { zappedByEventId, optimisticZapsByEventId } = useNostrSocialStore.getState();
    expect(optimisticZapsByEventId[EVENT_A]).toBeUndefined();
    expect(zappedByEventId[EVENT_A]).toMatchObject({ totalSats: 21 });
  });
});
