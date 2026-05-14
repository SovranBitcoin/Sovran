import { useProfileStore } from '@/shared/stores/global/profileStore';

/**
 * Stable scope identifier for native BitChat state that must follow the active
 * Sovran profile. We use the profile pubkey rather than accountIndex so
 * imported profiles and any future index reshuffle keep their own storage.
 */
export function getBitchatProfileScope(): string {
  const state = useProfileStore.getState();
  return (
    state.profiles.find((profile) => profile.accountIndex === state.activeAccountIndex)?.pubkey ??
    ''
  );
}

export function useBitchatProfileScope(): string {
  return useProfileStore(
    (state) =>
      state.profiles.find((profile) => profile.accountIndex === state.activeAccountIndex)?.pubkey ??
      ''
  );
}
