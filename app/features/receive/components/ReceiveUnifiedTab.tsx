/**
 * BIP-321 unified receive rail: ONE bitcoin: URI composing the standing
 * rails — onchain address (URI body), BOLT 12 offer (`lno`), and the cashu
 * payment request (`creq`, NUT-26's consensus key, bech32m). Payer wallets
 * use the best method they support and fall back across keys. There is NO
 * key for lightning ADDRESSES (npub@npub.cash) — human-readable names are
 * BIP-353 (DNS) and resolve TO a BIP-321 URI — so the Lightning rail is
 * deliberately absent here.
 *
 * The parts resolve asynchronously, so the QR re-renders as each rail lands
 * — which is exactly why this tab is NOT the receive hub's default.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLatestRef } from '@/shared/hooks/useLatestRef';

import { setStringAsync } from 'expo-clipboard';

import { buildUnifiedBip321Uri, getMintMethodCapability, type WalletContext } from 'wallet';
import { useReusableMintQuote, type UseStandingPaymentRequestResult } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { CopyRequestCard } from '@/shared/ui/composed/CopyRequestCard';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { useReceiveMethodMint } from '@/features/receive/hooks/useReceiveMethodMint';
import type { OnReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { copyPopup } from '@/shared/lib/popup';
import { standingQuoteIdentityStore } from '@/features/receive/lib/standingQuoteIdentityStore';
import Icon from 'assets/icons';

interface ReceiveUnifiedTabProps {
  unit: string;
  active?: boolean;
  walletContext: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities' | 'mintBalances'>;
  muted: string;
  /** The ONE standing request — resolved fresh-per-visit by ReceiveScreen
   *  and shared with the Cashu tab, so the composed URI can never carry a
   *  retired creq. Loading until the fresh request lands. */
  creq: UseStandingPaymentRequestResult;
  /** Reports the composed BIP-321 URI upward for the QR display's footer
   *  Copy button. */
  onQrPayload?: OnReceiveQrPayload;
}

export const ReceiveUnifiedTab = memo(function ReceiveUnifiedTab({
  unit,
  active = true,
  walletContext,
  muted,
  creq,
  onQrPayload,
}: ReceiveUnifiedTabProps) {
  const identityStore = standingQuoteIdentityStore;

  // Same standing singletons as the dedicated tabs (in-flight dedup + shared
  // identity store means no extra quotes/requests are ever created here).
  const { mintUrl: onchainMint } = useReceiveMethodMint('onchain', unit);
  const onchainSupported =
    !!onchainMint &&
    (() => {
      const cap = getMintMethodCapability(walletContext, onchainMint, {
        operation: 'mint',
        method: 'onchain',
        unit,
      });
      return cap.supported && !cap.disabled;
    })();
  const onchain = useReusableMintQuote(
    onchainSupported && onchainMint ? { mintUrl: onchainMint, method: 'onchain', unit } : null,
    identityStore
  );

  const { mintUrl: bolt12Mint } = useReceiveMethodMint('bolt12', unit);
  const bolt12Supported =
    !!bolt12Mint &&
    (() => {
      const cap = getMintMethodCapability(walletContext, bolt12Mint, {
        operation: 'mint',
        method: 'bolt12',
        unit,
      });
      return cap.supported && !cap.disabled;
    })();
  const bolt12 = useReusableMintQuote(
    bolt12Supported && bolt12Mint ? { mintUrl: bolt12Mint, method: 'bolt12', unit } : null,
    identityStore
  );

  const uri = useMemo(
    () =>
      buildUnifiedBip321Uri({
        address: onchain.quote?.request ?? null,
        lno: bolt12.quote?.request ?? null,
        creq: creq.request?.encodedRequestB ?? null,
      }),
    [onchain.quote, bolt12.quote, creq.request]
  );

  const anyLoading = onchain.isLoading || bolt12.isLoading || creq.isLoading;

  // As the DEFAULT tab this must not stutter: hold the placeholder until
  // every rail settles ONCE, then render the fully composed QR in a single
  // swap. The quote rails seed synchronously from warm colada caches; the
  // creq rail intentionally does NOT (fresh-per-visit — the cached request
  // is about to be retired, so the shared hook loads until the fresh one
  // lands). First visit therefore shows the skeleton; the URI that finally
  // renders is always composed with the CURRENT creq, never a stale one.
  const [settled, setSettled] = useState(!anyLoading);
  useEffect(() => {
    if (!anyLoading && !settled) setSettled(true);
  }, [anyLoading, settled]);

  // The footer Copy must never hand out a half-composed URI (e.g. missing
  // the creq while the fresh rotation is in flight) — report only once the
  // tab has settled.
  useEffect(() => {
    onQrPayload?.(settled && uri ? { value: uri, copyTarget: 'bip321' } : null);
  }, [settled, uri, onQrPayload]);

  // Which rail gates the skeleton? Log each rail's first settle relative to
  // mount (duration_ms ≈ 0 ⇒ served from the colada cache) plus the moment
  // the whole tab settles — log-doctor: `receive.unified.`.
  const mountTsRef = useRef(Date.now());
  const railLoggedRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const rails: Record<string, boolean> = {
      onchain: onchain.isLoading,
      bolt12: bolt12.isLoading,
      creq: creq.isLoading,
    };
    for (const [rail, loading] of Object.entries(rails)) {
      if (!loading && !railLoggedRef.current[rail]) {
        railLoggedRef.current[rail] = true;
        paymentLog.info('receive.unified.rail_settled', {
          rail,
          duration_ms: Date.now() - mountTsRef.current,
        });
      }
    }
  }, [onchain.isLoading, bolt12.isLoading, creq.isLoading]);
  // `uri` is the payload of the settle log, not its trigger — mirrored so the
  // dep list stays honest and this component keeps its auto-memoization.
  const uriRef = useLatestRef(uri);
  useEffect(() => {
    if (!settled) return;
    paymentLog.info('receive.unified.settled', {
      duration_ms: Date.now() - mountTsRef.current,
      hasUri: !!uriRef.current,
    });
  }, [settled, uriRef]);

  const handleCopy = useCallback(async () => {
    if (!uri) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(uri);
    copyPopup('bip321');
    paymentLog.info('receive.bip321.copied', {
      uriLength: uri.length,
      included: [
        ...(onchain.quote ? ['Onchain'] : []),
        ...(bolt12.quote ? ['BOLT 12'] : []),
        ...(creq.request ? ['Cashu'] : []),
      ].join(','),
    });
  }, [uri, onchain.quote, bolt12.quote, creq.request]);

  if (!active) return null;

  if (!settled) {
    return <ReceiveRailPlaceholder sectionTitle="BIP-321 URI" />;
  }

  if (!uri) {
    return (
      <View className="mx-4 mt-8">
        <View className="bg-surface-secondary items-center rounded-xl p-6">
          <Icon name="stash:qr-code" size={48} color={muted} />
          <Text size={14} className="text-muted mt-3 text-center">
            No rails available for a unified URI — add a mint that supports onchain, BOLT 12, or
            Cashu payment requests.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <PaymentInfo active={active} data={uri} copyTarget="bip321" unit={unit} />
      <CopyRequestCard
        title="BIP-321 URI"
        icon="stash:qr-code"
        display={truncateMiddle(uri, 10)}
        muted={muted}
        onPress={handleCopy}
      />
    </>
  );
});
