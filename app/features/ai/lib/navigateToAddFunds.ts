import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { useMintStore } from '@/shared/stores/profile/mintStore';

/**
 * Where "not enough AI credit" sends the user.
 *
 * Funding is the wallet's job: there is no Routstr account to top up, so this
 * goes to the wallet's own receive flow rather than the send flow that used to
 * mint a deposit token for a node.
 *
 * Extracted from `useAiSend` because the error pill offers the same "Top up"
 * from inside the conversation, and two copies of this route would be two
 * places to update when the receive flow's params change.
 */
export function navigateToAddFunds(): void {
  router.navigate({
    pathname: '/(receive-flow)/amount',
    params: {
      amountEntry: JSON.stringify({
        destination: 'mintQuote',
        unit: 'sat',
        selectedMintUrl: useMintStore.getState().selectedMint ?? '',
      }),
    },
  });
}
