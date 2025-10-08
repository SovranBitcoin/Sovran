import React, { useEffect, useState } from 'react';
import { Animated } from 'react-native';
import { View, VStack } from 'components/ui/View';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { Text } from 'components/ui/Text';
import { Button } from 'components/ui/Button';
import { router as expoRouter } from 'expo-router';

const RouteA = ({ router }: RouteScreenProps<'popup-sheet', 'route-a'>) => {
  const [progress] = useState(new Animated.Value(0));

  const payload = useSheetPayload('popup-sheet');
  const isModal = payload?.variant === 'modal';
  const isPersistent = payload?.variant === 'persistent';

  useEffect(() => {
    if (!isModal && !isPersistent) {
      const timer = setTimeout(() => {
        router?.goBack();
      }, 3000);

      Animated.timing(progress, {
        toValue: 100,
        duration: 3000,
        useNativeDriver: false,
      }).start();

      return () => clearTimeout(timer);
    }
  }, [router, progress, isModal, isPersistent]);

  return (
    <VStack
      justify={isModal || isPersistent ? 'center' : 'flex-end'}
      className="bg-primary-800 mx-4 mb-0 overflow-hidden rounded-2xl p-4">
      <VStack align="center" justify="center" gap={8}>
        <Text size={30} className="text-primary-0">
          {payload?.emoji || '🎉'}
        </Text>
        <Text overpass size={20} bold className="text-primary-0 text-center">
          {payload?.message || 'Error'}
        </Text>
        {payload?.submessage &&
          (typeof payload.submessage === 'string' ? (
            <Text overpass size={14} className="text-primary-0 text-center">
              {payload.submessage}
            </Text>
          ) : (
            payload.submessage
          ))}
        {payload?.buttons?.map((button) => {
          return (
            <Button
              key={button.text}
              onPress={() => {
                if (button.onPress) {
                  button.onPress();
                } else if (button.page) {
                  expoRouter.push(`/${button.page}` as any);
                }
              }}
              text={button.text}
              variant={'primary'}></Button>
          );
        })}
        {!isModal && !isPersistent && (
          <View className="bg-primary-950 mt-2.5 h-1 w-[30px] self-center rounded-full">
            <Animated.View
              className="bg-primary-0 h-full rounded-full"
              style={{
                width: progress.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              }}
            />
          </View>
        )}
      </VStack>
    </VStack>
  );
};

export default RouteA;
