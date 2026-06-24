import React from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import Icon from 'assets/icons';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useRoutstrTopUpStore } from '@/shared/stores/runtime/routstrTopUpStore';
import { staticPopup } from '@/shared/lib/popup';
import BalancePill from '@/shared/ui/composed/BalancePill';

/**
 * AI tab header — same `<BalancePill />` chrome the wallet tab uses for its
 * mint selector, just fed Routstr data instead of mint data: a wallet glyph
 * (no provider logo), the literal label "Balance", and the user's Routstr
 * balance in sats. Tapping opens the top-up flow (mirrors the previous pill
 * behavior). Sharing one component keeps the two headers visually identical
 * across liquid-glass / blur-card variants without copy-pasting the chrome.
 */
export function AiHeaderTitle() {
  const accent = useThemeColor('accent');

  const apiKey = useRoutstrStore((s) => s.apiKey);
  const balance = useRoutstrStore((s) => s.balance);
  const { keys: nostrKeys } = useNostrKeysContext();

  const onPress = () => {
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
  };

  // Routstr stores msats — floor to whole sats for display.
  const sats = balance != null ? Math.floor(balance / 1000) : 0;

  // Loading vs empty: only show the skeleton while we genuinely have a
  // request inflight (apiKey present, balance not yet resolved). When the
  // user has no Routstr account at all (no apiKey) OR the account has a
  // zero balance, fall through to the "Top up balance" CTA so the header
  // is actionable instead of reading "0 sats".
  const isLoadingBalance = apiKey != null && balance == null;
  const isEmpty = !isLoadingBalance && sats <= 0;

  return (
    <BalancePill
      title="Balance"
      balance={sats}
      unit="sat"
      isLoading={isLoadingBalance}
      ctaLabel={isEmpty ? 'Top up balance' : undefined}
      iconNode={<Icon name="fluent:wallet-20-filled" size={20} color={accent} />}
      loadingTitlePlaceholder="Balance"
      onPress={onPress}
    />
  );
}
