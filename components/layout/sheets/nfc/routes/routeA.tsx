import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { RouteScreenProps } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, shades } from 'helper/colors';
import Icon from 'assets/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { write } from 'components/common/useNfc';

const RouteA = ({
  router,
  payload,
}: RouteScreenProps<'popup-sheet', 'route-a'> & {
  payload: {
    variant?: string;
    emoji?: string;
    message?: string;
    submessage?: string;
    buttons?: any;
  };
}) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [isSearching, setIsSearching] = useState(false);

  // Animation values
  const pulseAnim1 = useRef(new Animated.Value(1)).current;
  const pulseAnim2 = useRef(new Animated.Value(1)).current;
  const pulseAnim3 = useRef(new Animated.Value(1)).current;

  const startSearching = async () => {
    write('test');

    setIsSearching(true);
    startPulseAnimation();
  };

  const stopSearching = () => {
    setIsSearching(false);
    pulseAnim1.setValue(1);
    pulseAnim2.setValue(1);
    pulseAnim3.setValue(1);
  };

  const startPulseAnimation = () => {
    // Reset animations
    pulseAnim1.setValue(1);
    pulseAnim2.setValue(1);
    pulseAnim3.setValue(1);

    // Create staggered pulse animations
    Animated.loop(
      Animated.stagger(400, [
        Animated.sequence([
          Animated.timing(pulseAnim1, {
            toValue: 1.8,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim1, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseAnim2, {
            toValue: 1.8,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim2, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(pulseAnim3, {
            toValue: 1.8,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim3, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    ).start();
  };

  // Stop animation when component unmounts
  useEffect(() => {
    return () => {
      pulseAnim1.stopAnimation();
      pulseAnim2.stopAnimation();
      pulseAnim3.stopAnimation();
    };
  }, []);

  return (
    <View
      style={{
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        height: 430,
      }}>
      <LinearGradient
        style={{
          width: '100%',
          height: '100%',
          position: 'absolute',
        }}
        colors={[shades[200], shades[300]]}></LinearGradient>

      {/* <Text style={styles.headerText}>CONTACTLESS PAYMENT</Text> */}

      <View style={styles.contentContainer}>
        {/* Pulse animations */}
        {isSearching && (
          <>
            <Animated.View
              style={[
                styles.pulseCircle,
                {
                  opacity: pulseAnim1.interpolate({
                    inputRange: [1, 1.8],
                    outputRange: [0.6, 0],
                  }),
                  transform: [{ scale: pulseAnim1 }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseCircle,
                {
                  opacity: pulseAnim2.interpolate({
                    inputRange: [1, 1.8],
                    outputRange: [0.6, 0],
                  }),
                  transform: [{ scale: pulseAnim2 }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseCircle,
                {
                  opacity: pulseAnim3.interpolate({
                    inputRange: [1, 1.8],
                    outputRange: [0.6, 0],
                  }),
                  transform: [{ scale: pulseAnim3 }],
                },
              ]}
            />
          </>
        )}

        {/* Icon button */}
        <TouchableOpacity
          style={styles.iconButton}
          onPress={isSearching ? stopSearching : startSearching}
          activeOpacity={0.7}>
          <View style={styles.iconBackground}>
            <Icon name="ph:contactless-payment-fill" size={116} color={shades[200]} />
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    headerText: {
      fontFamily: 'OverpassBold',
      textAlign: 'center',
      marginTop: 16,
      color: shades[500],
      fontSize: 16,
    },
    contentContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 40,
      position: 'absolute',
      left: 0,
      right: 0,
      top: '50%',
      transform: [
        {
          translateY: '-150%',
        },
      ],
    },
    iconButton: {
      position: 'absolute',
      top: 0,
      zIndex: 10,
    },
    iconBackground: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: shades[500],
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    pulseCircle: {
      position: 'absolute',
      width: 100,
      height: 100,
      top: 0,
      borderRadius: 50,
      backgroundColor: shades[400],
    },
    statusText: {
      marginTop: 24,
      color: greys(theme)[2300],
      fontFamily: 'OverpassMedium',
      fontSize: 16,
    },
    cancelButton: {
      marginTop: 20,
      width: 150,
    },
  });

export default RouteA;
