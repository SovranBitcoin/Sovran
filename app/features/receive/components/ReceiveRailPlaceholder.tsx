/**
 * Loading placeholder for a receive rail: a QR-sized skeleton square exactly
 * where PaymentInfo renders its QR (full width minus the hub inset) plus ONE
 * full-card skeleton block where the copy card sits — the whole card is
 * skeleton, not a chrome card with skeleton text inside. A thread-reply-style
 * loading shimmer sweeps the entire rail (same `SkeletonLoadingShimmer` the
 * feed's reply skeletons use).
 *
 * The card block self-sizes from an INVISIBLE replica of the real
 * GradientCard row, so the swap to real content shifts nothing even if the
 * ListGroup row height drifts.
 */

import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { ListGroup } from 'heroui-native';

import { Section } from '@/shared/ui/composed/Section';
import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { View } from '@/shared/ui/primitives/View/View';

const QR_PLACEHOLDER_HORIZONTAL_INSET = 32;

export function ReceiveRailPlaceholder({
  sectionTitle,
  testID,
  qrTestID,
}: {
  sectionTitle: string;
  testID?: string;
  qrTestID?: string;
}) {
  const { width } = useWindowDimensions();
  const shimmerSurface = useThemeColor('surface');
  const qrFrameSize = Math.max(0, Math.min(width, 600) - QR_PLACEHOLDER_HORIZONTAL_INSET);
  const qrPlaceholderStyle = useMemo(
    () => [styles.qrPlaceholder, { width: qrFrameSize, height: qrFrameSize }],
    [qrFrameSize]
  );

  return (
    <View testID={testID}>
      <View style={styles.qrContainer}>
        {/* `bg-surface-secondary` overrides the default `bg-skeleton`
            (palette-500 — far brighter than every other skeleton surface),
            matching the fill PaymentInfo's own QR skeleton uses so the hub
            placeholder and the in-rail QR skeleton read as one system. */}
        <Skeleton testID={qrTestID} className="bg-surface-secondary" style={qrPlaceholderStyle} />
      </View>
      <View className="mx-4">
        <Section title={sectionTitle}>
          <Skeleton className="bg-surface-secondary" style={styles.cardBlock}>
            {/* Invisible replica of the real card row — sizes the skeleton
                block to exactly the height the GradientCard row will take. */}
            <View style={styles.cardSizer} pointerEvents="none">
              <ListGroup variant="transparent">
                <ListGroup.Item disabled>
                  <ListGroup.ItemPrefix>
                    <View style={styles.rowIcon} />
                  </ListGroup.ItemPrefix>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>placeholder</ListGroup.ItemTitle>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <View style={styles.rowIcon} />
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </ListGroup>
            </View>
          </Skeleton>
        </Section>
      </View>
      <SkeletonLoadingShimmer active highlightColor={shimmerSurface} />
    </View>
  );
}

const styles = StyleSheet.create({
  qrContainer: {
    alignItems: 'center',
  },
  qrPlaceholder: {
    borderRadius: 16,
  },
  cardBlock: {
    // Same frame as the GradientCard the real row renders in.
    borderRadius: 20,
    overflow: 'hidden',
  },
  cardSizer: {
    opacity: 0,
  },
  rowIcon: {
    width: 20,
    height: 20,
  },
});
