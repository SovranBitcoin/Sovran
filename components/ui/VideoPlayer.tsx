import React, { useState, useEffect, useRef } from 'react';
import 'react-native-gesture-handler';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useTheme } from 'providers/ThemeProvider';

interface VideoScreenProps {
  videoSource: any; // Accept the require() result directly
  style?: Record<string, any>;
  muted?: boolean;
}

export function VideoScreen({ videoSource, style, muted = false }: VideoScreenProps) {
  const { getPrimaryColor } = useTheme();
  const ref = useRef(null);
  const [, setIsPlaying] = useState(true);
  const player = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
    player.muted = muted;
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
        ...(style || {}),
      }}
      ref={ref}
      player={player}
    />
  );
}
