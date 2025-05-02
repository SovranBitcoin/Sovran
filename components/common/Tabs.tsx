import React, { useCallback } from 'react';
import { useSelector } from 'react-redux';
import { ScrollView } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { sovran } from 'components/layout/sheets/mints';

interface TabsProps {
  tabs: string[];
  amounts?: number[];
  selectedTab: string;
  handleTabPress: (tab: string, index: number) => void;
}

export function Tabs({ tabs, amounts, selectedTab, handleTabPress }: TabsProps): JSX.Element {
  const theme = useSelector(memoizedGetTheme);

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
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        flexDirection: 'row',
        backgroundColor: 'transparent',
        width: '100%',
      }}>
      <View
        style={[
          sovran(theme).listItem,
          {
            flexDirection: 'row',
            width: '100%',
            minWidth: '100%',
            padding: 2,
            borderRadius: 24,
          },
        ]}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            style={{
              padding: 10,
              borderRadius: 24,
              flex: 1,
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              ...(selectedTab === tab && {
                backgroundColor: greys(theme)[1300],
                borderWidth: 0,
                borderRadius: 1000,
                borderColor: greys(theme)[1300],
              }),
            }}
            onPress={() => onTabPress(tab, index)}>
            <Text
              style={{
                color: selectedTab === tab ? greys(theme)[0] : greys(theme)[200],
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
                  color: greys(theme)[600],
                }}>
                {`(${amounts[index]})`}
              </Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
