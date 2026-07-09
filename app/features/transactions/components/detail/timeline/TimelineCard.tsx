// ---------------------------------------------------------------------------
// TimelineCard — the payment timeline card (HistoryEntryTimeline)
// ---------------------------------------------------------------------------
//
// Renders the wallet flow engine's TimelineModel: `buildTimelineModel` runs
// ONCE per input change (no per-second rebuild — the countdown badge owns its
// own interval in ExpiryCountdown, and expiry flips the model exactly once via
// a single boundary timeout). Rows are keyed by the engine's semantic
// `step.rowKey`, so shape changes morph slots in place.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { MintQuoteState, type MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import {
  buildTimelineModel,
  decodeBolt11Invoice,
  getCardLabel,
  getStatusColorType,
  getStatusHeader,
  type ChainOnchainConfirmationProgress as OnchainConfirmationProgress,
  type TimelineStep,
  type TimelineStepType,
} from 'wallet';
import opacity from 'hex-color-opacity';

import type { HistoryEntry } from '@cashu/coco-core';

import { mapCheckpointStatusToIndicator } from '@/shared/blocks/status';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { usePaymentCopyResolver } from '@/shared/hooks/usePaymentCopyResolver';
import { Log, paymentLog } from '@/shared/lib/logger';

import { ExpiryCountdown, getExpiryBadgeText } from './ExpiryCountdown';
import { TimelineRow, timelineStepTypeToCheckpointStatus } from './TimelineRow';
import { connectorType, rowDelays } from './timelineTheme';

interface HistoryEntryTimelineProps {
  historyEntry: HistoryEntry;
  meltQuote?: MeltQuoteBolt11Response;
  /** For NUT-18 payment requests - indicates token was created (prepared step complete) */
  tokenCreated?: boolean;
  /** For NUT-18 payment requests - indicates Nostr DM was sent */
  nostrSent?: boolean;
  /** For onchain mint quotes - network confirmations observed for the funding tx. */
  onchainConfirmationProgress?: OnchainConfirmationProgress | null;
  /** For onchain SEND (melt) - true when the mint settled PAID internally (no
   *  outpoint / on-chain tx), so the terminal copy must not claim "on-chain". */
  onchainSettledInternally?: boolean;
}

// Both expiry predicates compare at second granularity (strictly greater), so
// flip the clock one second PAST the boundary to guarantee the rebuilt model
// lands on the expired side — the old per-second ticker also only noticed
// expiry on its next 1s tick.
const EXPIRY_FLIP_SLACK_MS = 1000;
// setTimeout clamps to a 32-bit signed ms range; a boundary further out than
// ~24.8 days can't be scheduled (and no quote countdown ever runs that long).
const MAX_TIMEOUT_MS = 0x7fffffff;

/** One-shot expiry clock: a timestamp that flips exactly ONCE when
 *  `expiresAt` passes (via a single boundary setTimeout — never a 1s
 *  interval), invalidating the model memo so the engine re-evaluates its
 *  expired outcomes. Undefined boundary = the clock stays at mount time. */
