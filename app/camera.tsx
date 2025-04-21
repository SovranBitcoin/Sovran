import React from 'react';
import Camera from 'components/layout/Camera';
import { View } from 'components/common/Themed';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';

function CameraScreen() {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: greys(theme)[2300],
        position: 'relative',
      }}>
      <Camera />
    </View>
  );
}

export default CameraScreen;
