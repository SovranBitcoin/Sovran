import type { ReusableQuoteIdentityStore } from 'wallet';

import { useMintStore } from '@/shared/stores/profile/mintStore';

/** Keep the standing creq's QR sane — same cap as the BLE standing creq. */
export const MAX_ADVERTISED_MINTS = 5;

/**
 * The ONE persisted identity map pinning every standing receive singleton
 * (reusable bolt12/onchain quotes AND the standing payment request) to
 * mintStore.standingQuotes. Reads go through getState() so the store handle
 * always reflects the active profile; `subscribe` surfaces EXTERNAL
 * rotations (e.g. the global deposit listener retiring a paid address).
 */
export const standingQuoteIdentityStore: ReusableQuoteIdentityStore = {
  get: (key) => useMintStore.getState().standingQuotes[key],
  set: (key, quoteId) => useMintStore.getState().setStandingQuote(key, quoteId),
  subscribe: (key, callback) =>
    useMintStore.subscribe((state, prev) => {
      if (state.standingQuotes[key] !== prev.standingQuotes[key]) callback();
    }),
};
