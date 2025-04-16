import { View } from "react-native";
import { useState, useEffect, useRef } from "react";
import "react-native-gesture-handler";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSelector } from "react-redux";
import { greys } from "helper/colors";
import { memoizedGetTheme } from "helper/redux/settings";

export function VideoScreen({ videoSource, ...props }) {
  const theme = useSelector(memoizedGetTheme);
  const ref = useRef(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const player = useVideoPlayer(videoSource, (player) => {
    player.loop = true;
    // player.play();
  });

  useEffect(() => {
    const subscription = player.addListener("playingChange", (isPlaying) => {
      setIsPlaying(isPlaying);
    });

    return () => {
      subscription.remove();
    };
  }, [player]);

  return (
    <View {...props}>
      <VideoView
        style={{
          width: "100%",
          height: 250,
          marginBottom: 8,
          borderRadius: 8,
          backgroundColor: greys(theme)[1500],
          borderColor: greys(theme)[1300],
          borderWidth: 0.5,
        }}
        ref={ref}
        player={player}
      />
    </View>
  );
}
