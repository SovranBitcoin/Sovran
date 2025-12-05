/**
 * @fileoverview RouteA - Toast notifications and modal dialogs
 *
 * @module components/blocks/sheets/popup/routes/route-a
 *
 * @description
 * Displays toast notifications with auto-dismiss, modal dialogs with buttons,
 * and persistent alerts. Supports custom emojis, messages, and navigation actions.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: `router.goBack()` after auto-dismiss or button press
 * - Close: Auto-dismiss (3s) or manual via buttons
 *
 * **Data:**
 * - Payload: `useSheetPayload('popup-sheet')` - Message content and behavior
 * - Params: None (single route)
 *
 * **Flow:** Display message → auto-dismiss OR button press → close
 *
 * @see {@link ./index}
 */

import React, { useEffect, useState } from 'react';
import { Animated } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { Text } from 'components/ui/Text';
import { Button } from 'components/ui/Button';
import { router as expoRouter } from 'expo-router';

/**
 * RouteA Component
 *
 * @component
 * @param {RouteScreenProps<'popup-sheet', 'route-a'>} props
 * @returns {JSX.Element}
 */
const RouteA = ({ router }: RouteScreenProps<'popup-sheet', 'route-a'>) => {
  const [progress] = useState(new Animated.Value(0));

  const payload = useSheetPayload('popup-sheet');
  const isModal = payload?.variant === 'modal';
  const isPersistent = payload?.variant === 'persistent';

  /**
   * Handles auto-dismiss timer
   *
   * @description Sets up 3-second auto-dismiss timer and progress animation for toast notifications
   *
   * **Process:** setTimeout → Animated.timing → router.goBack()
   * **Effects:** Auto-dismiss, progress animation
   */
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
      className="mx-4 mb-0 overflow-hidden rounded-2xl bg-primary-800 p-4">
      <VStack align="center" justify="center" gap={8}>
        <Text size={30} className="text-primary-0">
          {payload?.emoji || '🎉'}
        </Text>
        <Text overpass size={20} bold className="text-center text-primary-0">
          {payload?.message || 'Error'}
        </Text>
        {payload?.submessage &&
          (typeof payload.submessage === 'string' ? (
            <Text overpass size={14} className="text-center text-primary-0">
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
                  expoRouter.navigate(`/${button.page}` as any);
                }
              }}
              text={button.text}
              variant={'primary'}></Button>
          );
        })}
        {!isModal && !isPersistent && (
          <View className="mt-2.5 h-1 w-[30px] self-center rounded-full bg-primary-950">
            <Animated.View
              className="h-full rounded-full bg-primary-0"
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
