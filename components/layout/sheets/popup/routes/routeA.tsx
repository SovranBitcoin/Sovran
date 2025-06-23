import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { Button } from 'components/common/Button';
import { useTypedNavigation } from 'helper/navigation';

const RouteA = ({ router }: RouteScreenProps<'popup-sheet', 'route-a'>) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [progress] = useState(new Animated.Value(0));

  const payload = useSheetPayload('popup-sheet');
  const isModal = payload?.variant === 'modal';
  const navigation = useTypedNavigation();

  useEffect(() => {
    if (!isModal) {
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
  }, [router, progress, isModal]);

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: greys(theme)[1800],
        padding: 16,
        justifyContent: isModal ? 'center' : 'flex-end',
      }}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>{payload?.emoji || '🎉'}</Text>
        <Text style={styles.text}>{payload?.message || 'Error'}</Text>
        {payload?.submessage &&
          (typeof payload.submessage === 'string' ? (
            <Text style={styles.subText}>{payload.submessage}</Text>
          ) : (
            payload.submessage
          ))}
      </View>
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
      {!isModal && (
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
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    iconContainer: {
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
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
      backgroundColor: greys(theme)[2300],
      borderRadius: 10000,
      marginTop: 10,
      width: 30,
      alignSelf: 'center',
    },
  });

export default RouteA;
