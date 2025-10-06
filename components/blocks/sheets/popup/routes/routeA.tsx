import React, { useEffect, useState } from 'react';
import { StyleSheet, Animated } from 'react-native';
import { View, VStack } from 'components/ui/View';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { useTheme } from 'providers/ThemeProvider';
import { Button } from 'components/ui/Button';
import { router as expoRouter } from 'expo-router';

const RouteA = ({ router }: RouteScreenProps<'popup-sheet', 'route-a'>) => {
  const { getPrimaryColor } = useTheme();
  const styles = createStyles(getPrimaryColor);
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
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: getPrimaryColor('800'),
        padding: 16,
      }}>
      <VStack style={styles.iconContainer} align="center" justify="center">
        <Text style={styles.icon} className="text-primary-0">
          {payload?.emoji || '🎉'}
        </Text>
        <Text style={styles.text} className="text-primary-0">
          {payload?.message || 'Error'}
        </Text>
        {payload?.submessage &&
          (typeof payload.submessage === 'string' ? (
            <Text style={styles.subText} className="text-primary-0">
              {payload.submessage}
            </Text>
          ) : (
            payload.submessage
          ))}
      </VStack>
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
        <View style={styles.progressBarContainer}>
          <Animated.View
            style={[
              styles.progressBar,
              {
                width: progress.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      )}
    </VStack>
  );
};

const createStyles = (getPrimaryColor: (shade: string) => string) =>
  StyleSheet.create({
    iconContainer: {
      marginBottom: 10,
    },
    icon: {
      fontSize: 30,
      color: getPrimaryColor('0'),
      marginBottom: 10,
    },
    text: {
      color: getPrimaryColor('0'),
      textAlign: 'center',
      fontSize: 20,
      fontFamily: 'OverpassBold',
    },
    subText: {
      color: getPrimaryColor('0'),
      textAlign: 'center',
      fontSize: 14,
      fontFamily: 'OverpassRegular',
    },
    progressBar: {
      height: '100%',
      backgroundColor: getPrimaryColor('0'),
      borderRadius: 10000,
    },
    progressBarContainer: {
      height: 4,
      backgroundColor: getPrimaryColor('950'),
      borderRadius: 10000,
      marginTop: 10,
      width: 30,
      alignSelf: 'center',
    },
  });

export default RouteA;
