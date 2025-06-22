import React, { useState, useEffect, useRef } from 'react';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import 'react-native-gesture-handler';
import { useVideoPlayer, VideoSource, VideoView } from 'expo-video';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import Modal from 'components/layout/Modal';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { SheetManager } from 'react-native-actions-sheet';
import { Card } from 'components/common/Card';

const assetId = require('../../assets/videos/redeem.mp4');

const videoSource: VideoSource = {
  assetId,
};

export function VideoScreen() {
  const theme = useSelector(memoizedGetTheme);
  const ref = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const player = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
    player.play();
  });

  useEffect(() => {
    const subscription = player.addListener('playingChange', (isPlaying) => {
      setIsPlaying(isPlaying);
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  return (
    <Modal
      showHeader={false}
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              icon: 'mdi:close',
              variant: 'secondary',
              onPress: () => {
                SheetManager.hide('video-sheet');
              },
            },
          ]}
        />
      }>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: greys(theme)[2300],
          padding: 12,
        }}>
        <Text
          style={{
            fontSize: 24,
            fontFamily: 'OverpassBold',
            color: greys(theme)[0],
            marginBottom: 16,
          }}>
          How to redeem npubx.cash tokens
        </Text>

        <VideoView
          style={{
            width: 300,
            height: 300,
            borderRadius: 16,
            backgroundColor: greys(theme)[1500],
          }}
          ref={ref}
          player={player}
        />
      </View>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: greys(theme)[2300],
          padding: 12,
          paddingTop: 0,
        }}>
        <Card variant="info" message="This will be automated in future versions!" />
      </View>
    </Modal>
  );
}
