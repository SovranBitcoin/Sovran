/**
 * @fileoverview "Transactions with this person" — embedded per-counterparty list.
 *
 * Rendered at the bottom of transaction detail screens (via TransactionDetailShell)
 * when the entry has a nostr counterparty. Reuses the <Transactions> list in
 * embedded mode, filtered to every other transaction with the same pubkey.
 */

import React, { useMemo } from 'react';
import opacity from 'hex-color-opacity';

import { getCounterparty } from '@sovranbitcoin/colada';

import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';

import { useHistoryWithMelts } from '../hooks/useHistoryWithMelts';
import { Transactions } from './Transactions';

interface CounterpartyTransactionsProps {
  /** Hex nostr pubkey of the counterparty. */
  pubkey: string;
  /** The currently-open transaction id, excluded from the list. */
  excludeId: string;
}

export function CounterpartyTransactions({ pubkey, excludeId }: CounterpartyTransactionsProps) {
  const foreground = useThemeColor('foreground');
  const { history } = useHistoryWithMelts();
  const { metadata } = useNostrProfileMetadata(pubkey);
  const name = resolveIdentityName({ pubkey, nostrProfile: metadata });

  const related = useMemo(
    () => history.filter((e) => getCounterparty(e)?.pubkey === pubkey && e.id !== excludeId),
    [history, pubkey, excludeId]
  );

  if (related.length === 0) return null;

  return (
    <VStack gap={8} style={{ paddingHorizontal: 16, paddingTop: 8 }}>
      <Text
        size={13}
        style={{
          color: opacity(foreground, 0.33),
          fontFamily: 'OxygenBold',
          textTransform: 'uppercase',
          letterSpacing: 1,
        }}>
        With {name}
      </Text>
      <Transactions account={{ unit: 'all' }} showMore embedded tab="All" history={related} />
    </VStack>
  );
}
