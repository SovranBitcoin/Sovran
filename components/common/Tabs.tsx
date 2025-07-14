import React, { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { ScrollView } from 'react-native';
import { Text } from 'components/common/Text';
import { View } from 'components/common/View';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { sovran } from 'components/layout/sheets/mints';

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
        backgroundColor: 'transparent',
        marginBottom: 0,
        marginTop: 0,
        overflow: 'visible',
      }}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      onContentSizeChange={(w) => setContentWidth(w)}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        flexDirection: 'row',
        backgroundColor: 'transparent',
        width: isScrollable ? undefined : '100%',
      }}>
      <View
        blur
        style={[
          sovran(theme).listItem,
          {
            flexDirection: 'row',
            width: isScrollable ? undefined : '100%',
            minWidth: isScrollable ? undefined : '100%',
            padding: 2,
            borderRadius: 24,
          },
        ]}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            style={{
              flex: isScrollable ? 0 : 1,
            }}
            key={tab}
            onPress={() => onTabPress(tab, index)}>
            <View
              blur={selectedTab === tab}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 24,
                flexShrink: 0,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                ...(selectedTab === tab && {
                  backgroundColor: greys(theme)[600],
                  borderWidth: 0,
                  borderRadius: 1000,
                  borderColor: greys(theme)[600],
                }),
              }}>
              <Text
                style={{
                  color: selectedTab === tab ? greys(theme)[0] : greys(theme)[100],
                  fontFamily: selectedTab === tab ? 'OverpassHeavy' : 'OverpassSemibold',
                  fontSize: 14,
                  textAlign: 'center',
                }}>
                {tab}
              </Text>
              {amounts?.[index] ? (
                <Text
                  style={{
                    marginLeft: 4,
                    fontSize: 12,
                    fontFamily: 'OverpassBold',
                    color: greys(theme)[300],
                  }}>
                  {`(${amounts[index]})`}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
