import { useBalanceContext } from '@cashu/coco-react';

import { selectPayingMint, spendableMintBalances } from '@/shared/lib/routstr/payingMint';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

export function useRoutstrFunds() {
  const { balances } = useBalanceContext();
  const selectedMint = useMintStore((s) => s.selectedMint);
  const node = useRoutstrStore((s) => s.userNodeBaseUrl);
  const acceptedMints = useRoutstrStore((s) => (node ? s.knownProviders[node]?.mints : undefined));
  return selectPayingMint({
    selectedMint,
    acceptedMints: acceptedMints ?? null,
    balances: spendableMintBalances(balances.byMint),
  });
}
