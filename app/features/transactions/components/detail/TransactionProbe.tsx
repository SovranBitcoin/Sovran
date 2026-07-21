import React from 'react';
import { Platform, StyleSheet } from 'react-native';

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
  const serialized = React.useMemo(() => serializeTransactionProbe(entry, source), [entry, source]);
  const summary = `${probe.direction === 'out' ? 'Outgoing' : 'Incoming'} ${probe.amount} ${probe.unit} transaction, ${probe.status}`;
  // Android carries the payload in accessibilityLabel (→ content-desc → the
  // ax-adapter's value), matching the working `routeReadyProbe` structure
  // EXACTLY. The catch: a plain-text label surfaces in a uiautomator dump, but a
  // raw JSON label does NOT — the commas/quotes/braces make Android drop the
  // whole content-desc (the probe node came back with no readable payload at
  // all across every unencoded variant). percent-encoding turns it into a
  // special-char-free token (like routeReadyProbe's plain string) that surfaces
  // intact; the ax-adapter decodes it back to JSON. iOS keeps the summary(label)
  // + JSON(accessibilityValue) split, which it reads natively.
  const androidPayload = Platform.OS === 'android' ? encodeURIComponent(serialized) : undefined;
  return (
    <View
      testID={`transaction-probe-${transactionId}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={androidPayload ?? summary}
      accessibilityValue={androidPayload ? undefined : { text: serialized }}
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
