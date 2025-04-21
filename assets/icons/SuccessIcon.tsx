import { useEffect, useRef } from 'react';
import { StyleSheet, Animated, Easing } from 'react-native';
import { useSelector } from 'react-redux';

import { View } from 'components/common/Themed';
import { greys } from 'helper/colors';
import { Circle, Path, Polyline, Svg } from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import Haptics from 'components/common/Haptics';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useTypedNavigation } from 'helper/navigation';

export const SuccessAnimation = ({ params }) => {
  const navigation = useTypedNavigation();
  const scaleAnim = useRef(new Animated.Value(1.5)).current;
  const circleDashOffset = useRef(new Animated.Value(151)).current;
  const checkDashOffset = useRef(new Animated.Value(36)).current;
  const resultOpacity = useRef(new Animated.Value(0)).current;
  const circleOpacity = useRef(new Animated.Value(1)).current;

  // New zoom animation value
  const zoomAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Trigger scale animation
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 1000,
      easing: Easing.ease,
      useNativeDriver: true,
    }).start();

    // Trigger circle animation
    Animated.timing(circleDashOffset, {
      toValue: 0,
      duration: 1000,
      easing: Easing.bezier(0.77, 0, 0.175, 1),
      useNativeDriver: false, // SVG animations cannot use native driver
    }).start();

    // Trigger check animation
    Animated.timing(checkDashOffset, {
      toValue: 0,
      duration: 1000,
      easing: Easing.bezier(0.77, 0, 0.175, 1),
      useNativeDriver: false,
    }).start();

    // Sequence of animations with delay and haptic feedback
    Animated.sequence([
      Animated.delay(900), // Delay before fading
    ]).start(() => {
      // Trigger haptic feedback after delay but before fading
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Trigger fade-in and fade-out animations after haptic feedback
      Animated.parallel([
        Animated.timing(resultOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(circleOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Start zoom animation after the fade-in/fade-out sequence
        // Animated.timing(zoomAnim, {
        //   toValue: 20, // Zooming in (adjust the value for more/less zoom)
        //   duration: 700,
        //   easing: Easing.out(Easing.cubic),
        //   useNativeDriver: true,
        // }).start();
        //
        // navigation.navigate(params.redirect, {
        //   ...params,
        // });
      });
    });
  }, []);

  useEffect(() => {
    navigation.navigate(
      params.redirect,
      {
        ...params,
      },
      {
        closeCurrentAndParent: true,
      }
    );
  }, []);

  const theme = useSelector(memoizedGetTheme);

  return (
    <View style={styles.container}>
      {/* Wrap the entire view in the zoom animation */}
      <Animated.View style={{ transform: [{ scale: zoomAnim }] }}>
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Svg id="successAnimation" width="70" height="70" viewBox="0 0 70 70">
            <AnimatedCircle
              id="successAnimationCircle"
              cx="35"
              cy="35"
              r="24"
              stroke={greys(theme)[0]}
              strokeWidth="2"
              strokeLinecap="round"
              fill="transparent"
              strokeDasharray="151 151"
              strokeDashoffset={circleDashOffset}
              opacity={circleOpacity}
            />
            <AnimatedPolyline
              id="successAnimationCheck"
              stroke={greys(theme)[2300]}
              strokeWidth="2"
              points="23 34 34 43 47 27"
              fill="transparent"
              strokeDasharray="36 36"
              strokeDashoffset={checkDashOffset}
            />
            <AnimatedPath
              id="successAnimationResult"
              fill={greys(theme)[0]}
              opacity={resultOpacity}
              d="M35,60 C21.1928813,60 10,48.8071187 10,35 C10,21.1928813 21.1928813,10 35,10 C48.8071187,10 60,21.1928813 60,35 C60,48.8071187 48.8071187,60 35,60 Z M23.6332378,33.2260427 L22.3667622,34.7739573 L34.1433655,44.40936 L47.776114,27.6305926 L46.223886,26.3694074 L33.8566345,41.59064 L23.6332378,33.2260427 Z"
            />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPolyline = Animated.createAnimatedComponent(Polyline);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
