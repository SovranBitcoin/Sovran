import { useEffect } from 'react';

import { useProfileStore } from '@/shared/stores/global/profileStore';

import { useAppBalance } from './useAppBalance';

/** Syncs the live balance to the profile store for the active profile. */
export function useProfileBalanceSync(): void {
  const balance = useAppBalance();
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  useEffect(() => {
    useProfileStore.getState().updateProfileBalance(activeAccountIndex, balance);
  }, [balance, activeAccountIndex]);
}
