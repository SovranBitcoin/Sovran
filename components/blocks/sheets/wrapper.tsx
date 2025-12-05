import React, { useState, useCallback } from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import { ScrollView } from 'react-native-actions-sheet'; // <- important this is from react-native-actions-sheet
import { Spacer } from 'components/ui/View/Spacer';

interface WrapperProps {
  children: React.ReactNode;
  buttons?: React.ReactNode;
  containerStyle?: StyleProp<ViewStyle>;
  scrollContainerStyle?: StyleProp<ViewStyle>;
}

const Wrapper: React.FC<WrapperProps> = ({
  children,
  buttons,
  containerStyle,
  scrollContainerStyle,
}) => {
  const [containerHeight, setContainerHeight] = useState(0);
  const [buttonHeight, setButtonHeight] = useState(0);

  const handleContainerLayout = useCallback((event: any) => {
    setContainerHeight(event.nativeEvent.layout.height);
  }, []);

  const handleButtonLayout = useCallback((event: any) => {
    setButtonHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <View onLayout={handleContainerLayout} className="h-full bg-primary-950" style={containerStyle}>
      <ScrollView className="h-full p-4" style={scrollContainerStyle}>
        {children}
        <Spacer size={buttonHeight} />
      </ScrollView>
      {buttons && (
        <View
          className="absolute w-full p-0"
          style={{
            top: containerHeight - buttonHeight,
          }}
          onLayout={handleButtonLayout}>
          {buttons}
        </View>
      )}
    </View>
  );
};

export default Wrapper;
