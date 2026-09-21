import { useEffect } from 'react';

import { registerKeyDerivation } from '@/shared/lib/profile/profileSessionOrchestrator';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

/** Registers key derivation function with the orchestrator so createAndSwitchProfile can derive keys. */
export function useRegisterKeyDerivation(): void {
  const { getKeysForAccount } = useNostrKeysContext();

  useEffect(() => {
    registerKeyDerivation(getKeysForAccount);
  }, [getKeysForAccount]);
}
