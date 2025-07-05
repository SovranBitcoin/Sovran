import React from 'react';
import Camera from './camera';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { View } from 'components/common/View';

function ModalScreen() {
  return (
    <View
      style={{
        backgroundColor: 'red',
        width: 100,
        height: 100,
      }}>
      <Camera />
    </View>
  );
}

export default withSheetProvider(ModalScreen);
