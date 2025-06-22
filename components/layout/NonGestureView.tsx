import React, { ReactNode, useMemo } from 'react';
import 'react-native-get-random-values';
import { PanResponder, StyleProp, ViewStyle } from 'react-native';

import { View } from 'components/common/View';

interface NonGestureViewProps {
  index?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * A component that prevents gesture propagation by consuming gestures without handling them
 */
export const NonGestureView: React.FC<NonGestureViewProps> = ({ style, children }) => {
  // Use useMemo instead of useRef for the PanResponder to prevent unnecessary recreations
  const panResponder = useMemo(() => PanResponder.create({}), []);

  return (
    <View
      {...panResponder.panHandlers}
      className="flex" // Add basic tailwind class
      style={style}>
      {children}
    </View>
  );
};
