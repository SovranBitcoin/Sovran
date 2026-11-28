import React from 'react';
import { StyleSheet } from 'react-native';

import { useAppStyle } from '@/shared/styles/appStyle';
import { Screen } from '@/shared/ui/composed/Screen';
import { Surface } from '@/shared/ui/composed/Surface';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

/**
 * What a transaction detail screen draws until its entry resolves: the same
 * `Screen` frame and spine as `TransactionDetailShell` (amount header, mint
 * status card, timeline card) at the sizes those parts render at, so the real
 * content lands in place instead of replacing a centred spinner.
 */
export function TransactionDetailSkeleton({
  screenName,
  label,
}: {
  /** The screen's telemetry name, as `TransactionDetailShell` would get it. */
  screenName: string;
  /** Spoken while loading, e.g. "Loading transaction". */
  label: string;
}): React.ReactElement {
  const style = useAppStyle();
  return (
    <Screen name={screenName} contentPadding={0} deferContent={false}>
      <VStack
        gap={style.space.item}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        testID="transaction-detail-skeleton">
        {/* HistoryEntryHeader: 36pt amount over a 16pt fiat line, 48pt avatar. */}
        <HStack align="center" justify="space-between" className="px-4">
          <VStack gap={6}>
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-4 w-24 rounded-md" />
          </VStack>
          <Skeleton className="h-12 w-12 rounded-full" />
        </HStack>
        {/* HistoryEntryRefresh: 40pt mint icon, status line, mint name. */}
        <Surface style={styles.card}>
          <HStack align="center" gap={12} className="p-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <VStack gap={6}>
              <Skeleton className="h-4 w-32 rounded-md" />
              <Skeleton className="h-4 w-28 rounded-md" />
            </VStack>
          </HStack>
        </Surface>
        {/* TimelineCard: label, then the first steps. */}
        <Surface style={styles.card}>
          <View style={styles.timeline}>
            <Skeleton className="mb-4 h-3 w-20 rounded-sm" />
            <VStack gap={16}>
              {[0, 1, 2].map((row) => (
                <HStack key={row} align="center" gap={12}>
                  <Skeleton className="h-6 w-6 rounded-full" />
                  <Skeleton className="h-4 w-36 rounded-md" />
                </HStack>
              ))}
            </VStack>
          </View>
        </Surface>
      </VStack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 16 },
  timeline: { padding: 20 },
});
