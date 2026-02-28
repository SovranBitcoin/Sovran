/**
 * @fileoverview Month Selector Component (Revolut-style)
 *
 * Horizontal scrollable month tabs for filtering transactions by month.
 * Automatically derives available months from transaction history data.
 */

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { ScrollView, LayoutChangeEvent } from 'react-native';
import { Text } from 'components/ui/Text';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HistoryEntry } from 'coco-cashu-core';
import { useThemeColor } from 'hooks/useThemeColor';

interface MonthItem {
  /** Month key in format "YYYY-MM" */
  key: string;
  /** Display label (e.g., "November") */
  label: string;
  /** Full label with year (e.g., "November 2024") */
  fullLabel: string;
  /** Year number */
  year: number;
  /** Month number (0-11) */
  month: number;
}

interface MonthTabProps {
  item: MonthItem;
  isSelected: boolean;
  onPress: (monthKey: string) => void;
  showYear?: boolean;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function MonthTab({ item, isSelected, onPress, showYear }: MonthTabProps) {
  const [foreground, surfaceSecondary] = useThemeColor(['foreground', 'surface-secondary'] as const);

  const handlePress = useCallback(() => {
    onPress(item.key);
  }, [item.key, onPress]);

  return (
    <TouchableOpacity onPress={handlePress}>
      <View
        className="shrink-0 flex-row items-center justify-center rounded-2xl px-4 py-2"
        style={{
          backgroundColor: isSelected ? surfaceSecondary : 'transparent',
          marginRight: 8,
        }}>
        <Text
          className="text-center"
          style={{
            color: isSelected ? foreground : opacity(foreground, 0.4),
            fontFamily: 'OverpassSemibold',
            fontSize: 15,
          }}>
          {showYear ? item.fullLabel : item.label}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

interface MonthSelectorProps {
  /** Transaction history to derive months from */
  history: HistoryEntry[];
  /** Currently selected month key (format: "YYYY-MM") or null for all */
  selectedMonth: string | null;
  /** Callback when month selection changes */
  onMonthChange: (monthKey: string | null) => void;
  /** Whether to show year in month labels when months span multiple years */
  showYear?: boolean;
}

/**
 * Extracts unique months from transaction history, sorted descending (newest first)
 */
function extractMonthsFromHistory(history: HistoryEntry[]): MonthItem[] {
  const monthsMap = new Map<string, MonthItem>();

  history.forEach((entry) => {
    const date = new Date(entry.createdAt);
    const year = date.getFullYear();
    const month = date.getMonth();
    const key = `${year}-${String(month + 1).padStart(2, '0')}`;

    if (!monthsMap.has(key)) {
      monthsMap.set(key, {
        key,
        label: MONTH_NAMES[month],
        fullLabel: `${MONTH_NAMES[month]} ${year}`,
        year,
        month,
      });
    }
  });

  // Sort by date descending (newest first)
  return Array.from(monthsMap.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
}

export function MonthSelector({
  history,
  selectedMonth,
  onMonthChange,
  showYear: showYearProp,
}: MonthSelectorProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const itemPositions = useRef<Map<string, number>>(new Map());

  const months = useMemo(() => extractMonthsFromHistory(history), [history]);

  // Determine if we should show years (when months span multiple years)
  const showYear = useMemo(() => {
    if (showYearProp !== undefined) return showYearProp;
    const years = new Set(months.map((m) => m.year));
    return years.size > 1;
  }, [months, showYearProp]);

  // Auto-select current month if nothing is selected and we have months
  useEffect(() => {
    if (selectedMonth === null && months.length > 0) {
      // Select the most recent month by default
      onMonthChange(months[0].key);
    }
  }, [months, selectedMonth, onMonthChange]);

  const handleMonthPress = useCallback(
    (monthKey: string) => {
      onMonthChange(monthKey);
    },
    [onMonthChange]
  );

  const handleItemLayout = useCallback(
    (monthKey: string) => (event: LayoutChangeEvent) => {
      itemPositions.current.set(monthKey, event.nativeEvent.layout.x);
    },
    []
  );

  // Scroll to selected month when it changes
  useEffect(() => {
    if (selectedMonth && scrollViewRef.current) {
      const position = itemPositions.current.get(selectedMonth);
      if (position !== undefined) {
        // Center the selected item
        scrollViewRef.current.scrollTo({ x: Math.max(0, position - 100), animated: true });
      }
    }
  }, [selectedMonth]);

  if (months.length === 0) {
    return null;
  }

  return (
    <View
      style={{
        paddingVertical: 8,
        paddingHorizontal: 16,
        backgroundColor: 'transparent',
      }}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingRight: 16,
        }}>
        <HStack align="center">
          {months.map((item) => (
            <View key={item.key} onLayout={handleItemLayout(item.key)}>
              <MonthTab
                item={item}
                isSelected={selectedMonth === item.key}
                onPress={handleMonthPress}
                showYear={showYear}
              />
            </View>
          ))}
        </HStack>
      </ScrollView>
    </View>
  );
}
