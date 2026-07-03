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

import React, { memo, useCallback, useEffect, useMemo } from 'react';

import { router } from 'expo-router';
import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';

import {
  standingPaymentRequestKey,
  type ReusableQuoteIdentityStore,
  type WalletContext,
} from 'wallet';
import { useColadaManager, useStandingPaymentRequest } from 'wallet/react';
import { paymentLog } from '@/shared/lib/logger';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { ReceiveRailPlaceholder } from '@/features/receive/components/ReceiveRailPlaceholder';
import { ActionSegmentsCard } from '@/shared/ui/composed/ActionSegmentsCard';
import { Section } from '@/shared/ui/composed/Section';
import { Button } from '@/shared/ui/primitives/Button';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { truncateMiddle } from '@/shared/lib/strings';
import { setStringAsync } from 'expo-clipboard';
import { copyPopup } from '@/shared/lib/popup';
import { actionMenuSheet } from '@/shared/lib/popup/popups/actionMenuSheet';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import type { OnReceiveQrPayload } from '@/features/receive/lib/qrPayload';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import Icon from 'assets/icons';

/** Keep the QR sane — same cap as the BLE standing creq. */
const MAX_ADVERTISED_MINTS = 5;

interface ReceivePaymentRequestTabProps {
  unit: string;
  walletContext: Pick<WalletContext, 'trustedMintUrls'>;
  /** Latest keyring P2PK pubkey (02-prefixed) — the only key coco's claim
   *  path can sign for (exact persisted-'p2pk' lookup). Absent → the lock
   *  toggle is disabled. */
  p2pkKey?: string;
  muted: string;
  /** Reports the encoded creq upward for the QR display's footer Copy
   *  button. */
  onQrPayload?: OnReceiveQrPayload;
}

export const ReceivePaymentRequestTab = memo(function ReceivePaymentRequestTab({
  unit,
  walletContext,
  p2pkKey,
  muted,
  onQrPayload,
}: ReceivePaymentRequestTabProps) {
  // P2PK lock (absorbs the old P2PK tab): when on, the DISPLAYED request
  // advertises a NUT-10 lock to the keyring key — payers lock their ecash to
  // this wallet; coco's claim path signs the locked proofs transparently.
  const creqP2pkLock = useMintStore((s) => s.creqP2pkLock);
  const setCreqP2pkLock = useMintStore((s) => s.setCreqP2pkLock);
  const lockP2pkPubkey = creqP2pkLock && p2pkKey ? p2pkKey : undefined;
  const mints = useMemo(
    () => walletContext.trustedMintUrls.slice(0, MAX_ADVERTISED_MINTS),
    [walletContext.trustedMintUrls]
  );

  // Same persisted identity map as the quote rails (key `creq|<unit>`), so
  // the standing request survives restarts and external rotations propagate.
  const identityStore = useMemo<ReusableQuoteIdentityStore>(
    () => ({
      get: (key) => useMintStore.getState().standingQuotes[key],
      set: (key, id) => useMintStore.getState().setStandingQuote(key, id),
      subscribe: (key, callback) =>
        useMintStore.subscribe((state, prev) => {
          if (state.standingQuotes[key] !== prev.standingQuotes[key]) callback();
        }),
    }),
    []
  );

  // A fresh request every visit: rotation cancels the previous op (exactly
  // one stays active) and costs nothing anywhere — no cooldown or manual
  // button needed.
  const { request, isLoading, error, rotate } = useStandingPaymentRequest(
    mints.length > 0 ? { unit, mints, lockP2pkPubkey } : null,
    identityStore,
    { freshOnMount: true }
  );
  const manager = useColadaManager();
  const accent = useThemeColor('accent');

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

  // "View all": every payment-request receive operation coco has stored for
  // this profile — unlike onchain quotes these carry real lifecycle states
  // (active / completed / cancelled): rotations cancel, single-use claims
  // complete. Tap to copy the encoded request.
  const openRequestList = useCallback(async () => {
    const operations = await manager.paymentRequests.incoming.list();
    const standingId = useMintStore.getState().standingQuotes[standingPaymentRequestKey(unit)];
    const rows = [...operations].sort((a, b) => b.createdAt - a.createdAt);
    paymentLog.info('receive.creq.request_list_opened', { count: rows.length });
    actionMenuSheet({
      title: `Payment requests (${rows.length})`,
      buttons: rows.map((op) => {
        const isStanding = op.id === standingId;
        const parts = [
          op.state,
          op.singleUse ? `${amountToNumber(op.amount as never)} ${op.unit}` : 'reusable',
          `${op.mints.length} mint${op.mints.length === 1 ? '' : 's'}`,
          new Date(op.createdAt).toLocaleString(),
        ];
        return {
          text: truncateMiddle(op.encodedRequest, 12),
          description: parts.join(' · '),
          suffix: isStanding ? <Icon name="mdi:check" size={20} color={accent} /> : undefined,
          onPress: async () => {
            await setStringAsync(op.encodedRequest);
            copyPopup('paymentRequest');
          },
        };
      }),
    });
  }, [manager, unit, accent]);

  const handleCopy = useCallback(async () => {
    if (!request) return;
    await EnhancedHaptics.copyHaptic();
    await setStringAsync(request.encodedRequest);
    copyPopup('paymentRequest');
    paymentLog.info('receive.creq.copied', { requestLength: request.encodedRequest.length });
  }, [request]);

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
      <PaymentInfo data={request.encodedRequest} copyTarget="paymentRequest" unit={unit} />
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
      <View className="mx-4">
        <Section title="CASHU PAYMENT REQUEST">
          <GradientCard>
            <ListGroup variant="transparent">
              <PressableFeedback animation={false} onPress={handleCopy}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="ph:coins" size={20} color={muted} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>
                        {truncateMiddle(request.encodedRequest, 10)}
                      </ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon name="lets-icons:copy" size={20} color={muted} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
              <Separator className="mx-4" />
              <ListGroup.Item>
                <ListGroup.ItemPrefix>
                  <Icon name="solar:key-bold" size={20} color={muted} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <ListGroup.ItemTitle>P2PK lock</ListGroup.ItemTitle>
                  <ListGroup.ItemDescription>
                    {p2pkKey
                      ? 'Payers lock ecash to your key'
                      : 'No P2PK key — generate one in Settings'}
                  </ListGroup.ItemDescription>
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <HeroSwitch
                    isSelected={creqP2pkLock && !!p2pkKey}
                    isDisabled={!p2pkKey}
                    onSelectedChange={(value) => {
                      paymentLog.info('receive.creq.p2pk_lock_toggled', { enabled: value });
                      setCreqP2pkLock(value);
                    }}
                  />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </ListGroup>
          </GradientCard>
        </Section>
      </View>
    </>
  );
});
