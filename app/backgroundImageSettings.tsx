import React, { useState } from 'react';
import { useNavigation } from 'expo-router';
import { useSelector } from 'react-redux';
import { Pressable, Dimensions, ScrollView } from 'react-native';
import Container from 'components/layout/Container';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { Tabs } from 'components/common/Tabs';
import { memoizedGetTheme, useSettings, memoizedGetBackgroundImage } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import Image from 'components/common/Image';
import { BACKGROUND_IMAGES, BackgroundImageMeta } from 'helper/backgroundImages';

const categories = Array.from(new Set(Object.values(BACKGROUND_IMAGES).map((b) => b.category)));

const imagesByCategory: Record<string, BackgroundImageMeta[]> = categories.reduce(
  (acc, category) => {
    acc[category] = Object.values(BACKGROUND_IMAGES).filter((b) => b.category === category);
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

  const width = (Dimensions.get('window').width - 48) / 2;
  const height = width / 2;

  return (
    <Container>
      <Tabs tabs={categories} selectedTab={tab} handleTabPress={setTab} />
      <ScrollView contentContainerClassName="flex-row flex-wrap justify-between p-4">
        {imagesByCategory[tab]?.map((img) => (
          <Pressable
            key={img.id}
            style={{ width, height }}
            className="mb-4 overflow-hidden rounded-lg"
            onPress={() => {
              setBackgroundImage(img.id);
              navigation.goBack();
            }}>
            <Image
              source={img.source}
              style={{
                borderRadius: 8,
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />
            <View
              className="absolute bottom-0 left-0 right-0 items-center py-0.5"
              style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
              <Text className="text-xs" style={{ color: greys(theme)[0] }}>
                {img.name}
              </Text>
            </View>
            {current === img.id && (
              <View
                className="absolute inset-0 items-center justify-center"
                style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
                <Text
                  className="font-bold"
                  style={{ color: greys(theme)[0], fontFamily: 'OverpassBold' }}>
                  Selected
                </Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </Container>
  );
}
