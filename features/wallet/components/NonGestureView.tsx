import React, { ReactNode, useMemo } from 'react';
import { PanResponder, StyleProp, ViewStyle } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';
import { Log } from '@/shared/lib/logger';

interface NonGestureViewProps {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Prevents gesture propagation by consuming gestures without handling them. */
export const NonGestureView: React.FC<NonGestureViewProps> = ({ style, children }) => {
  const panResponder = useMemo(() => PanResponder.create({}), []);

  return (
    <Log name="NonGestureView">
      <View {...panResponder.panHandlers} className="flex" style={style}>
        {children}
      </View>
    </Log>
  );
};
