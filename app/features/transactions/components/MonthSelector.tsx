import { useCallback, useMemo, useRef, useEffect } from 'react';
import { ScrollView, LayoutChangeEvent } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import opacity from 'hex-color-opacity';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, Log } from '@/shared/lib/logger';
import type { MonthItem } from '@/features/transactions/lib/months';

interface MonthTabProps {
  item: MonthItem;
  isSelected: boolean;
  onPress: (monthKey: string) => void;
  showYear?: boolean;
}

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
  months: MonthItem[];
  selectedMonth: string | null;
  onMonthChange: (monthKey: string | null) => void;
  showYear?: boolean;
}

export function MonthSelector({
  months,
  selectedMonth,
  onMonthChange,
  showYear: showYearProp,
}: MonthSelectorProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const itemPositions = useRef<Map<string, number>>(new Map());

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
      <View className="px-4 py-2">
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
