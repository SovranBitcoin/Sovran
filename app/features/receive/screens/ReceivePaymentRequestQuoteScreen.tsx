/**
 * Display screen for a freshly created SINGLE-USE incoming NUT-18 payment
 * request (receive → Fixed Amount → "as Ecash"). The durable coco operation
 * claims the payload automatically via the registered nostr transport — this
 * screen only renders the encoded request and flips to a received state when
 * the claim finalizes (receive-op:finalized correlated by the request
 * operation id). The global payment-status listener owns the toast.
 *
 * It mirrors the receive "QR Display" Cashu tab: the same P2PK-lock + Advanced
 * per-mint customization (shared `CreqCustomizationCard`), driven off the same
 * global mintStore preference. coco rejects a nut10 lock on incoming requests,
 * so the lock + mint narrowing ride the DISPLAYED encoding
 * (`reencodeSingleUsePaymentRequest`) while the durable op keeps its full mint
 * list and stays lock-free — the amount is preserved (unlike the amountless
 * standing rail).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';

import { router } from 'expo-router';
import { useMints } from '@cashu/coco-react';
import type { HistoryEntry } from '@cashu/coco-core';

import { reencodeSingleUsePaymentRequest, type SingleUseReencodeOptions } from 'wallet';
import { useColadaManager, useColadaTransactionAnnotation } from 'wallet/react';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { resolvePrimaryReceiveP2PKPublicKey } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { CreqCustomizationCard } from '@/features/receive/components/CreqCustomizationCard';
import { HistoryEntryHeader, HistoryEntryTimeline } from '@/features/transactions';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import {
  deriveCreqMintSelection,
  type CreqMintCandidate,
} from '@/features/receive/lib/creqMintSelection';
import { MAX_ADVERTISED_MINTS } from '@/features/receive/lib/standingQuoteIdentityStore';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

const EntrySchema = z.object({
  operationId: z.string().min(1).max(128),
  encodedRequest: z.string().min(4).max(8192),
  amount: z.number().positive(),
  unit: z.string().min(1).max(16),
  mints: z.array(z.string().max(2048)).max(16),
});

const ParamsSchema = z.object({
  paymentRequestEntry: z.string().min(2),
});

export const ReceivePaymentRequestQuoteScreen = memo(function ReceivePaymentRequestQuoteScreen() {
  useLifecycleLogger('ReceivePaymentRequestQuoteScreen');
  const muted = useThemeColor('muted');
  const manager = useColadaManager();
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.paymentRequest' });

  const entry = useMemo(() => {
    if (!params) return null;
    try {
      return EntrySchema.parse(JSON.parse(params.paymentRequestEntry));
    } catch {
      return null;
    }
  }, [params]);

  // 'requested' (waiting for payment on nostr) → 'paid' (payer paid, coco's
  // auto-claim is running) → 'finalized' (added to wallet). Drives the timeline;
  // redeem is automatic (coco) so there is no confirm step.
  const [prState, setPrState] = useState<'requested' | 'paid' | 'finalized'>('requested');
  // Stable timestamp for the synthetic entry's "Requested" step so the
  // position-keyed timeline rows animate in place rather than remounting.
  const createdAtRef = useRef(Date.now());

  useEffect(() => {
    if (!entry) return;
    const matches = (operation: unknown): boolean => {
      const source = (operation as { source?: { type?: string; requestOperationId?: string } })
        .source;
      return source?.type === 'payment-request' && source.requestOperationId === entry.operationId;
    };
    const offPrepared = manager.on('receive-op:prepared', ({ operation }) => {
      if (!matches(operation)) return;
      paymentLog.info('receive.creq.fixed_amount.payment_seen', {
        operationId: entry.operationId,
      });
      setPrState((s) => (s === 'finalized' ? s : 'paid'));
    });
    const offFinalized = manager.on('receive-op:finalized', ({ operation }) => {
      if (!matches(operation)) return;
      paymentLog.info('receive.creq.fixed_amount.claimed', {
        operationId: entry.operationId,
        amount: entry.amount,
        unit: entry.unit,
      });
      setPrState('finalized');
    });
    return () => {
      offPrepared();
      offFinalized();
    };
  }, [manager, entry]);

  // Synthetic `receive` HistoryEntry driving the timeline — mirrors
  // pendingPaymentRequestToHistoryEntry. `paymentRequestPending` marks the
  // waiting-for-payment step ONLY while requested; `state` advances so the
  // timeline builder's receive-PR branch renders payment-seen → added.
  const syntheticEntry = useMemo<HistoryEntry | null>(() => {
    if (!entry) return null;
    const state =
      prState === 'requested' ? 'executing' : prState === 'paid' ? 'prepared' : 'finalized';
    return {
      id: `pr-${entry.operationId}`,
      type: 'receive',
      source: 'operation',
      operationId: entry.operationId,
      createdAt: createdAtRef.current,
      updatedAt: createdAtRef.current,
      mintUrl: entry.mints[0] ?? '',
      unit: entry.unit,
      amount: entry.amount,
      state,
      metadata: {
        operationId: entry.operationId,
        source: 'payment-request',
        ...(prState === 'requested' ? { paymentRequestPending: '1' } : {}),
      },
    } as unknown as HistoryEntry;
  }, [entry, prState]);

  // Resolve the keyring P2PK pubkey (the only key coco's claim path can sign
  // for). Absent → the lock toggle is disabled, exactly like the hub tab.
  const [p2pkKey, setP2pkKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const key = await resolvePrimaryReceiveP2PKPublicKey(manager);
        if (!cancelled) setP2pkKey(key ?? undefined);
      } catch {
        /* no key → lock stays disabled */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manager]);

  // Same UI/derivation as the QR Display Cashu tab, but the state is PER-REQUEST:
  // SEEDED from the global mintStore default, then stored per-op in the
  // transaction annotation store so tweaking a one-off request never mutates the
  // global (QR-Display) preference. Effective = per-op annotation ?? global.
  const globalCreqP2pkLock = useMintStore((s) => s.creqP2pkLock);
  const globalCreqExcludedMints = useMintStore((s) => s.creqExcludedMints);
  const { trustedMints: rawTrustedMints } = useMints();

  const perOpCustomization = useColadaTransactionAnnotation(syntheticEntry).creqCustomization;
  const effectiveP2pkLock = perOpCustomization?.p2pkLock ?? globalCreqP2pkLock;
  const effectiveExcluded = useMemo<Record<string, boolean>>(() => {
    if (perOpCustomization?.excludedMints) {
      return Object.fromEntries(perOpCustomization.excludedMints.map((m) => [m, true]));
    }
    return globalCreqExcludedMints;
  }, [perOpCustomization?.excludedMints, globalCreqExcludedMints]);
  const currentExcludedArray = useMemo(
    () => Object.keys(effectiveExcluded).filter((m) => effectiveExcluded[m]),
    [effectiveExcluded]
  );

  const candidateMints = useMemo<CreqMintCandidate[]>(() => {
    const advertised = new Set(entry?.mints ?? []);
    return rawTrustedMints.filter((m: CreqMintCandidate) => advertised.has(m.mintUrl));
  }, [rawTrustedMints, entry?.mints]);

  const mintSelection = useMemo(
    () =>
      deriveCreqMintSelection({
        mints: candidateMints,
        excluded: effectiveExcluded,
        p2pkLockActive: effectiveP2pkLock && !!p2pkKey,
        maxAdvertised: MAX_ADVERTISED_MINTS,
      }),
    [candidateMints, effectiveExcluded, effectiveP2pkLock, p2pkKey]
  );

  // Materialize the (possibly global-seeded) state into the per-op annotation
  // on every toggle, writing the FULL customization so a later read is complete.
  const persistCustomization = useCallback(
    (p2pkLock: boolean, excludedMints: string[]) => {
      if (!entry) return;
      setTransactionAnnotation(`op:${entry.operationId}`, {
        creqCustomization: { p2pkLock, excludedMints },
      });
    },
    [entry]
  );

  const displayedRequest = useMemo(() => {
    if (!entry) return '';
    const options: SingleUseReencodeOptions = {
      displayMints: mintSelection.displayMints,
      lockP2pkPubkey: mintSelection.p2pkLockEffective ? p2pkKey : undefined,
    };
    try {
      return reencodeSingleUsePaymentRequest(entry.encodedRequest, options).encodedRequest;
    } catch (error) {
      paymentLog.warn('receive.creq.fixed_amount.reencode_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return entry.encodedRequest;
    }
  }, [entry, mintSelection.displayMints, mintSelection.p2pkLockEffective, p2pkKey]);

  const handleP2pkLockChange = useCallback(
    (enabled: boolean) => {
      paymentLog.info('receive.creq.p2pk_lock_toggled', { enabled, scope: 'per-request' });
      persistCustomization(enabled, currentExcludedArray);
    },
    [persistCustomization, currentExcludedArray]
  );

  const handleMintToggle = useCallback(
    (mintUrl: string, advertise: boolean) => {
      paymentLog.info('receive.creq.mint_toggled', {
        mintUrlLength: mintUrl.length,
        advertise,
        scope: 'per-request',
      });
      const next = new Set(currentExcludedArray);
      if (advertise) next.delete(mintUrl);
      else next.add(mintUrl);
      persistCustomization(effectiveP2pkLock, [...next]);
    },
    [persistCustomization, currentExcludedArray, effectiveP2pkLock]
  );

  // Batch un-exclude (single whole-array write) — a per-mint loop would clobber
  // itself here since we persist the exclusion set as one object.
  const handleResetExclusions = useCallback(
    (advertiseMintUrls: string[]) => {
      const advertise = new Set(advertiseMintUrls);
      persistCustomization(
        effectiveP2pkLock,
        currentExcludedArray.filter((m) => !advertise.has(m))
      );
    },
    [persistCustomization, currentExcludedArray, effectiveP2pkLock]
  );

  if (!entry) {
    return <ScreenErrorState message="Invalid payment request" onGoBack={() => router.back()} />;
  }

  return (
    <ScreenWrapper name="ReceivePaymentRequestQuoteScreen" contentPadding={0} deferContent={false}>
      {/* Same 12px vertical rhythm as the other detail/flow screens (VStack gap).
          Each block owns its own horizontal inset (PaymentInfo full-bleed; the
          timeline + card carry marginHorizontal:16). */}
      <VStack gap={12}>
        {/* Amount header, same as every other receive/detail screen (siblings get
            it via TransactionDetailShell → HistoryEntryHeader). */}
        {syntheticEntry ? (
          <HistoryEntryHeader historyEntry={syntheticEntry} showRecipientAvatar={false} />
        ) : null}
        <PaymentInfo data={displayedRequest} copyTarget="paymentRequest" unit={entry.unit} />
        {syntheticEntry ? (
          // No key={prState} remount: the P3 cascade fix + rowKey-keyed
          // in-place dot transitions let the idle→done settle play live.
          <HistoryEntryTimeline historyEntry={syntheticEntry} />
        ) : null}
        {/* Once paid, the request is settled — hide the customization (a paid
            single-use request can't be re-shaped). */}
        {prState === 'requested' ? (
          <CreqCustomizationCard
            encodedRequest={displayedRequest}
            muted={muted}
            p2pkKey={p2pkKey}
            mintSelection={mintSelection}
            p2pkLockOn={effectiveP2pkLock}
            onP2pkLockChange={handleP2pkLockChange}
            onMintToggle={handleMintToggle}
            onResetExclusions={handleResetExclusions}
            sectionTitle={null}
          />
        ) : null}
      </VStack>
    </ScreenWrapper>
  );
});
