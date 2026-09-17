/**
 * @fileoverview The shared body of every mint-quote receive screen.
 *
 * Receiving ecash is one Cashu operation — a NUT-04 mint quote — however the
 * payer settles it. The payload differs (a BOLT11 invoice, a bitcoin address,
 * a `venmo:…` handle) and onchain adds a confirmation timeline, but everything
 * around that payload is identical: the paid/unpaid split, the "Receiving
 * with" mint row, the Cancel/Copy/Share footer, the standard detail rows, and
 * the `mint-quote-id-…` testID the e2e harness anchors on.
 *
 * That shared body lives here, so each method screen is a short statement of
 * what makes IT different:
 *
 *   LightningReceiveScreen  → always bolt11
 *   OnchainReceiveScreen    → always onchain, plus the confirmation timeline
 *   CustomReceiveScreen     → whatever NUT-04 method the mint advertised
 *
 * The shell is presentational: the route resolves the entry (see
 * `useMintQuoteScreen`) and hands it down, so a screen never has to decide
 * whether it is loading, errored, or ready.
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useWindowDimensions } from 'react-native';

import type { MintInfo } from '@cashu/cashu-ts';
import type { MintHistoryEntry } from '@cashu/coco-core';
import { isMintQuotePaymentObserved, type DecoratedEntryFields } from 'wallet';
import type { BoundAction } from 'wallet/react';

import { MintSelector } from '@/features/wallet';
import {
  amountDetailItem,
  HistoryEntryRefresh,
  stateDetailItem,
  TransactionDetailShell,
  TransactionLocationSection,
  transactionLeadDetailItems,
  useBip321Info,
  useIsTransactionHistoryView,
} from '@/features/transactions';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import type { CopyTarget } from '@/shared/lib/popup/popups/copy';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler, type ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { HStack } from '@/shared/ui/primitives/View/HStack';

const QUOTE_CARD_HORIZONTAL_MARGIN = 16;

/** A mint-quote history entry after colada's screen-action decoration. */
export type MintQuoteReceiveEntry = MintHistoryEntry & DecoratedEntryFields;

/** The three actions every mint-quote screen binds. */
export type MintQuoteActions = Record<'copy' | 'share' | 'back', BoundAction>;

/**
 * What the route resolved. Every method screen takes exactly this, so they are
 * interchangeable from the route's point of view.
 */
export interface MintQuoteScreenProps {
  entry: MintQuoteReceiveEntry;
  actions: MintQuoteActions;
  source: string | null;
  mintUrl?: string;
  mintInfo: MintInfo | null;
  extraButtons?: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}

/** A row in the details list; `null`/`false` gaps are dropped by DetailsSection. */
type DetailRow = { title: string; value: ReactNode } | null | false | '' | undefined;

interface MintQuoteReceiveShellProps extends MintQuoteScreenProps {
  /** Component identity for the detail shell and lifecycle logging. */
  screenName: string;
  /** Log-event prefix for this rail, e.g. `'receive.lightning'`. */
  logScope: string;
  /**
   * The payload the payer acts on, and how to present it.
   *
   * `label` captions the QR card, so it must name the method truthfully — a
   * `venmo:…` handle captioned "Lightning" is a lie the user acts on.
   * `copyTarget` picks the confirmation toast and, through it, the e2e probe id.
   */
  payment: { label: string; value: string; copyTarget: CopyTarget };
  /**
   * Which BIP-321 method icon to render as used. Omitted when the quote's
   * method is none of them — a custom method matches no icon, and highlighting
   * one would misreport how the payment was made.
   */
  usedKind?: 'lightning' | 'ecash' | 'onchain';
  /**
   * Rows appended after the shared ones (ID, source/format, amount, state).
   * Each screen states its own tail in full — including the Mint row — because
   * the order and the treatment differ per method: the Lightning Quote ID is
   * copyable and the onchain one deliberately is not.
   */
  detailRows?: DetailRow[];
  /** Rail-specific timeline block (onchain confirmations). */
  timeline?: ReactNode;
  /** Extra render-log fields for this rail. */
  logFields?: Record<string, unknown>;
}

