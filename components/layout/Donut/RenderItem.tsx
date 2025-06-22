import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { greys } from 'helper/colors';
import { useSelector } from 'react-redux';
import { View } from 'components/common/View';
import { memoizedGetTheme } from 'helper/redux/settings';
import { getMint } from 'helper/cashu/mint';
import Image from 'components/common/Image';

interface RenderItemData {
  color: string;
  percentage: number;
  label: string;
  value: string;
  subtitle?: string;
}

type Props = {
  item: RenderItemData;
  index: number;
};

const RenderItem = ({ item, index }: Props) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const { width } = useWindowDimensions();
  const [iconUrl, setIconUrl] = useState<string | null>(null); // State to store the icon URL

  useEffect(() => {
    const fetchMintInfo = async () => {
      try {
        const mint = await getMint({ mintUrl: item.subtitle });
        const info = await mint.getInfo();

        setIconUrl(info?.icon_url); // Set the icon URL from the mint info
      } catch (error) {}
    };

    fetchMintInfo();
  }, [item.label]); // Ensure useEffect re-runs when item.label changes

  return (
    <Animated.View
      style={[styles.container, { width: width * 0.9 }]}
      entering={FadeInDown.delay(index * 200)}
      exiting={FadeOutDown}>
      <View style={styles.contentContainer}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            backgroundColor: 'transparent',
          }}>
          {/* Render icon if available; otherwise, fallback to the colored circle */}
          {iconUrl ? (
            <Image source={{ uri: iconUrl }} style={styles.icon} />
          ) : (
            <View style={[styles.color, { backgroundColor: item.color }]} />
          )}
          <View
            style={{
              backgroundColor: 'transparent',
              flex: 1,
            }}>
            <Text style={styles.text}>{item.label}</Text>
            {/* {item.subtitle && (
              <Text style={styles.smallText}>{item.subtitle}</Text>
            )} */}
            <View style={styles.rightContainer}>
              <Text style={styles.text}>{item.value}</Text>
              <Text style={styles.smallText}>{item.percentage}%</Text>
            </View>
          </View>
        </View>
      </View>
    </Animated.View>
  );
};

export default RenderItem;

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      paddingVertical: 20,
      marginBottom: 0,
    },
    contentContainer: {
      backgroundColor: 'transparent',
      // flex: 1,
      // flexDirection: "row",
      // justifyContent: "space-between",
    },
    rightContainer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: 'transparent',
      justifyContent: 'space-between',
      flex: 1,
    },
    color: {
      width: 42,
      height: 42,
      borderRadius: 10000,
    },
    icon: {
      width: 42,
      height: 42,
      borderRadius: 21, // Makes the icon circular
    },
    text: {
      fontSize: 16,
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
      marginLeft: 12,
    },
    smallText: {
      fontSize: 16,
      fontFamily: 'OverpassBold',
      color: greys(theme)[100],
      marginLeft: 12,
    },
  });
