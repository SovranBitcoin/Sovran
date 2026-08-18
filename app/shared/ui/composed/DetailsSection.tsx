import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Log } from '@/shared/lib/logger';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Text } from '@/shared/ui/primitives/Text';
import { DetailsList } from '@/shared/ui/composed/DetailsList';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import Icon from 'assets/icons';

interface SectionItem {
  title: string;
  value: React.ReactNode;
  direction?: 'row' | 'column';
  align?: 'left' | 'right';
}

interface DetailsSectionProps {
  items: SectionItem[];
  /** Label for the toggle button (default: "Details") */
  label?: string;
  /** Whether to start expanded (default: false) */
  initialExpanded?: boolean;
  /** Camera mode for BlurView (default: false) */
  camera?: boolean;
}

/**
 * A collapsible section for showing advanced/technical transaction details.
 * Collapsed by default to keep screens clean and simple.
 */
export function DetailsSection({
  items,
  label = 'Details',
  initialExpanded = false,
  camera = false,
}: DetailsSectionProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const foreground = useThemeColor('foreground');

  // Don't render if there are no items
  if (items.length === 0) return null;

  return (
    <Log name="DetailsSection">
      <View style={styles.container}>
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={styles.toggle}
          hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded }}>
          <HStack align="center" gap={6}>
            <Icon
              name={expanded ? 'mdi:chevron-down' : 'mdi:chevron-right'}
              color={withAlpha(foreground, 0.5)}
              size={18}
            />
            <Text size={14} bold style={{ color: withAlpha(foreground, 0.5) }}>
              {label}
            </Text>
          </HStack>
        </Pressable>
        {expanded ? (
          <DetailsList items={items} camera={camera} gradient style={{ marginHorizontal: 0 }} />
        ) : null}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    gap: 8,
  },
  toggle: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
