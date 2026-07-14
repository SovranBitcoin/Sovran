import React from 'react';
import { StyleSheet } from 'react-native';

import { View } from '@/shared/ui/primitives/View/View';
import {
  createTransactionProbe,
  serializeTransactionProbe,
  type TransactionProbeEntry,
} from '@/features/transactions/lib/transactionProbe';

export function TransactionProbe({
  entry,
  source,
  transactionId,
}: {
  entry: TransactionProbeEntry;
  source?: string | null;
  transactionId: string;
}): React.ReactElement {
  const probe = React.useMemo(() => createTransactionProbe(entry, source), [entry, source]);
  const accessibilityValue = React.useMemo(
    () => ({ text: serializeTransactionProbe(entry, source) }),
    [entry, source]
  );
  return (
    <View
      testID={`transaction-probe-${transactionId}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${probe.direction === 'out' ? 'Outgoing' : 'Incoming'} ${probe.amount} ${probe.unit} transaction, ${probe.status}`}
      accessibilityValue={accessibilityValue}
      importantForAccessibility="yes"
      collapsable={false}
      pointerEvents="none"
      style={styles.probe}
    />
  );
}

const styles = StyleSheet.create({
  probe: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
});
