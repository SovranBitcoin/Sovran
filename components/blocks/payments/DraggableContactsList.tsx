import React, { FC, useCallback } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { LegendList } from '@legendapp/list';
import { ContactItem } from './ContactItem';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { usePaymentsAnimation } from 'providers/PaymentsAnimationProvider';

// Memoized ContactItem to prevent unnecessary re-renders
const RenderItem = React.memo(({ item }: { item: any }) => {
  return <ContactItem item={item} />;
});

RenderItem.displayName = 'RenderItem';

interface DraggableContactsListProps {
  data: any[];
  isDecrypting: boolean;
  emptyMessage: string;
  itemHeight?: number;
}

export const DraggableContactsList: FC<DraggableContactsListProps> = ({
  data,
  isDecrypting,
  emptyMessage,
  itemHeight = 80,
}) => {
  const { getPrimaryColor } = useTheme();
  const { screenView, offsetY } = usePaymentsAnimation();

  // Debug logging
  console.log('DraggableContactsList render:', {
    dataLength: data?.length || 0,
    isDecrypting,
    emptyMessage,
    data: data?.slice(0, 2), // Log first 2 items for debugging
  });

  // Note: LegendList doesn't support onScroll prop the same way as FlatList
  // We'll handle drag gestures differently if needed

  // Container style for pointer events
  const rContainerStyle = useAnimatedStyle(() => {
    return {
      // Always allow pointer events for now - we'll handle this differently
      pointerEvents: 'auto',
    };
  });

  // Top gradient style for visual feedback during drag
  const rTopGradientStyle = useAnimatedStyle(() => {
    return {
      opacity: offsetY.value < 0 ? 0 : screenView.value === 'contacts' ? withTiming(1) : 0,
    };
  });

  const keyExtractor = useCallback((item: any) => {
    return item.pubkey || item.mint?.mintUrl || item.id || Math.random().toString();
  }, []);

  if (isDecrypting) {
    return (
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Text style={{ color: getPrimaryColor('400') }}>Decrypting messages...</Text>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={{ padding: 20, alignItems: 'center' }}>
        <Text style={{ color: getPrimaryColor('400') }}>{emptyMessage}</Text>
        <Text style={{ color: getPrimaryColor('300'), marginTop: 10 }}>
          Debug: Data length is {data?.length || 0}
        </Text>
      </View>
    );
  }

  return (
    <Animated.View className="mt-3 flex-1" style={rContainerStyle}>
      <LegendList
        data={data}
        estimatedItemSize={itemHeight}
        renderItem={({ item }) => <RenderItem item={item} />}
        keyExtractor={keyExtractor}
        style={{
          flex: 1,
        }}
        contentContainerStyle={{}}
        maintainVisibleContentPosition
      />
      {/* Top gradient for visual feedback */}
      {/* <Animated.View
        style={[
          rTopGradientStyle,
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 100,
            backgroundColor: getPrimaryColor('900'),
            opacity: 0.8,
          },
        ]}
      /> */}
    </Animated.View>
  );
};
