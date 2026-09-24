import { useCallback } from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import Icon from 'assets/icons';
import { useBalanceContext } from '@cashu/coco-react';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { getMockMintBalance } from '@/shared/stores/runtime/mockDataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { staticPopup } from '@/shared/lib/popup';
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
 */
export function AiHeaderTitle() {
  const accent = useThemeColor('accent');

  const { balances: liveBalances } = useBalanceContext();
  const mintUrl = useMintStore((s) => s.selectedMint);
  const mockMode = useSettingsStore((s) => s.mockMode);
  const { keys: nostrKeys } = useNostrKeysContext();

  const onPress = useCallback(() => {
    if (!nostrKeys?.pubkey) {
      staticPopup('no-wallet-available');
      return;
    }
    useRoutstrTopUpStore.getState().start(null);
    const preferredMint = useMintStore.getState().selectedMint ?? '';
    router.navigate({
      pathname: '/(send-flow)/amount',
      params: {
        amountEntry: JSON.stringify({
          destination: 'sendEcash',
          unit: 'sat',
          selectedMintUrl: preferredMint,
        }),
      },
    });
  }, [nostrKeys?.pubkey]);

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
