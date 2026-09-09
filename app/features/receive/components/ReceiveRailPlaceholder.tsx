/**
 * A receive rail's blank QR card uses the live QR frame, including theme
 * borders and responsive sizing. The copy-card skeleton sizes itself from
 * the real ListGroup typography; only that loading card shimmers.
 */

import { StyleSheet } from 'react-native';
import { PaymentQRCodePlaceholder } from '@/shared/ui/composed/QRCodeFrame';

import { ListGroup } from 'heroui-native';

import { Section } from '@/shared/ui/composed/Section';
import { SkeletonLoadingShimmer } from '@/shared/ui/composed/SkeletonExitShimmer';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { View } from '@/shared/ui/primitives/View/View';

export function ReceiveRailPlaceholder({
  sectionTitle,
  testID,
  qrTestID,
}: {
  sectionTitle: string;
  testID?: string;
  qrTestID?: string;
}) {
  const shimmerSurface = useThemeColor('surface');

  return (
    <View testID={testID}>
      <PaymentQRCodePlaceholder testID={qrTestID} />
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
            <SkeletonLoadingShimmer active highlightColor={shimmerSurface} />
          </Skeleton>
        </Section>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
