import React from 'react';
import { RouteScreenProps, useSheetRef } from 'react-native-actions-sheet';
import { VideoScreen } from 'app/ProfilePage/VideoPlayer';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

const RouteA = ({ router }: RouteScreenProps<'video-sheet', 'route-a'>) => {
  const ref = useSheetRef('mint-adder');
  const theme = useSelector(memoizedGetTheme);

  return <VideoScreen videoSource="assets/videos/redeem.mp4" />;
};

export default RouteA;
