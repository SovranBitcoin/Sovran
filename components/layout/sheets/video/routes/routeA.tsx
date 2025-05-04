import React from 'react';
import { View, Button } from 'react-native';
import { RouteScreenProps, useSheetRef, useSheetRouteParams } from 'react-native-actions-sheet';
import { useVideoPlayer, VideoView } from 'expo-video';
import { VideoScreen } from 'app/ProfilePage/VideoPlayer';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';

const RouteA = ({ router }: RouteScreenProps<'video-sheet', 'route-a'>) => {
  // when data is passed from .show() method, it will be available in the payload
  const ref = useSheetRef('mint-adder');
  const theme = useSelector(memoizedGetTheme);

  return <VideoScreen videoSource="assets/videos/redeem.mp4" />;
};

export default RouteA;
