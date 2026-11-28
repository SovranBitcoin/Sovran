import React from 'react';

import { Screen } from '@/shared/ui/composed/Screen';
import { Surface } from '@/shared/ui/composed/Surface';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { View } from '@/shared/ui/primitives/View/View';

/**
 * What a transaction detail screen draws until its entry resolves: the same
 * `Screen` frame and spine as `TransactionDetailShell` (amount header, mint
 * status card, timeline card, `space.item` apart) at the sizes those parts
 * render at, so the real content lands in place instead of replacing a
 * centred spinner.
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
  return (
    <Screen name={screenName} contentPadding={0} deferContent={false}>
      <View
        className="gap-3"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        testID="transaction-detail-skeleton">
        {/* HistoryEntryHeader: 36pt amount over a 16pt fiat line, 48pt avatar. */}
        <View className="flex-row items-center justify-between px-4">
          <View className="gap-1.5">
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-4 w-24 rounded-md" />
          </View>
          <Skeleton className="h-12 w-12 rounded-full" />
        </View>
        {/* HistoryEntryRefresh: 40pt mint icon, status line, mint name. */}
        <View className="mx-4">
          <Surface>
            <View className="flex-row items-center gap-3 p-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <View className="gap-1.5">
                <Skeleton className="h-4 w-32 rounded-md" />
                <Skeleton className="h-4 w-28 rounded-md" />
              </View>
            </View>
          </Surface>
        </View>
        {/* TimelineCard: label, then the first steps. */}
        <View className="mx-4">
          <Surface>
            <View className="p-5">
              <Skeleton className="mb-4 h-3 w-20 rounded-sm" />
              <View className="gap-4">
                {[0, 1, 2].map((row) => (
                  <View key={row} className="flex-row items-center gap-3">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <Skeleton className="h-4 w-36 rounded-md" />
                  </View>
                ))}
              </View>
            </View>
          </Surface>
        </View>
      </View>
    </Screen>
  );
}
