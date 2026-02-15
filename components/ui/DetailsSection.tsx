import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import { Section } from 'components/ui/Section';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
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
  const { getPrimaryColor } = useTheme();

  // Don't render if there are no items
  if (items.length === 0) return null;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={styles.toggle}
        hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}>
        <HStack align="center" gap={6}>
          <Icon
            name={expanded ? 'mdi:chevron-down' : 'mdi:chevron-right'}
            color={opacity(getPrimaryColor('0'), 0.5)}
            size={18}
          />
          <Text size={14} bold style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
            {label}
          </Text>
        </HStack>
      </Pressable>
      {expanded ? <Section items={items} camera={camera} style={{ marginHorizontal: 0 }} /> : null}
    </View>
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
