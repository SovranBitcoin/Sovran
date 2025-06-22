import React from 'react';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { VideoScreen } from 'app/ProfilePage/VideoPlayer';

const RouteA = ({ router }: RouteScreenProps<'video-sheet', 'route-a'>) => {
  return <VideoScreen videoSource="assets/videos/redeem.mp4" />;
};

export default RouteA;
