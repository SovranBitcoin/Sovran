import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Dimensions } from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View, Text } from 'components/common/Themed';
import { useTypedRoute } from 'helper/navigation';
import Container from 'components/layout/Container';

const balanceData = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [{ data: [20, 45, 28, 80, 99, 43] }],
};

const txData = {
  labels: ['Sent', 'Received'],
  datasets: [{ data: [50, 75] }],
};

const screenWidth = Dimensions.get('window').width - 32;

function chartConfig(theme: string) {
  return {
    backgroundColor: greys(theme)[2100],
    backgroundGradientFrom: greys(theme)[2100],
    backgroundGradientTo: greys(theme)[2100],
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
    propsForDots: {
      r: '3',
      strokeWidth: '2',
      stroke: '#ffa726',
    },
  } as const;
}

export default function Chart() {
  const { type } = useTypedRoute<'chart'>();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [opacity]);

  const renderChart = () => {
    if (type === 'balance') {
      return (
        <LineChart
          data={balanceData}
          width={screenWidth}
          height={240}
          chartConfig={chartConfig(theme)}
          bezier
          withInnerLines={false}
          style={styles.chart}
        />
      );
    }
    return (
      <BarChart
        data={txData}
        width={screenWidth}
        height={240}
        chartConfig={chartConfig(theme)}
        withInnerLines={false}
        style={styles.chart}
      />
    );
  };

  const title = type === 'balance' ? 'Balance over time' : 'Sent vs Received';

  return (
    <Container>
      <Animated.View style={[styles.container, { opacity }]}>
        <Text style={styles.title}>{title}</Text>
        {renderChart()}
      </Animated.View>
    </Container>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      paddingTop: 16,
      alignItems: 'center',
    },
    title: {
      fontFamily: 'OverpassSemibold',
      fontSize: 16,
      marginBottom: 8,
      color: greys(theme)[0],
    },
    chart: {
      borderRadius: 12,
    },
  });
