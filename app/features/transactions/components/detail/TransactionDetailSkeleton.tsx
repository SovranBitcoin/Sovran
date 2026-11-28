import React from 'react';

import { Screen } from '@/shared/ui/composed/Screen';
import { Surface } from '@/shared/ui/composed/Surface';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { View } from '@/shared/ui/primitives/View/View';

/** `TransactionDetailShell`'s frame and spine (header, mint card, timeline) at
 *  their rendered sizes, drawn until the entry resolves. */
export function TransactionDetailSkeleton({
  screenName,
  label,
}: {
  screenName: string;
  /** Spoken while loading. */
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
        <View className="flex-row items-center justify-between px-4">
          <View className="gap-1.5">
            <Skeleton className="h-10 w-40 rounded-lg" />
            <Skeleton className="h-4 w-24 rounded-md" />
          </View>
          <Skeleton className="h-12 w-12 rounded-full" />
        </View>
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
