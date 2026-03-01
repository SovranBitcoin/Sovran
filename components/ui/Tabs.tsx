import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Text } from 'components/ui/Text';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { useThemeColor } from 'hooks/useThemeColor';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';
import opacity from 'hex-color-opacity';

interface TabProps {
  tab: string;
  index: number;
  isSelected: boolean;
  amount?: string;
  onPress: (tab: string, index: number) => void;
  isScrollable: boolean;
}

function Tab({ tab, index, isSelected, amount, onPress, isScrollable }: TabProps) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  const handlePress = useCallback(() => {
    onPress(tab, index);
  }, [tab, index, onPress]);

  return (
    <TouchableOpacity className={isScrollable ? '' : 'flex-1'} key={tab} onPress={handlePress}>
      <View
        className="shrink-0 flex-row items-center justify-center rounded-3xl px-4 py-2.5"
        style={{
          borderRadius: 1000,
          overflow: 'hidden',
        }}>
        {/* Active state - solid background */}
        {isSelected && (
          <View
            blur
            blurTint="light"
            style={[StyleSheet.absoluteFillObject, { backgroundColor: muted }]}
          />
        )}

        <HStack align="center" spacing={4} style={{ zIndex: 1 }}>
          <Text
            className="text-center text-sm"
            style={{
              color: foreground,
              fontFamily: 'OxygenBold',
            }}>
            {tab}
          </Text>
          {amount ? (
            <Text
              className="text-xs"
              style={{
                fontFamily: 'OxygenBold',
                color: isSelected ? foreground : opacity(foreground, 0.8),
              }}>
              {`(${amount})`}
            </Text>
          ) : null}
        </HStack>
      </View>
    </TouchableOpacity>
  );
}

interface TabsProps {
  tabs: string[];
  amounts?: string[];
  selectedTab: string;
  handleTabPress: (tab: string, index: number) => void;
}

export function Tabs({ tabs, amounts, selectedTab, handleTabPress }: TabsProps) {
  const muted = useThemeColor('muted');
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const isScrollable = contentWidth ? contentWidth > containerWidth && containerWidth > 0 : true;

  const accentColor = useMemo(() => muted, [muted]);
  const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);

  const onTabPress = useCallback(
    (tab: string, index: number) => {
      handleTabPress(tab, index);
    },
    [handleTabPress]
  );

  return (
    <ScrollView
      className="w-full"
      style={{
        marginBottom: 0,
        marginTop: 0,
        overflow: 'visible',
      }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      onContentSizeChange={(w) => setContentWidth(w)}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        width: isScrollable ? undefined : '100%',
      }}>
      <View
        style={[
          {
            borderWidth: 1,
            borderColor,
            marginVertical: 4,
            width: isScrollable ? undefined : '100%',
            minWidth: isScrollable ? undefined : '100%',
            borderRadius: 1000,
            overflow: 'hidden',
          },
        ]}>
        <BlurCardFrame accentColor={accentColor}>
          <HStack
            className="p-1.5"
            style={{
              width: isScrollable ? undefined : '100%',
              minWidth: isScrollable ? undefined : '100%',
              zIndex: 1,
            }}>
            {tabs.map((tab, index) => (
              <Tab
                key={tab}
                tab={tab}
                index={index}
                isSelected={selectedTab === tab}
                amount={amounts?.[index]}
                onPress={onTabPress}
                isScrollable={isScrollable}
              />
            ))}
          </HStack>
        </BlurCardFrame>
      </View>
    </ScrollView>
  );
}
