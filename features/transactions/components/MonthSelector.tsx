import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import { ScrollView, LayoutChangeEvent } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HistoryEntry } from '@cashu/coco-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, Log } from '@/shared/lib/logger';

interface MonthItem {
  key: string;
  label: string;
  fullLabel: string;
  year: number;
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
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);

  const handlePress = useCallback(() => {
    log.info('transaction.month.select', { monthKey: item.key, label: item.label });
    onPress(item.key);
  }, [item.key, item.label, onPress]);

  return (
    <Pressable onPress={handlePress}>
      <View
        className="mr-2 shrink-0 flex-row items-center justify-center rounded-2xl px-4 py-2"
        style={{ backgroundColor: isSelected ? surfaceSecondary : 'transparent' }}>
        <Text
          className="text-center"
          style={{
            color: isSelected ? foreground : opacity(foreground, 0.4),
            fontFamily: 'OxygenBold',
            fontSize: 15,
          }}>
          {showYear ? item.fullLabel : item.label}
        </Text>
      </View>
    </Pressable>
  );
}

interface MonthSelectorProps {
  /**
   * Either pass a precomputed `months` array (preferred when the parent also
   * needs to render per-month pages) or pass `history` and let this component
   * derive months internally (backwards-compatible legacy mode).
   */
  months?: MonthItem[];
  history?: HistoryEntry[];
  selectedMonth: string | null;
  onMonthChange: (monthKey: string | null) => void;
  showYear?: boolean;
}

export function extractMonthsFromHistory(history: HistoryEntry[]): MonthItem[] {
  const monthsMap = new Map<string, MonthItem>();

  for (const entry of history) {
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
  }

  return Array.from(monthsMap.values()).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });
}

export function MonthSelector({
  months: monthsProp,
  history,
  selectedMonth,
  onMonthChange,
  showYear: showYearProp,
}: MonthSelectorProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const itemPositions = useRef<Map<string, number>>(new Map());

  // Prefer the explicit prop; fall back to deriving from history so existing
  // callers that pass `history` keep working.
  const months = useMemo(() => {
    if (monthsProp) return monthsProp;
    return extractMonthsFromHistory(history ?? []);
  }, [monthsProp, history]);

  const showYear = useMemo(() => {
    if (showYearProp !== undefined) return showYearProp;
    const years = new Set(months.map((m) => m.year));
    return years.size > 1;
  }, [months, showYearProp]);

  const handleItemLayout = useCallback(
    (monthKey: string) => (event: LayoutChangeEvent) => {
      itemPositions.current.set(monthKey, event.nativeEvent.layout.x);
    },
    []
  );

  useEffect(() => {
    if (selectedMonth && scrollViewRef.current) {
      const position = itemPositions.current.get(selectedMonth);
      if (position !== undefined) {
        scrollViewRef.current.scrollTo({ x: Math.max(0, position - 100), animated: true });
      }
    }
  }, [selectedMonth]);

  if (months.length === 0) return null;

  return (
    <Log name="MonthSelector">
      <View className="bg-transparent px-4 py-2">
        <ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 16 }}>
          <HStack align="center">
            {months.map((item) => (
              <View key={item.key} onLayout={handleItemLayout(item.key)}>
                <MonthTab
                  item={item}
                  isSelected={selectedMonth === item.key}
                  onPress={onMonthChange}
                  showYear={showYear}
                />
              </View>
            ))}
          </HStack>
        </ScrollView>
      </View>
    </Log>
  );
}
