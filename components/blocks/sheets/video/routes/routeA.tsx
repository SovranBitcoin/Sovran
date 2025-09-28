import React from 'react';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { VideoScreen } from 'app/ProfilePage/VideoPlayer';

// eslint-disable-next-line no-empty-pattern
const RouteA = ({}: RouteScreenProps<'video-sheet', 'route-a'>) => {
  return <VideoScreen videoSource="assets/videos/redeem.mp4" />;
};

export default RouteA;
