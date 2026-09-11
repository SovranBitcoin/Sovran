/**
 * The Cashu receive rail — a standing NUT-18 payment request. The QR encodes
 * an AMOUNTLESS reusable request (payer wallets prompt for the amount)
 * carrying the wallet's trusted mints and a Nostr transport (NIP-17); the
 * durable coco operation behind it claims incoming payloads automatically
 * via the registered nostr transport plugin. Every visit mints a FRESH
 * request (the previous op is cancelled, so exactly one stays active) —
 * rotation costs nothing at any mint, so the manual New-request segment
 * needs no cooldown.
 *
 * Mints never advertise NUT-18 (it's wallet-to-wallet), so availability is
 * simply "any trusted mint exists".
 */

import React, { memo, useCallback, useEffect } from 'react';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { type WalletContext } from 'wallet';
import { type UseStandingPaymentRequestResult } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { CreqCustomizationCard } from '@/features/receive/components/CreqCustomizationCard';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { ActionSegmentsCard } from '@/shared/ui/composed/ActionSegmentsCard';
import { Button } from '@/shared/ui/primitives/Button';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import type { OnReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import type { CreqMintSelection } from '@/features/receive/lib/creqMintSelection';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import Icon from 'assets/icons';

interface ReceivePaymentRequestTabProps {
  unit: string;
  active?: boolean;
  walletContext: Pick<WalletContext, 'trustedMintUrls'>;
  /** Latest keyring P2PK pubkey (02-prefixed) — the only key coco's claim
   *  path can sign for (exact persisted-'p2pk' lookup). Absent → the lock
   *  toggle is disabled. */
  p2pkKey?: string;
  muted: string;
  /** The ONE standing request, resolved fresh-per-visit by ReceiveScreen
   *  and shared with the Unified tab — so both rails always show the SAME
   *  (current) creq and neither can flash a retired one. */
  creq: UseStandingPaymentRequestResult;
  /** Which trusted mints the request advertises (Advanced toggles + NUT-11
   *  gating under the P2PK lock) — derived by ReceiveScreen, the owner of
   *  the creq input, so the toggles and the encoding can't drift. */
  mintSelection: CreqMintSelection;
  /** Reports the encoded creq upward for the QR display's footer Copy
   *  button. */
  onQrPayload?: OnReceiveQrPayload;
}

export const ReceivePaymentRequestTab = memo(function ReceivePaymentRequestTab({
  unit,
  active = true,
  walletContext,
  p2pkKey,
  muted,
  creq,
  mintSelection,
  onQrPayload,
}: ReceivePaymentRequestTabProps) {
  // P2PK lock (absorbs the old P2PK tab): when on, the DISPLAYED request
  // advertises a NUT-10 lock to the keyring key — payers lock their ecash to
  // this wallet; coco's claim path signs the locked proofs transparently.
  // The lock feeds the shared request via ReceiveScreen's input. NUT-11 is
  // optional per mint, so the toggle also needs a capable mint to exist —
  // locking over incapable-only mints would advertise anyone-can-spend
  // ecash as locked.
  const creqP2pkLock = useMintStore((s) => s.creqP2pkLock);
  const setCreqP2pkLock = useMintStore((s) => s.setCreqP2pkLock);
  const setCreqMintExcluded = useMintStore((s) => s.setCreqMintExcluded);
  const mints = walletContext.trustedMintUrls;

  const { request, error, rotate } = creq;

  const handleMintToggle = useCallback(
    (mintUrl: string, advertise: boolean) => {
      paymentLog.info('receive.creq.mint_toggled', {
        mintUrlLength: mintUrl.length,
        advertise,
      });
      setCreqMintExcluded(mintUrl, !advertise);
    },
    [setCreqMintExcluded]
  );

  useEffect(() => {
    onQrPayload?.(
      request?.encodedRequest
        ? { value: request.encodedRequest, copyTarget: 'paymentRequest' }
        : null
    );
  }, [request?.encodedRequest, onQrPayload]);

  const handleNewRequest = useCallback(async () => {
    paymentLog.info('receive.creq.rotate_requested', { source: 'button' });
    await EnhancedHaptics.copyHaptic();
    await rotate();
  }, [rotate]);

  // "View all": push the payment-requests list into this same (receive-flow)
  // stack so a paid single-use request can open its transaction to the side.
  const openRequestList = useCallback(() => {
    paymentLog.info('receive.creq.request_list_opened', { unit });
    router.navigate({ pathname: '/railList', params: { rail: 'paymentRequest', unit } });
  }, [unit]);

  const renderEmptyState = (message: string, cta?: React.ReactNode) => (
    <View className="mx-4 mt-8">
      <View className="bg-surface-secondary items-center rounded-xl p-6">
        <Icon name="ph:coins" size={48} color={muted} />
        <Text size={14} className="text-muted mt-3 text-center">
          {message}
        </Text>
        {cta}
      </View>
    </View>
  );

  if (!active) return null;

  if (mints.length === 0) {
    return renderEmptyState(
      'Add a mint to receive Cashu payment requests.',
      <Button
        text="Find mints"
        variant="primary"
        size="compact"
        onPress={() => {
          paymentLog.info('receive.creq.discovery_opened', { unit });
          router.push('/(mint-flow)/add');
        }}
        style={{ marginTop: 16 }}
        testID="receive-creq-find-mints"
      />
    );
  }

  // Hold the previous request while re-resolving (P2PK toggle / mint-list
  // drift only re-encodes the same operation) — blanking everything to a
  // skeleton on toggle was jarring. The placeholder only shows before the
  // FIRST request resolves.
  if (!request && error) {
    return renderEmptyState(`Could not load the payment request: ${error}`);
  }

  if (!request) {
    return <ReceiveRailPlaceholder sectionTitle="CASHU PAYMENT REQUEST" />;
  }

  return (
    <>
      <PaymentInfo
        active={active}
        data={request.encodedRequest}
        copyTarget="paymentRequest"
        unit={unit}
      />
      {/* Same 12px offset the QR speed controls use; the Section below
          brings its own py-3, keeping the gaps symmetric. */}
      <View style={{ marginTop: 12 }}>
        <ActionSegmentsCard
          segments={[
            {
              icon: 'mdi:refresh',
              label: 'New request',
              onPress: () => void handleNewRequest(),
              testID: 'receive-creq-new-request',
            },
            {
              icon: 'fluent:list-16-filled',
              label: 'View all',
              onPress: () => void openRequestList(),
              testID: 'receive-creq-view-requests',
            },
          ]}
        />
      </View>
      <CreqCustomizationCard
        encodedRequest={request.encodedRequest}
        muted={muted}
        p2pkKey={p2pkKey}
        mintSelection={mintSelection}
        p2pkLockOn={creqP2pkLock}
        onP2pkLockChange={setCreqP2pkLock}
        onMintToggle={handleMintToggle}
      />
    </>
  );
});
