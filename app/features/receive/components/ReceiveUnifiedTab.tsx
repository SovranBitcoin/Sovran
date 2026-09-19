/**
 * BIP-321 unified receive rail: ONE bitcoin: URI composing the standing
 * rails — onchain address (URI body), BOLT 12 offer (`lno`), and the cashu
 * payment request (`creq`, NUT-26's consensus key, bech32m). Payer wallets
 * use the best method they support and fall back across keys. There is NO
 * key for lightning ADDRESSES (npub@npub.cash) — human-readable names are
 * BIP-353 (DNS) and resolve TO a BIP-321 URI — so the Lightning rail is
 * deliberately absent here.
 *
 * The default tab waits for enabled rails to settle before showing its QR.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLatestRef } from '@/shared/hooks/useLatestRef';

import { setStringAsync } from 'expo-clipboard';

import { buildUnifiedBip321Uri } from 'wallet';
import { useReusableMintQuote, type UseStandingPaymentRequestResult } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { estimateBip321Length, expectedQrPayloadLength } from '@/shared/lib/qr';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { OnchainDepositLimitsCard } from '@/features/receive/components/OnchainDepositLimitsCard';
import { UnifiedRailsCard } from '@/features/receive/components/UnifiedRailsCard';
import type { useBip321RailSelection } from '@/features/receive/hooks/useBip321RailSelection';
import type { Bip321RailId } from '@/shared/stores/profile/mintStore';
import { PaymentQRCodePlaceholder } from '@/shared/ui/composed/QRCodeFrame';
import type { OnReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { copyPopup, type CopyTarget } from '@/shared/lib/popup';
import { standingQuoteIdentityStore } from '@/features/receive/lib/standingQuoteIdentityStore';
import Icon from 'assets/icons';

const RAIL_COPY_TARGET: Record<Bip321RailId, CopyTarget> = {
  onchain: 'address',
  bolt12: 'bolt12Offer',
  creq: 'paymentRequest',
};

interface ReceiveUnifiedTabProps {
  unit: string;
  active?: boolean;
  bip321: ReturnType<typeof useBip321RailSelection>;
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
  bip321,
  muted,
  creq,
  onQrPayload,
}: ReceiveUnifiedTabProps) {
  const identityStore = standingQuoteIdentityStore;

  const { selection, onchainMint, bolt12Mint } = bip321;
  const onchainEnabled = selection.rails.some(
    (rail) => rail.id === 'onchain' && rail.state === 'included'
  );
  const bolt12Enabled = selection.rails.some(
    (rail) => rail.id === 'bolt12' && rail.state === 'included'
  );
  const creqEnabled = selection.rails.some(
    (rail) => rail.id === 'creq' && rail.state === 'included'
  );
  const onchain = useReusableMintQuote(
    onchainEnabled && onchainMint ? { mintUrl: onchainMint, method: 'onchain', unit } : null,
    identityStore
  );
  const bolt12 = useReusableMintQuote(
    bolt12Enabled && bolt12Mint ? { mintUrl: bolt12Mint, method: 'bolt12', unit } : null,
    identityStore
  );

  // Mask cached results immediately: hooks clear disabled input in an effect.
  const address = onchainEnabled ? (onchain.quote?.request ?? null) : null;
  const offer = bolt12Enabled ? (bolt12.quote?.request ?? null) : null;
  const request = creqEnabled ? (creq.request?.encodedRequestB ?? null) : null;
  const uri = useMemo(
    () => buildUnifiedBip321Uri({ address, lno: offer, creq: request }),
    [address, offer, request]
  );
  // Each rail row copies exactly what that rail's own tab copies — the bare
  // address, the bare offer, the creqA request (the Cashu tab's copy; the URI
  // itself carries the same request as NUT-26 creqB). Bare values, not
  // deeplinks: that is what payer wallets and exchange fields paste, and what
  // cashu.me and cashubtc/wallet copy. Trimmed as buildUnifiedBip321Uri trims.
  const railValues = {
    onchain: address?.trim() || null,
    bolt12: offer?.trim() || null,
    creq: (creqEnabled ? creq.request?.encodedRequest?.trim() : null) || null,
  };

  const anyLoading =
    (onchainEnabled && onchain.isLoading) ||
    (bolt12Enabled && bolt12.isLoading) ||
    (creqEnabled && creq.isLoading);
  // Pills describe the actual URI, including a failed or still-loading quote.

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
  // Only a URI that arrives after the placeholder gets the decode-in; a tab
  // that settles synchronously from warm caches renders its QR immediately.
  const [revealPending, setRevealPending] = useState(!settled);
  useEffect(() => {
    if (!settled) setRevealPending(true);
  }, [settled]);

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

  const handleCopyUri = useCallback(async (value: string) => {
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(value);
    copyPopup('bip321');
    paymentLog.info('receive.bip321.copied', { uriLength: value.length });
  }, []);

  const handleCopyRail = useCallback(async (id: Bip321RailId, value: string) => {
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(value);
    copyPopup(RAIL_COPY_TARGET[id]);
    paymentLog.info('receive.unified.rail_copied', { rail: id, valueLength: value.length });
  }, []);

  if (!active) return null;

  // The URI's onchain body takes any amount, so while the onchain rail is
  // included, state the mint's deposit bounds under the QR.
  const depositLimits = onchainEnabled ? (
    <OnchainDepositLimitsCard mintUrl={onchainMint} unit={unit} className="mt-3" />
  ) : null;

  // Both branches keep the deposit limits second and the rails card third so
  // React preserves their instances across the placeholder → QR swap.
  if (!settled) {
    return (
      <>
        <PaymentQRCodePlaceholder
          unit={unit}
          expectedLength={expectedQrPayloadLength('bip321', estimateBip321Length(selection.rails))}
        />
        {depositLimits}
        <UnifiedRailsCard
          selection={selection}
          uri={null}
          values={railValues}
          loading
          muted={muted}
          onCopyUri={handleCopyUri}
          onCopyRail={handleCopyRail}
        />
      </>
    );
  }

  return (
    <>
      {uri ? (
        <PaymentInfo
          active={active}
          data={uri}
          copyTarget="bip321"
          unit={unit}
          reveal={revealPending}
        />
      ) : (
        <View className="mx-4 mt-8">
          <View className="bg-surface-secondary items-center rounded-xl p-6">
            <Icon name="stash:qr-code" size={48} color={muted} />
            <Text size={14} className="text-muted mt-3 text-center">
              No methods available for a Unified request. Add a mint that supports onchain, BOLT 12,
              or Cashu payment requests.
            </Text>
          </View>
        </View>
      )}
      {depositLimits}
      <UnifiedRailsCard
        selection={selection}
        uri={uri}
        values={railValues}
        loading={false}
        muted={muted}
        onCopyUri={handleCopyUri}
        onCopyRail={handleCopyRail}
      />
    </>
  );
});
