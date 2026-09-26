/**
 * @fileoverview AI request detail screen
 *
 * One pay-per-request AI call, opened from the single row the list shows for
 * it. The row deliberately says very little — it is an ordinary transaction
 * row, dimmed when the money came back — so this is where the two halves are
 * pulled apart:
 *
 *   1. Header: what the answer actually cost (payment minus change).
 *   2. The legs, individually: the token handed to the node, and the remainder
 *      it gave back. Each opens its own transaction detail.
 *   3. Metadata: outcome, model, paid, returned, date.
 *
 * Structure follows `SwapTransactionScreen` — the other view whose subject is a
 * group rather than a single coco entry — so a grouped payment looks like a
 * grouped payment wherever the wallet shows one.
 */

import { useMemo } from 'react';
import type { HistoryEntry } from '@cashu/coco-core';
import { groupAiRequests, type AiRequestGroup, type AiRequestState } from 'wallet';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import { withAlpha } from '@/shared/lib/color';
import { formatAmount } from '@/shared/lib/currency';
import { formatDate } from '@/shared/lib/date';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import { getMintDisplayName } from '@/shared/lib/url';
import { TransferCard, TransferEntryRow, TransferSeparator } from '@/shared/blocks/transfer';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { DetailsList } from '@/shared/ui/composed/DetailsList';
import { Screen } from '@/shared/ui/composed/Screen';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import Icon from 'assets/icons';

import { TransactionDetailShell } from '@/features/transactions/components/detail/TransactionDetailShell';
import { AiConversationSection } from '@/features/transactions/components/detail/AiConversationSection';
import {
  aiRequestAmountSign,
  aiRequestDisplayAmount,
  isAiRequestReturned,
} from '@/features/transactions/lib/aiRequestPresentation';
import { useHistoryWithMelts } from '@/features/transactions';
import { getTransactionActionDirection } from '@/features/transactions/lib/transactionPresentation';
import { useSwapMintInfo } from '../hooks/useSwapMintInfo';

interface Props {
  groupId: string | undefined;
}

/** What the outcome is called, in the same words the row's dimming implies. */
const OUTCOME_LABEL: Record<AiRequestState, string> = {
  pending: 'Pending',
  // A refund is not a rollback: the payment completed, and the node returned
  // it. Saying "Cancelled" here would claim the payment never happened.
  refunded: 'Refunded — the request failed',
  cancelled: 'Cancelled — the payment never went out',
  spent: 'Complete',
};

function LegRow({
  entry,
  mintIconUrl,
  mintName,
}: {
  entry: HistoryEntry;
  mintIconUrl: string | undefined;
  mintName: string;
}) {
  const amount = amountToNumber(entry.amount);
  return (
    <TransferEntryRow
      type={getTransactionActionDirection(entry.type)}
      mintIconUrl={mintIconUrl}
      mintName={mintName}
      amount={amount}
      unit={entry.unit}
      subtitle={entry.createdAt ? formatDate(entry.createdAt, 'short-date-time') : 'Unconfirmed'}
      secondarySubtitle={formatAmount(
        { amount: Math.abs(amount), unit: entry.unit },
        { displayAs: 'usd' }
      )}
      onPress={() => navigateToTransactionDetail(entry, 'ai.request.leg')}
      testID={`ai-request-leg-${entry.type}-${entry.id}`}
    />
  );
}

