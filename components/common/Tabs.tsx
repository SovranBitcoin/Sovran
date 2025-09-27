import React, { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { ScrollView } from 'react-native';
import { Text } from 'components/common/Text';
import { View, HStack } from 'components/common/View';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { sovran } from 'components/layout/sheets/mints';

interface TabProps {
  tab: string;
  index: number;
  isSelected: boolean;
  amount?: string;
  onPress: (tab: string, index: number) => void;
  isScrollable: boolean;
}

function Tab({ tab, index, isSelected, amount, onPress, isScrollable }: TabProps) {
  const theme = useSelector(memoizedGetTheme);

  const handlePress = useCallback(() => {
    onPress(tab, index);
  }, [tab, index, onPress]);

  return (
    <TouchableOpacity className={isScrollable ? '' : 'flex-1'} key={tab} onPress={handlePress}>
      <View
        blur={isSelected}
        className="shrink-0 flex-row items-center justify-center rounded-3xl px-4 py-2.5"
        style={{
          ...(isSelected && {
            backgroundColor: greys(theme)[600],
            borderWidth: 0,
            borderRadius: 1000,
            borderColor: greys(theme)[600],
          }),
        }}>
        <HStack align="center" spacing={4}>
          <Text
            className="text-center text-sm"
            style={{
              color: isSelected ? greys(theme)[0] : greys(theme)[100],
              fontFamily: isSelected ? 'OverpassHeavy' : 'OverpassSemibold',
            }}>
            {tab}
          </Text>
          {amount ? (
            <Text
              className="text-xs"
              style={{
                fontFamily: 'OverpassBold',
                color: greys(theme)[300],
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
  const theme = useSelector(memoizedGetTheme);
  const [containerWidth, setContainerWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const isScrollable = contentWidth ? contentWidth > containerWidth && containerWidth > 0 : true;

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
      <HStack
        blur
        className="rounded-3xl p-1.5"
        style={[
          sovran(theme).listItem,
          {
            width: isScrollable ? undefined : '100%',
            minWidth: isScrollable ? undefined : '100%',
            borderRadius: 1000,
            padding: 1.5,
          },
        ]}>
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
    </ScrollView>
  );
}
