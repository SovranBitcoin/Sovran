/**
 * What this ecash can and cannot do, on the screen where it still matters.
 *
 * The timeline owns the short explanation; technical fields join the
 * transaction's existing Details disclosure.
 */

import React, { useMemo } from 'react';

import { formatDate } from '@/shared/lib/date';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { MiddleEllipsisValue } from '@/shared/ui/composed/MiddleEllipsisValue';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import type { SpendingConditions } from 'wallet';

import { describeSpendingConditionsCopy, withDate } from '../lib/spendingConditionsCopy';

interface SpendingConditionsCardProps {
  conditions: SpendingConditions | null;
  /** Display name for whoever holds the lock key, when we know one. */
  recipientName?: string | null;
  /** False when the lock key was our assumption rather than their claim. */
  confirmedRecipient?: boolean;
}

export function SpendingConditionsCard({
  conditions,
  recipientName = null,
  confirmedRecipient = true,
}: SpendingConditionsCardProps): React.ReactElement | null {
  const copy = useMemo(
    () =>
      conditions
        ? describeSpendingConditionsCopy({
            conditions,
            recipientName,
            confirmedRecipient,
          })
        : null,
    [conditions, recipientName, confirmedRecipient]
  );

  if (!conditions || !copy) return null;

  const date = copy.dateMs ? formatDate(copy.dateMs, 'short-date-time') : '';
  const body = copy.body.map((line) => withDate(line, date)).join(' ');

  return (
    <View testID="send-token-spending-conditions">
      <Text size={12} color="muted">
        {body}
      </Text>
    </View>
  );
}

export function spendingConditionDetailItems(
  conditions: SpendingConditions | null
): React.ComponentProps<typeof DetailsSection>['items'] {
  if (!conditions || conditions.kind === 'unlocked') return [];
  return [
    conditions.mixed && {
      title: 'Conditions shown',
      value: 'First locked part; other parts may have different conditions',
    },
    // Keys are shown, not summarised: "locked to Alice" is our reading
    // of a key, and the key is the thing the mint will actually check.
    ...(conditions.main?.pubkeys ?? []).map((key, index) => ({
      title: index === 0 ? 'Locked to' : 'Or to',
      value: <MiddleEllipsisValue value={key} />,
    })),
    (conditions.main?.requiredSignatures ?? 1) > 1 && {
      title: 'Signatures needed',
      value: `${conditions.main?.requiredSignatures} of ${conditions.main?.pubkeys.length}`,
    },
    conditions.unlockAt != null && {
      title: 'Unlocks',
      value: formatDate(conditions.unlockAt, 'short-date-time'),
    },
    // An absent refund list is not an empty one, and the difference is
    // who gets the money afterwards.
    conditions.unlockAt != null &&
      conditions.refund === null && {
        title: 'After that',
        value: 'Anyone holding the token can redeem it',
      },
    ...(conditions.refund?.pubkeys ?? []).map((key, index) => ({
      title: index === 0 ? 'Can be reclaimed by' : 'Or by',
      value: <MiddleEllipsisValue value={key} />,
    })),
    (conditions.refund?.requiredSignatures ?? 1) > 1 && {
      title: 'Reclaim signatures',
      value: `${conditions.refund?.requiredSignatures} of ${conditions.refund?.pubkeys.length}`,
    },
    conditions.sigFlag === 'SIG_ALL' && {
      title: 'Signature flag',
      value: 'SIG_ALL',
    },
    conditions.mixed && {
      title: 'Locked parts',
      value: `${conditions.lockedProofCount} of ${conditions.proofCount}`,
    },
    conditions.unknownTags.length > 0 && {
      title: 'Not understood',
      value: conditions.unknownTags.join(', '),
    },
  ];
}
