import { useSelector } from 'react-redux';
import { StyleSheet, ScrollView } from 'react-native';
import { Text, View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { memoizedGetTheme } from 'helper/redux/settings';
import { sovran } from 'components/layout/sheets/mints';

export function Tabs({ tabs, amounts, selectedTab, handleTabPress }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  return (
    <ScrollView
      style={{
        backgroundColor: 'transparent',
        marginBottom: 0,
        marginTop: 0,
        overflow: 'visible',
        width: '100%',
      }}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[
        styles.tabContainer,
        {
          width: '100%',
        },
      ]}>
      <View
        style={[
          {
            flexDirection: 'row',
            width: '100%',
            minWidth: '100%',
          },
          sovran.listItem,
          {
            padding: 2,
            borderRadius: 24,
          },
        ]}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            key={tab}
            style={[
              styles.tabButton,
              {
                flex: 1,
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
              },
              selectedTab === tab && styles.selectedTabButton,
            ]}
            onPress={() => handleTabPress(tab, index)}>
            <Text style={[styles.tabText, selectedTab === tab && styles.selectedTabText]}>
              {tab}
            </Text>
            {amounts && amounts[index] ? (
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

const createStyles = (theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: 'black',
      flexDirection: 'column',
      margin: 0,
      flex: 1,
    },
    tabContainer: {
      flexDirection: 'row',
      backgroundColor: 'transparent',
    },
    tabButton: {
      padding: 10,
      fontFamily: 'OverpassHeavy',
      borderRadius: 24,
    },
    selectedTabButton: {
      backgroundColor: greys(theme)[1300],
      borderWidth: 0,
      borderRadius: 1000,
      borderColor: greys(theme)[1300],
    },
    tabText: {
      color: greys(theme)[200],
      fontFamily: 'OverpassSemibold',
      fontSize: 14,
      textAlign: 'center',
    },
    selectedTabText: {
      color: greys(theme)[0],
      fontFamily: 'OverpassHeavy',
    },
  });
