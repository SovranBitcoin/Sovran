/**
 * @fileoverview "Transactions with this person" — embedded per-counterparty list.
 *
 * Rendered at the bottom of transaction detail screens (via TransactionDetailShell)
 * when the entry has a nostr counterparty. Reuses the <Transactions> list in
 * embedded mode, filtered to every other transaction with the same pubkey.
 */

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { LinearGradient } from 'expo-linear-gradient';

import { getCounterparty } from 'wallet';

import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { resolveIdentityName } from '@/shared/lib/identity';
import { alpha, fontSize, spacing } from '@/shared/styles/tokens';

import { useHistoryWithMelts } from '../hooks/useHistoryWithMelts';
import { Transactions } from './Transactions';

const RULE_GRADIENT_START = { x: 0, y: 0 };
const RULE_GRADIENT_END = { x: 1, y: 0 };
const ALL_UNITS_ACCOUNT: React.ComponentProps<typeof Transactions>['account'] = { unit: 'all' };

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
  const ruleStrong = opacity(foreground, alpha.soft);
  const ruleFaint = opacity(foreground, alpha.faint);
  const leftRuleColors = useMemo(() => [ruleFaint, ruleStrong] as const, [ruleFaint, ruleStrong]);
  const rightRuleColors = useMemo(() => [ruleStrong, ruleFaint] as const, [ruleFaint, ruleStrong]);
  const headingStyle = useMemo(() => [styles.heading, { color: ruleStrong }], [ruleStrong]);

  const related = useMemo(
    () => history.filter((e) => getCounterparty(e)?.pubkey === pubkey && e.id !== excludeId),
    [history, pubkey, excludeId]
  );

  if (related.length === 0) return null;

  return (
    <VStack gap={spacing.sm} style={styles.container}>
      <HStack align="center" gap={spacing.md}>
        <View style={styles.rule}>
          <LinearGradient
            colors={leftRuleColors}
            start={RULE_GRADIENT_START}
            end={RULE_GRADIENT_END}
            style={styles.ruleFill}
          />
        </View>
        <Text size={fontSize.sm} numberOfLines={2} style={headingStyle}>
          Payments with {name}
        </Text>
        <View style={styles.rule}>
          <LinearGradient
            colors={rightRuleColors}
            start={RULE_GRADIENT_START}
            end={RULE_GRADIENT_END}
            style={styles.ruleFill}
          />
        </View>
      </HStack>
      <Transactions account={ALL_UNITS_ACCOUNT} showMore embedded tab="All" history={related} />
    </VStack>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  heading: {
    flexShrink: 1,
    fontFamily: 'OxygenBold',
    textAlign: 'center',
  },
  rule: {
    flex: 1,
    minWidth: spacing['2xl'],
  },
  ruleFill: {
    height: StyleSheet.hairlineWidth,
  },
});
