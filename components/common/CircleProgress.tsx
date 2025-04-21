import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { greys, shades } from 'helper/colors';
import { FlagIcon } from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

const CircularProgress = ({ progress, country }) => {
  const theme = useSelector(memoizedGetTheme);

  const size = 48;
  const strokeWidth = 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (circumference * progress) / 100;

  return (
    <View style={styles.container}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle
          stroke={greys(theme)[1500]}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
        />
        <Circle
          stroke={shades[200]}
          fill="none"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={progressOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.flagIconContainer}>
        <FlagIcon width={40} height={40} country={country} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  svg: {
    position: 'absolute',
  },
  flagIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default CircularProgress;