function useExpiry(expiresAt: number | undefined): number {
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (expiresAt === undefined) return;
    const flipAt = expiresAt + EXPIRY_FLIP_SLACK_MS;
    const delay = flipAt - Date.now();
    if (delay <= 0) {
      // Boundary already passed (e.g. the entry prop swapped to a long-expired
      // quote after mount): flip once so the model rebuilds as expired.
      setCurrentTime((prev) => (prev < flipAt ? Date.now() : prev));
      return;
    }
    if (delay > MAX_TIMEOUT_MS) return;
    const timeout = setTimeout(() => setCurrentTime(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [expiresAt]);

  return currentTime;
}

export function HistoryEntryTimeline({
  historyEntry,
  meltQuote,
  tokenCreated,
  nostrSent,
  onchainConfirmationProgress,
  onchainSettledInternally,
}: HistoryEntryTimelineProps) {
  const [foreground, successColor, dangerColor, warningColor] = useThemeColor([
    'foreground',
    'success',
    'danger',
    'warning',
  ] as const);
  const paymentCopy = usePaymentCopyResolver();
  // False for the very first render so opening the screen paints the timeline
  // without entrance fades; rows/labels added by LATER timeline changes fade.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    hasMountedRef.current = true;
  }, []);

  // ── Verbose diagnostics ──────────────────────────────────────────────────
  // Everything logs under tx.history_timeline.* (module: payment) and is
  // change-gated: countdown ticks live inside ExpiryCountdown and never reach
  // this component; only actual visual transitions (rows, dots, lines,
  // labels, badge) emit.
  const entryId = String((historyEntry as { id?: unknown }).id ?? 'no-id');
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;

  useEffect(() => {
    paymentLog.debug('tx.history_timeline.mount', {
      entryId,
      entryType: historyEntry.type,
    });
    return () => {
      paymentLog.debug('tx.history_timeline.unmount', { entryId });
    };
  }, [entryId, historyEntry.type]);

  const foreground66 = opacity(foreground, 0.66);
  const foreground50 = opacity(foreground, 0.5);

  const isOnchainMint = historyEntry.type === 'mint' && !!getOnchainMintAddress(historyEntry);

  // Expiry boundary (ms epoch). Melt quotes mirror the engine's
  // model.expiresAt (meltQuote.expiry * 1000) — the clock must exist before
  // the model builds, so it derives from the same input. Lightning mint
  // invoices are app-derived from the bolt11 (the engine's expired outcome
  // checks Date.now() internally, so it only needs a rebuild nudge at the
  // boundary); onchain deposit addresses never expire.
  const meltExpiresAt =
    historyEntry.type === 'melt' && meltQuote?.expiry ? meltQuote.expiry * 1000 : undefined;
  const mintExpiresAt = useMemo(() => {
    if (historyEntry.type !== 'mint' || isOnchainMint) return undefined;
    if (String(historyEntry.state) !== MintQuoteState.UNPAID) return undefined;
    if (!historyEntry.paymentRequest) return undefined;
    const info = decodeBolt11Invoice(historyEntry.paymentRequest);
    if (!info) return undefined;
    return ((info.timestampSec ?? 0) + (info.expirySec ?? 3600)) * 1000;
  }, [historyEntry, isOnchainMint]);
  const currentTime = useExpiry(meltExpiresAt ?? mintExpiresAt);

  const model = useMemo(
    () =>
      buildTimelineModel({
        historyEntry,
        meltQuote,
        currentTime,
        tokenCreated,
        nostrSent,
        onchainConfirmationProgress,
        onchainSettledInternally,
        paymentCopy,
      }),
    [
      historyEntry,
      meltQuote,
      currentTime,
      tokenCreated,
      nostrSent,
      onchainConfirmationProgress,
      onchainSettledInternally,
      paymentCopy,
    ]
  );
  const timeline = model.steps;

  // The segmented block-confirmation ring renders on the row that owns it.
  // The engine flags the onchain melt "In mempool" row via confirmationRing;
  // the onchain mint deposit's PAID row is still app-derived (the frozen
  // engine does not set the flag on the mint flow).
  const ownsConfirmationRing = (step: TimelineStep): boolean =>
    !!onchainConfirmationProgress &&
    (!!step.confirmationRing || (isOnchainMint && step.state === MintQuoteState.PAID));

  const cardLabel = getCardLabel(historyEntry, timeline, tokenCreated, nostrSent, paymentCopy);
  const statusHeader = getStatusHeader(timeline);
  const statusColorType = getStatusColorType(timeline);
  const timelineSignature = useMemo(
    () => timeline.map((item) => `${item.state}:${item.stepType}`).join('|'),
    [timeline]
  );
  const timelineStepTypes = useMemo(
    () =>
      timelineSignature
        ? timelineSignature.split('|').map((part) => {
            const segments = part.split(':');
            return segments[segments.length - 1] as TimelineStepType;
          })
        : [],
    [timelineSignature]
  );

  useEffect(() => {
    paymentLog.debug('tx.history_timeline.render', {
      type: historyEntry.type,
      state: String((historyEntry as { state?: unknown }).state ?? ''),
      timelineItemCount: timelineStepTypes.length,
      stepTypes: timelineStepTypes,
      currentLikeCount: timelineStepTypes.filter(
        (stepType) => stepType === 'current' || stepType === 'waiting' || stepType === 'success'
      ).length,
      futureCount: timelineStepTypes.filter(
        (stepType) => stepType === 'next-pending' || stepType === 'future-small'
      ).length,
      statusColorType,
      cardLabelLength: cardLabel.length,
      statusHeaderLength: statusHeader.length,
      hasMeltQuote: !!meltQuote,
      tokenCreated: tokenCreated ?? null,
      nostrSent: nostrSent ?? null,
      isOnchainMint,
      hasOnchainConfirmationProgress: !!onchainConfirmationProgress,
    });
  }, [
    cardLabel.length,
    historyEntry,
    isOnchainMint,
    meltQuote,
    nostrSent,
    onchainConfirmationProgress,
    statusColorType,
    statusHeader.length,
    timelineSignature,
    timelineStepTypes,
    tokenCreated,
  ]);

  // Snapshot of the badge for the state log only — the live countdown (and
  // its 1s tick) is fully owned by ExpiryCountdown below.
  const expiryBadge = getExpiryBadgeText(historyEntry, meltQuote, isOnchainMint, currentTime);

  // Full per-row visual state, exactly as the render below will draw it:
  // step identity (id/rowKey), label/sublabel text, dot phase+result, colour
  // roles, connector line type, confirmation ring, and the cascade delays
  // each row inherits.
  const rowsDiag = useMemo(
    () =>
      timeline.map((step, index) => {
        const isLast = index === timeline.length - 1;
        const nextStep = !isLast ? timeline[index + 1] : null;
        const lineType = nextStep ? connectorType(step, nextStep) : null;
        const isFutureState = step.stepType === 'next-pending' || step.stepType === 'future-small';
        const indicator = mapCheckpointStatusToIndicator(
          timelineStepTypeToCheckpointStatus(step.stepType)
        );
        const showConfirmationRing =
          !!onchainConfirmationProgress &&
          (!!step.confirmationRing || (isOnchainMint && step.state === MintQuoteState.PAID));
        const { dotDelayMs, lineDelayMs } = rowDelays(index);
        return {
          row: index,
          id: step.id,
          rowKey: step.rowKey,
          state: step.state,
          stepType: step.stepType,
          label: step.displayLabel,
          info: step.info ?? null,
          timestamp: step.timestamp ?? null,
          dotPhase: indicator.phase,
          dotResult: indicator.result,
          dotColorRole: step.stepType === 'waiting' ? 'warning' : 'theme-foreground',
          dotPendingColorRole: step.stepType === 'waiting' ? 'warning' : 'muted-rail',
          textColorRole: isFutureState
            ? 'foreground-50'
            : step.stepType === 'expired'
              ? 'danger'
              : step.stepType === 'waiting' ||
                  step.stepType === 'already-spent' ||
                  step.stepType === 'rolled-back'
                ? 'warning'
                : 'foreground',
          isFutureState,
          lineTypeToNext: lineType,
          showConfirmationRing,
          confirmations:
            showConfirmationRing && onchainConfirmationProgress
              ? `${onchainConfirmationProgress.currentConfirmations ?? 'null'}/${onchainConfirmationProgress.requiredConfirmations}`
              : null,
          ringBreathes: showConfirmationRing ? !!onchainConfirmationProgress?.hasPayment : null,
          dotDelayMs,
          lineDelayMs,
        };
      }),
    [timeline, onchainConfirmationProgress, isOnchainMint]
  );
  const rowsSignature = useMemo(() => JSON.stringify(rowsDiag), [rowsDiag]);
  const headerSignature = `${cardLabel}|${statusHeader}|${statusColorType}`;
  const prevRowsRef = useRef<typeof rowsDiag | null>(null);
  const lastLoggedStateRef = useRef<string>('');

  useEffect(() => {
    // The signature gate keeps this to genuine visual changes only (a fresh
    // model identity with identical rows never re-logs).
    const combined = `${rowsSignature}#${headerSignature}`;
    if (lastLoggedStateRef.current === combined) return;
    const prev = prevRowsRef.current;
    lastLoggedStateRef.current = combined;
    prevRowsRef.current = rowsDiag;

    paymentLog.debug('tx.history_timeline.state', {
      entryId,
      entryType: historyEntry.type,
      entryState: String((historyEntry as { state?: unknown }).state ?? ''),
      renderCount: renderCountRef.current,
      firstPaint: prev === null,
      // Row/label FadeIn(220ms) only plays after the initial mount.
      entranceFadesActive: hasMountedRef.current,
      cardLabel,
      statusHeader,
      statusColorType,
      statusHeaderColorRole:
        statusColorType === 'success' ||
        statusColorType === 'error' ||
        statusColorType === 'warning'
          ? statusColorType
          : 'foreground-66',
      expiryBadgeVisible: expiryBadge != null,
      rowCount: rowsDiag.length,
      rows: rowsDiag,
      inputs: {
        hasMeltQuote: !!meltQuote,
        meltQuoteState: meltQuote?.state ?? null,
        meltQuoteExpiry: meltQuote?.expiry ?? null,
        tokenCreated: tokenCreated ?? null,
        nostrSent: nostrSent ?? null,
        isOnchainMint,
        onchainSettledInternally: onchainSettledInternally ?? null,
        onchainConfirmations: onchainConfirmationProgress
          ? {
              current: onchainConfirmationProgress.currentConfirmations,
              required: onchainConfirmationProgress.requiredConfirmations,
              hasPayment: onchainConfirmationProgress.hasPayment,
              hasUnconfirmedPayment: onchainConfirmationProgress.hasUnconfirmedPayment,
              isSatisfied: onchainConfirmationProgress.isSatisfied,
            }
          : null,
      },
    });

    if (!prev) return;
    if (prev.length !== rowsDiag.length) {
      paymentLog.debug('tx.history_timeline.rows_resized', {
        entryId,
        prevCount: prev.length,
        nextCount: rowsDiag.length,
        note: 'added rows FadeIn 220ms, removed rows FadeOut 220ms (opacity only, keyed by rowKey)',
      });
    }
    const maxRows = Math.max(prev.length, rowsDiag.length);
    for (let i = 0; i < maxRows; i++) {
      const before = prev[i];
      const after = rowsDiag[i];
      if (!before && after) {
        paymentLog.debug('tx.history_timeline.row_added', { entryId, ...after });
        continue;
      }
      if (before && !after) {
        paymentLog.debug('tx.history_timeline.row_removed', {
          entryId,
          row: i,
          prevStepType: before.stepType,
          prevLabel: before.label,
        });
        continue;
      }
      if (!before || !after) continue;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
      );
      paymentLog.debug('tx.history_timeline.row_change', {
        entryId,
        row: i,
        changedFields: changed,
        stepType:
          before.stepType === after.stepType
            ? after.stepType
            : `${before.stepType} -> ${after.stepType}`,
        label: before.label === after.label ? after.label : `${before.label} -> ${after.label}`,
        // The label block is keyed by the step's semantic id, so an id change
        // ("pending" -> "rolled-back") remounts it with a 220ms crossfade;
        // info/timestamp-only updates mutate in place.
        labelCrossfade: before.id !== after.id,
        dot: `${before.dotPhase}/${before.dotResult} -> ${after.dotPhase}/${after.dotResult}`,
        lineTypeToNext:
          before.lineTypeToNext === after.lineTypeToNext
            ? after.lineTypeToNext
            : `${before.lineTypeToNext} -> ${after.lineTypeToNext}`,
        info: before.info === after.info ? after.info : `${before.info} -> ${after.info}`,
        confirmations:
          before.confirmations === after.confirmations
            ? after.confirmations
            : `${before.confirmations} -> ${after.confirmations}`,
        textColorRole:
          before.textColorRole === after.textColorRole
            ? after.textColorRole
            : `${before.textColorRole} -> ${after.textColorRole}`,
      });
    }
  }, [
    rowsSignature,
    headerSignature,
    rowsDiag,
    entryId,
    historyEntry,
    cardLabel,
    statusHeader,
    statusColorType,
    expiryBadge,
    meltQuote,
    tokenCreated,
    nostrSent,
    isOnchainMint,
    onchainSettledInternally,
    onchainConfirmationProgress,
  ]);

  const getStatusHeaderColor = () => {
    switch (statusColorType) {
      case 'success':
        return successColor;
      case 'error':
        return dangerColor;
      case 'warning':
        return warningColor;
      default:
        return foreground66;
    }
  };
  const statusHeaderColor = getStatusHeaderColor();

  return (
    <Log name="HistoryEntryTimeline">
      <GradientCard style={styles.card} contentStyle={styles.cardContent}>
        <Text size={11} bold style={[styles.cardLabel, { color: foreground50 }]}>
          {cardLabel}
        </Text>

        <HStack style={{ marginBottom: 16 }} align="center">
          <Text
            size={14}
            heavy
            style={{
              color: statusHeaderColor,
            }}>
            {statusHeader}
          </Text>
          <ExpiryCountdown
            historyEntry={historyEntry}
            meltQuote={meltQuote}
            isOnchainMint={isOnchainMint}
            color={statusHeaderColor}
            entryId={entryId}
          />
        </HStack>

        <View>
          {timeline.map((step, index) => {
            const isLast = index === timeline.length - 1;
            const nextStep = !isLast ? timeline[index + 1] : null;
            const showConfirmationRing = ownsConfirmationRing(step);
            const confirmationProgress =
              showConfirmationRing && onchainConfirmationProgress
                ? {
                    currentConfirmations: onchainConfirmationProgress.currentConfirmations,
                    requiredConfirmations: onchainConfirmationProgress.requiredConfirmations,
                  }
                : undefined;

            return (
              <TimelineRow
                key={step.rowKey}
                step={step}
                index={index}
                isLast={isLast}
                connector={nextStep ? connectorType(step, nextStep) : null}
                hasMounted={hasMountedRef.current}
                confirmationProgress={confirmationProgress}
                segmentedInProgress={onchainConfirmationProgress?.hasPayment}
                entryId={entryId}
              />
            );
          })}
        </View>
      </GradientCard>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
  cardContent: {
    padding: 20,
  },
  cardLabel: {
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