export function MintQuoteReceiveShell({
  screenName,
  logScope,
  entry,
  actions,
  source,
  mintUrl,
  mintInfo,
  payment,
  usedKind,
  detailRows = [],
  timeline,
  extraButtons = [],
  onRequestMintList,
  logFields,
}: MintQuoteReceiveShellProps) {
  useLifecycleLogger(screenName);
  const { width: windowWidth } = useWindowDimensions();
  const historyEntry = asHistoryEntry(entry);
  const bip321 = useBip321Info(entry.id);
  const isPaid = isMintQuotePaymentObserved(entry);
  // Opened from the transactions (history) list rather than the live receive
  // flow — the mint is fixed, so show the read-only "Receiving with" row.
  const isHistoryView = useIsTransactionHistoryView();
  const quoteCardWidth = Math.max(0, windowWidth - QUOTE_CARD_HORIZONTAL_MARGIN * 2);

  useEffect(() => {
    paymentLog.debug(`${logScope}.screen.render`, {
      state: entry.state,
      amount: entry.amount,
      unit: entry.unit,
      isPaid,
      source,
      hasMintUrl: !!mintUrl,
      hasMintInfo: !!mintInfo,
      paymentLabel: payment.label,
      paymentValueLength: payment.value?.length ?? 0,
      bip321: bip321.isBip321,
      optionKindCount: bip321.optionKinds?.length ?? 0,
      extraButtonCount: extraButtons.length,
      actionNames: Object.keys(actions),
      ...logFields,
    });
  }, [
    actions,
    bip321.isBip321,
    bip321.optionKinds?.length,
    entry.amount,
    entry.state,
    entry.unit,
    extraButtons.length,
    isPaid,
    logFields,
    logScope,
    mintInfo,
    mintUrl,
    payment.label,
    payment.value?.length,
    source,
  ]);

  const logPress = (action: 'back' | 'copy' | 'share') =>
    paymentLog.info(`${logScope}.action.press`, { action, state: entry.state, isPaid });

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: isPaid ? 'Close' : 'Cancel',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: () => {
                logPress('back');
                return actions.back.execute();
              },
              condition: actions.back.available,
            },
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: () => {
                logPress('copy');
                return actions.copy.execute();
              },
              condition: actions.copy.available,
            },
            {
              text: 'Share',
              icon: 'ri:share-fill',
              variant: 'secondary',
              onPress: () => {
                logPress('share');
                return actions.share.execute();
              },
              condition: actions.share.available,
            },
            ...extraButtons.map((button) => ({ ...button, condition: !isPaid })),
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <TransactionDetailShell
      screenName={screenName}
      testID={`mint-quote-id-${entry.id}`}
      entry={historyEntry}
      source={source}
      footer={bottomButtons}
      beforeStatus={
        <>
          {!isPaid && (
            <PaymentInfo
              data={[{ name: payment.label, value: payment.value }]}
              unit={entry.unit}
              copyTarget={payment.copyTarget}
            />
          )}
          {isPaid && <TransactionLocationSection transactionId={entry.id} />}
        </>
      }
      statusRow={
        <>
          {!isPaid && !isHistoryView ? (
            <MintSelector
              testID="quote-mint-selector"
              width={quoteCardWidth}
              unit={entry.unit}
              selectedMintUrl={mintUrl}
              onRequestMintList={onRequestMintList}
            />
          ) : mintInfo ? (
            <HistoryEntryRefresh mintInfo={mintInfo} historyEntry={historyEntry} />
          ) : null}
          {entry.metadata?.memo && <Card message={entry.metadata.memo} variant="info" />}
        </>
      }
      timeline={timeline}>
      <DetailsSection
        items={[
          entry.id && { title: 'ID', value: entry.id },
          ...transactionLeadDetailItems({
            source,
            bip321,
            usedKind,
            createdAt: entry.createdAt.datetime,
          }),
          amountDetailItem({ amount: entry.amount, unit: entry.unit }),
          stateDetailItem(entry.state),
          ...detailRows,
        ]}
      />
    </TransactionDetailShell>
  );
}
