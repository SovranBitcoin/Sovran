import React, { useRef } from 'react';
import 'react-native-get-random-values';
import { PanResponder } from 'react-native';

import { View } from 'components/common/Themed';

export const NonGestureView = ({ index, style, children }) => {
  const panResponder = useRef(PanResponder.create({})).current;

  return (
    <View {...panResponder.panHandlers} style={style}>
      {children}
    </View>
  );
};
