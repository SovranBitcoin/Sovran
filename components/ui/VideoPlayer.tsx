import React, { useState, useEffect, useRef } from 'react';
import 'react-native-gesture-handler';
import { useVideoPlayer, VideoView, VideoSource } from 'expo-video';
import { useTheme } from 'providers/ThemeProvider';

interface VideoScreenProps {
  videoSource: VideoSource;
}

export function VideoScreen({ videoSource }: VideoScreenProps) {
  const { getPrimaryColor } = useTheme();
  const ref = useRef(null);
  const [, setIsPlaying] = useState(true);
  const player = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
    player.play();
  });

  useEffect(() => {
    const subscription = player.addListener('playingChange', (event) => {
      setIsPlaying(event.isPlaying);
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  return (
    <VideoView
      style={{
        width: 300,
        height: 300,
        borderRadius: 16,
        marginVertical: 8,
        backgroundColor: getPrimaryColor('700'),
      }}
      ref={ref}
      player={player}
    />
  );
}
