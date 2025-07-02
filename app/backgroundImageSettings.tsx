import React, { useState } from 'react';
import { useNavigation } from 'expo-router';
import { useSelector } from 'react-redux';
import { StyleSheet, Pressable, Dimensions, ScrollView } from 'react-native';
import Container from 'components/layout/Container';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { Tabs } from 'components/common/Tabs';
import { memoizedGetTheme, useSettings, memoizedGetBackgroundImage } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import Image from 'components/common/Image';
import { BACKGROUND_IMAGES, BackgroundImageMeta } from 'helper/backgroundImages';

const categories = Array.from(
  new Set(Object.values(BACKGROUND_IMAGES).map((b) => b.category))
);

const imagesByCategory: Record<string, BackgroundImageMeta[]> = categories.reduce(
  (acc, category) => {
    acc[category] = Object.values(BACKGROUND_IMAGES).filter(
      (b) => b.category === category
    );
    return acc;
  },
  {} as Record<string, BackgroundImageMeta[]>
);

export default function BackgroundImageSettings() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const { setBackgroundImage } = useSettings();
  const current = useSelector(memoizedGetBackgroundImage);
  const [tab, setTab] = useState(categories[0]);
  const styles = createStyles(theme);

  const width = (Dimensions.get('window').width - 48) / 2;
  const height = width / 2;


  return (
    <Container>
      <Tabs tabs={categories} selectedTab={tab} handleTabPress={setTab} />
      <ScrollView contentContainerStyle={styles.gridContainer}>
        {imagesByCategory[tab]?.map((img) => (
          <Pressable
            key={img.id}
            style={[styles.imageWrapper, { width, height }]}
            onPress={() => {
              setBackgroundImage(img.id);
              navigation.goBack();
            }}>
            <Image
              source={img.source}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 8 }]}
            />
            <View style={styles.label}>
              <Text style={styles.nameText}>{img.name}</Text>
            </View>
            {current === img.id && (
              <View style={styles.overlay}>
                <Text style={styles.selectedText}>Selected</Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </Container>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    gridContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      padding: 16,
    },
    imageWrapper: {
      marginBottom: 16,
      borderRadius: 8,
      overflow: 'hidden',
    },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      paddingVertical: 2,
      backgroundColor: 'rgba(0,0,0,0.4)',
      alignItems: 'center',
    },
    nameText: {
      color: greys(theme)[0],
      fontSize: 12,
    },
    selectedText: {
      color: greys(theme)[0],
      fontFamily: 'OverpassBold',
    },
  });
