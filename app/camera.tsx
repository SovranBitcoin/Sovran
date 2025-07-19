import React from 'react';
import Camera from 'components/layout/Camera';
import { View } from 'components/common/View';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { withSheetProvider } from 'hocs/withSheetProvider';

function CameraScreen() {
  const theme = useSelector(memoizedGetTheme);

  return (
    <View
      className="relative flex-1"
      style={{
        backgroundColor: greys(theme)[950],
      }}>
      <Camera />
    </View>
  );
}

export default withSheetProvider(CameraScreen);
