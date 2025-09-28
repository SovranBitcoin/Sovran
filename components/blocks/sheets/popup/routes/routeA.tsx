import React, { useEffect, useState } from 'react';
import { StyleSheet, Animated } from 'react-native';
import { View, VStack } from 'components/ui/View';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, Theme } from 'helper/colors';
import { Button } from 'components/ui/Button';
import { useTypedNavigation } from 'helper/navigation';

const RouteA = ({ router }: RouteScreenProps<'popup-sheet', 'route-a'>) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [progress] = useState(new Animated.Value(0));

  const payload = useSheetPayload('popup-sheet');
  const isModal = payload?.variant === 'modal';
  const isPersistent = payload?.variant === 'persistent';
  const navigation = useTypedNavigation();

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
        backgroundColor: greys(theme)[800],
        padding: 16,
      }}>
      <VStack style={styles.iconContainer} align="center" justify="center">
        <Text style={styles.icon}>{payload?.emoji || '🎉'}</Text>
        <Text style={styles.text}>{payload?.message || 'Error'}</Text>
        {payload?.submessage &&
          (typeof payload.submessage === 'string' ? (
            <Text style={styles.subText}>{payload.submessage}</Text>
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
                navigation.navigate(button.page);
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

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    iconContainer: {
      marginBottom: 10,
    },
    icon: {
      fontSize: 30,
      color: greys(theme)[0],
      marginBottom: 10,
    },
    text: {
      color: greys(theme)[0],
      textAlign: 'center',
      fontSize: 20,
      fontFamily: 'OverpassBold',
    },
    subText: {
      color: greys(theme)[0],
      textAlign: 'center',
      fontSize: 14,
      fontFamily: 'OverpassRegular',
    },
    progressBar: {
      height: '100%',
      backgroundColor: greys(theme)[0],
      borderRadius: 10000,
    },
    progressBarContainer: {
      height: 4,
      backgroundColor: greys(theme)[950],
      borderRadius: 10000,
      marginTop: 10,
      width: 30,
      alignSelf: 'center',
    },
  });

export default RouteA;
