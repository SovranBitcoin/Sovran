/**
 * Loading placeholder for a receive rail: a QR-sized square exactly where
 * PaymentInfo renders its QR (full width minus the hub inset, matching
 * ReceiveHubPlaceholder) plus one card-row skeleton where the info section
 * sits — so the swap to real content shifts nothing. The generic 320px box
 * previously used here matched neither the QR's size nor its position.
 */

import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';

import { ListGroup } from 'heroui-native';

import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { Section } from '@/shared/ui/composed/Section';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { View } from '@/shared/ui/primitives/View/View';

const QR_PLACEHOLDER_HORIZONTAL_INSET = 32;

export function ReceiveRailPlaceholder({ sectionTitle }: { sectionTitle: string }) {
  const { width } = useWindowDimensions();
  const qrFrameSize = Math.max(0, Math.min(width, 600) - QR_PLACEHOLDER_HORIZONTAL_INSET);
  const qrPlaceholderStyle = useMemo(
    () => [styles.qrPlaceholder, { width: qrFrameSize, height: qrFrameSize }],
    [qrFrameSize]
  );

  return (
    <>
      <View style={styles.qrContainer}>
        <Skeleton style={qrPlaceholderStyle} />
      </View>
      <View className="mx-4">
        <Section title={sectionTitle}>
          <GradientCard>
            <ListGroup variant="transparent">
              <ListGroup.Item disabled>
                <ListGroup.ItemPrefix>
                  <Skeleton style={styles.rowIcon} />
                </ListGroup.ItemPrefix>
                <ListGroup.ItemContent>
                  <Skeleton style={styles.rowLine} />
                </ListGroup.ItemContent>
                <ListGroup.ItemSuffix>
                  <Skeleton style={styles.rowIcon} />
                </ListGroup.ItemSuffix>
              </ListGroup.Item>
            </ListGroup>
          </GradientCard>
        </Section>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  qrContainer: {
    alignItems: 'center',
  },
  qrPlaceholder: {
    borderRadius: 16,
  },
  rowIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  rowLine: {
    width: '58%',
    height: 18,
    borderRadius: 9,
  },
});
