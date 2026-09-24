import { useCallback } from 'react';

import Icon from 'assets/icons';
import { useBalanceContext } from '@cashu/coco-react';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { getMockMintBalance } from '@/shared/stores/runtime/mockDataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { openProviderPicker } from '../lib/providerPicker';
import BalancePill from '@/shared/ui/composed/BalancePill';

/**
 * AI tab header — same `<BalancePill />` chrome the wallet tab uses for its
 * mint selector, and now the same NUMBER: the balance of the mint AI requests
 * are paid from.
 *
 * It used to read `routstrStore.balance`, a figure held on one Routstr node.
 * That number could not be trusted the moment the node changed — the header
 * kept showing 250 sats against a node that had never seen them — and the sats
 * behind it were stranded. Requests are now paid per call out of the wallet,
 * so the wallet's own balance is the only balance there is, and it cannot go
 * stale.
 *
 * Tapping opens the provider picker, which is what the wallet pill's twin does
 * with mints. It used to start a top-up — an operation that only existed
 * because the balance lived on a node.
 */
export function AiHeaderTitle() {
  const accent = useThemeColor('accent');

  const { balances: liveBalances } = useBalanceContext();
  const mintUrl = useMintStore((s) => s.selectedMint);
  const mockMode = useSettingsStore((s) => s.mockMode);

  const onPress = useCallback(() => {
    void openProviderPicker();
  }, []);

  // Read exactly as the wallet header reads it (`useMintSelector`), so the two
  // pills cannot disagree about the same pot.
  const sats = mintUrl
    ? mockMode
      ? getMockMintBalance(mintUrl, 'sat')
      : amountToNumber(liveBalances.byMint[mintUrl]?.total)
    : 0;

  // No skeleton: this is local wallet state, not a request in flight. Empty
  // means the wallet is empty, and the CTA now points at funding the wallet
  // rather than topping up an account on somebody's node.
  const isEmpty = sats <= 0;

  return (
    <BalancePill
      title="Balance"
      balance={sats}
      unit="sat"
      ctaLabel={isEmpty ? 'Add funds' : undefined}
      iconNode={<Icon name="fluent:wallet-20-filled" size={20} color={accent} />}
      loadingTitlePlaceholder="Balance"
      onPress={onPress}
    />
  );
}
