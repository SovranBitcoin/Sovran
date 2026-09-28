import { useCallback, useEffect, useState } from 'react';

import {
  cachedProbe,
  probeProviders,
  type ProviderStatus,
} from '@/shared/lib/routstr/providerHealth';
import { normalizeNodeUrl } from '@/shared/lib/routstr/providers';
import { getMockMintBalance } from '@/shared/stores/runtime/mockDataStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import BalancePill from '@/shared/ui/composed/BalancePill';

import { useNavigateToAddFunds } from '../lib/navigateToAddFunds';
import { useRoutstrFunds } from '../hooks/useRoutstrFunds';
import { ProviderPillIcon } from './ProviderAvatar';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

/**
 * AI tab header — the structural twin of the wallet's `<MintSelector />`, and
 * now its behavioural twin too.
 *
 * The mint pill names the mint you are spending from and shows what is in it.
 * This one names the PROVIDER you are paying and shows the wallet balance
 * that can pay it, because since requests are paid per call there is no
 * second balance: the wallet is the only pot, and it cannot go stale the way
 * the old per-node figure did (the header showed 250 sats against a node that
 * had never seen them). "Can pay it" is the one mint the next request draws
 * on — never a testnut's sats, which no provider can redeem.
 *
 * The provider's liveness rides on the icon as a corner dot, so the answer to
 * "is my AI working" is on screen before anything is typed.
 */
export function AiHeaderTitle() {
  const funds = useRoutstrFunds();
  const navigateToAddFunds = useNavigateToAddFunds();
  const mintUrl = useMintStore((s) => s.selectedMint);
  const mockMode = useSettingsStore((s) => s.mockMode);

  // Only the user's own choice. There is no recommendation and no default:
  // picking who gets paid for AI is not this app's call, so an empty pill says
  // so rather than quietly naming somebody.
  const userNodeBaseUrl = useRoutstrStore((s) => s.userNodeBaseUrl);
  const knownProviders = useRoutstrStore((s) => s.knownProviders);
  const activeUrl = normalizeNodeUrl(userNodeBaseUrl ?? '');
  const providerName = activeUrl
    ? (knownProviders[activeUrl]?.name ?? activeUrl.replace(/^https:\/\//, ''))
    : 'Choose provider';

  const [status, setStatus] = useState<ProviderStatus>(
    () => cachedProbe(activeUrl)?.status ?? 'unknown'
  );

  // One probe of the provider actually in use, not the directory: this is the
  // only row whose health the user is currently living with.
  useEffect(() => {
    if (!activeUrl) return;
    setStatus(cachedProbe(activeUrl)?.status ?? 'unknown');
    const controller = new AbortController();
    void probeProviders([activeUrl], {
      signal: controller.signal,
      onResult: (probe) => {
        if (!controller.signal.aborted) setStatus(probe.status);
      },
    });
    return () => controller.abort();
  }, [activeUrl]);

  // A pushed page, not a sheet: choosing a provider means reading about one
  // first, and the mint selector answers the same question the same way.
  const onPress = useCallback(() => {
    router.navigate('/(ai-flow)/providers');
  }, []);

  // What will actually pay the next request: the mint the payment path picks
  // (`useRoutstrFunds`), not the wallet's selected mint's raw total. Those
  // differ exactly when it matters — a selected testnut mint, whose sats a
  // provider cannot redeem, or one the provider does not accept.
  const sats = mockMode
    ? mintUrl
      ? getMockMintBalance(mintUrl, 'sat')
      : 0
    : (funds?.balanceSats ?? 0);

  // No skeleton: this is local wallet state, not a request in flight. Empty
  // means the wallet is empty, and the CTA points at funding the wallet rather
  // than topping up an account on somebody's node. No provider outranks it —
  // there is nothing to spend on until one is chosen.
  const isEmpty = sats <= 0;
  const ctaLabel = !activeUrl ? 'Pick one' : isEmpty ? 'Add funds' : undefined;

  return (
    <BalancePill
      title={providerName}
      balance={sats}
      unit="sat"
      ctaLabel={ctaLabel}
      // 24 in a 24 box. The default box is 32 and the glyph was 20, so eight
      // points of the pill's width went to empty margin around a picture — on
      // the one control in this header that has a long hostname to fit.
      iconNode={
        <ProviderPillIcon
          baseUrl={activeUrl || undefined}
          name={activeUrl ? providerName : undefined}
          status={status}
          size={24}
        />
      }
      iconBoxSize={24}
      loadingTitlePlaceholder="AI provider"
      testID="ai-funds-button"
      onPress={activeUrl && isEmpty ? navigateToAddFunds : onPress}
    />
  );
}