export function AiRequestScreen({ groupId }: Props) {
  useLifecycleLogger('AiRequestScreen');
  const [foreground, muted, success, danger] = useThemeColor([
    'foreground',
    'muted',
    'success',
    'danger',
  ] as const);
  const { history } = useHistoryWithMelts();

  // Regrouped from live history rather than handed over the route: a leg that
  // settles while this screen is open must change what it says.
  const group: AiRequestGroup | undefined = useMemo(
    () => (groupId ? groupAiRequests(history).find((g) => g.groupId === groupId) : undefined),
    [history, groupId]
  );

  const mintUrls = useMemo(
    () => Array.from(new Set((group?.legs ?? []).map((leg) => leg.mintUrl).filter(Boolean))),
    [group]
  );
  const mintInfoMap = useSwapMintInfo(mintUrls);

  if (!group) {
    return (
      <Screen name="AiRequestScreen">
        <View className="flex-1 items-center justify-center p-5">
          <Text color={withAlpha(foreground, 0.66)}>AI request not found.</Text>
        </View>
      </Screen>
    );
  }

  log.debug('tx.ai.display', {
    state: group.state,
    legCount: group.legs.length,
    netAmount: group.netAmount,
  });

  // A returned request still SENT money. Dimming the header to a neutral grey
  // made it read as "nothing happened here", which is the one reading it must
  // not have: the sats left, and the outcome row below is what says they came
  // back. So it reads like the send it was — the figure that went out, in the
  // danger colour, behind the same `-` the send's own detail header carries.
  const returned = isAiRequestReturned(group);
  const headerAmount = aiRequestDisplayAmount(group);
  const headerSign = aiRequestAmountSign(group);
  const headerColor = returned ? danger : success;
  const fiatAmount = formatAmount(
    { amount: headerAmount, unit: group.unit },
    {
      displayAs: group.unit === 'usd' ? 'sats' : 'usd',
      currencyDisplay: group.unit === 'usd' ? 'name' : 'symbol',
    }
  );

  return (
    <TransactionDetailShell
      screenName="AiRequestScreen"
      testID={`ai-request-id-${group.groupId}`}
      footer={null}>
      <VStack className="gap-3">
        <HStack className="items-center justify-between p-5 pb-0 pt-0">
          <VStack>
            <HStack className="items-center">
              {headerSign ? (
                <Text heavy size={32} color={danger} className="opacity-90">
                  {headerSign}
                </Text>
              ) : null}
              <Spacer size={8} />
              <AmountFormatter
                amount={headerAmount}
                unit={group.unit}
                size={28}
                weight="heavy"
                color={headerColor}
              />
            </HStack>
            <Text overpass size={18} color={withAlpha(foreground, 0.9)} bold>
              {fiatAmount}
            </Text>
          </VStack>

          <View className="scale-125 transform p-4">
            <Icon
              name={returned ? 'mdi:cancel' : 'mdi:robot-outline'}
              size={28}
              color={withAlpha(foreground, 0.9)}
            />
          </View>
        </HStack>

        {/* What the money bought. Silent when the conversation is gone. */}
        <AiConversationSection group={group} />

        {/* The two halves, individually — each opens its own detail. */}
        <View className="mx-4">
          <TransferCard accentColor={muted}>
            {group.legs.map((leg, index) => {
              const info = mintInfoMap[leg.mintUrl];
              return (
                <View key={leg.id}>
                  {index > 0 ? <TransferSeparator /> : null}
                  <LegRow
                    entry={leg}
                    mintIconUrl={info?.icon_url}
                    mintName={getMintDisplayName(leg.mintUrl, info)}
                  />
                </View>
              );
            })}
          </TransferCard>
        </View>

        <DetailsList
          items={[
            { title: 'Outcome', value: OUTCOME_LABEL[group.state] },
            ...(group.model ? [{ title: 'Model', value: group.model }] : []),
            { title: 'Paid', value: `${group.paidAmount} ${group.unit}` },
            ...(group.refundedAmount > 0
              ? [{ title: 'Returned', value: `${group.refundedAmount} ${group.unit}` }]
              : []),
            ...(group.state === 'spent'
              ? [
                  // The number the whole screen exists to show.
                  { title: 'Cost', value: `${group.netAmount} ${group.unit}` },
                ]
              : []),
            { title: 'Date', value: formatDate(group.createdAt, 'short-date-time') },
          ]}
        />
      </VStack>
    </TransactionDetailShell>
  );
}
