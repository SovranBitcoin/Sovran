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

const CATEGORIES = ['Static'];

const images = {
  Glow: ['bg.png'],
  Lava: ['bg2.png'],
  Lights: ['bg3.png'],
  Snake: ['bg4.png'],
  Static: [
    'bg5.png',
    'bg6.png',
    'bg7.png',
    'bg8.png',
    'bg9.png',
    'bg10.png',
    'bg11.gif',
    'bg12.png',
    'bg14.png',
  ],
};

export default function BackgroundImageSettings() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useNavigation();
  const { setBackgroundImage } = useSettings();
  const current = useSelector(memoizedGetBackgroundImage);
  const [tab, setTab] = useState(CATEGORIES[0]);
  const styles = createStyles(theme);

  const width = (Dimensions.get('window').width - 48) / 2;
  const height = width / 2;

  const sources: Record<string, any> = {
    'bg.png': require('assets/images/backgrounds/bg.png'),
    'bg2.png': require('assets/images/backgrounds/bg2.png'),
    'bg3.png': require('assets/images/backgrounds/bg3.png'),
    'bg4.png': require('assets/images/backgrounds/bg4.png'),
    'bg5.png': require('assets/images/backgrounds/bg5.png'),
    'bg6.png': require('assets/images/backgrounds/bg6.png'),
    'bg7.png': require('assets/images/backgrounds/bg7.png'),
    'bg8.png': require('assets/images/backgrounds/bg8.png'),
    'bg9.png': require('assets/images/backgrounds/bg9.png'),
    'bg10.png': require('assets/images/backgrounds/bg10.png'),

    'bg11.gif': require('assets/images/backgrounds/bg11.gif'),
    'bg12.png': require('assets/images/backgrounds/bg12.png'),

    'bg14.png': require('assets/images/backgrounds/bg14.png'),
  };

  return (
    <Container>
      <Tabs tabs={CATEGORIES} selectedTab={tab} handleTabPress={setTab} />
      <ScrollView contentContainerStyle={styles.gridContainer}>
        {images[tab]?.map((img) => (
          <Pressable
            key={img}
            style={[styles.imageWrapper, { width, height }]}
            onPress={() => {
              setBackgroundImage(img);
              navigation.goBack();
            }}>
            <Image
              source={sources[img]}
              style={[StyleSheet.absoluteFillObject, { borderRadius: 8 }]}
            />
            {current === img && (
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
    selectedText: {
      color: greys(theme)[0],
      fontFamily: 'OverpassBold',
    },
  });
