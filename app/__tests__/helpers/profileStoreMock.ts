/**
 * The active-account readers `profileStore` exports, over a suite's stand-in
 * for the store's state. A suite that replaces the store module spreads these
 * into its mock so the code under test reads the stand-in's active account.
 * The readers themselves are pinned against the real store in
 * `activeAccountCapture.test.ts` and `profileStoreActiveSelector.test.ts`.
 */
interface ProfileStateLike {
  profiles?: readonly { accountIndex: number; pubkey?: string }[];
  activeAccountIndex?: number;
  getActiveProfile?: () => { pubkey?: string } | null | undefined;
}

export function activeAccountReaders(
  getState: () => ProfileStateLike,
  subscribe?: (listener: (state: ProfileStateLike) => void) => () => void
) {
  const selectActiveProfile = (state: ProfileStateLike) =>
    state.getActiveProfile
      ? (state.getActiveProfile() ?? undefined)
      : state.profiles?.find((p) => p.accountIndex === state.activeAccountIndex);
  const selectActivePubkey = (state: ProfileStateLike) => selectActiveProfile(state)?.pubkey;
  return {
    selectActiveProfile,
    selectActivePubkey,
    activePubkey: () => selectActivePubkey(getState()),
    // The same rule as the real capture: any switch counts, even one back.
    captureActiveProfile: (pubkey: string) => {
      const initial = getState();
      let current = selectActivePubkey(initial) === pubkey;
      const dispose = subscribe!((state) => {
        if (
          state.activeAccountIndex !== initial.activeAccountIndex ||
          selectActivePubkey(state) !== pubkey
        )
          current = false;
      });
      return {
        check: () => {
          if (!current) throw new Error('Profile changed');
        },
        dispose,
      };
    },
  };
}
