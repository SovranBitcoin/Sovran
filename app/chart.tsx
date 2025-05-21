import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Dimensions, View as RNView } from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, greens, reds } from 'helper/colors';
import { View, Text } from 'components/common/Themed';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import { useTypedRoute } from 'helper/navigation';
import Container from 'components/layout/Container';

const balancePoints = [
  { label: 'Jan', value: 20, incoming: true },
  { label: 'Feb', value: 45, incoming: true },
  { label: 'Mar', value: 28, incoming: false },
  { label: 'Apr', value: 80, incoming: true },
  { label: 'May', value: 99, incoming: false },
  { label: 'Jun', value: 43, incoming: true },
];

const balanceData = {
  labels: balancePoints.map((p) => p.label),
  datasets: [
    {
      data: balancePoints.map((p) => p.value),
      color: () => '#ffffff',
    },
  ],
};

const txData = {
  labels: ['Sent', 'Received'],
  datasets: [{ data: [50, 75] }],
};

const screenWidth = Dimensions.get('window').width - 32;

function chartConfig(theme: string) {
  return {
    backgroundColor: greys(theme)[2300],
    backgroundGradientFrom: greys(theme)[2300],
    backgroundGradientTo: greys(theme)[2300],
    decimalPlaces: 0,
    color: () => '#ffffff',
    labelColor: () => '#ffffff',
    propsForDots: {
      r: '4',
    },
  } as const;
}

export default function Chart() {
  const { type } = useTypedRoute<'chart'>();
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const [activePoint, setActivePoint] = useState<{ x: number; value: number } | null>(null);
  const [range, setRange] = useState('1w');

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
        <RNView>
          <LineChart
            data={balanceData}
            width={screenWidth}
            height={240}
            withShadow={false}
            chartConfig={chartConfig(theme)}
            bezier
            withInnerLines={false}
            withDots={false}
            renderDotContent={({ x, y, index }) => (
              <RNView
                key={index}
                style={{
                  position: 'absolute',
                  left: x - 4,
                  top: y - 4,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: balancePoints[index].incoming ? greens[400] : reds[400],
                }}
              />
            )}
            onDataPointClick={({ x, value }) => setActivePoint({ x, value })}
            style={styles.chart}
          />
          {activePoint && (
            <RNView pointerEvents="none" style={[styles.indicator, { left: activePoint.x }]}/>
          )}
        </RNView>
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

  const ranges = ['1d', '1w', '1m', '1y', 'max'];

  return (
    <Container>
      <Animated.View style={[styles.container, { opacity }]}>
        <View style={styles.headerRow}>
          <Text style={styles.label}>Total balance</Text>
          <Text style={styles.balance}>1234 sats</Text>
        </View>
        <Text style={styles.updated}>last update {new Date().toLocaleDateString()}</Text>
        <RNView style={styles.chartWrapper}>{renderChart()}</RNView>
        <RNView style={styles.rangeRow}>
          {ranges.map((r) => (
            <TouchableOpacity key={r} onPress={() => setRange(r)} style={[styles.rangeBtn, range === r && styles.rangeBtnActive]}>
              <Text style={[styles.rangeText, range === r && styles.rangeTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </RNView>
      </Animated.View>
    </Container>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      paddingTop: 16,
      paddingBottom: 24,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    label: {
      fontFamily: 'OverpassRegular',
      color: greys(theme)[600],
      fontSize: 13,
    },
    balance: {
      fontFamily: 'OverpassSemibold',
      color: greys(theme)[0],
      fontSize: 16,
    },
    updated: {
      fontFamily: 'OverpassRegular',
      color: greys(theme)[600],
      fontSize: 12,
      marginBottom: 12,
    },
    chart: {
      borderRadius: 12,
    },
    chartWrapper: {
      position: 'relative',
    },
    rangeRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 12,
    },
    rangeBtn: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    rangeBtnActive: {
      backgroundColor: greys(theme)[2100],
    },
    rangeText: {
      color: greys(theme)[600],
      fontFamily: 'OverpassRegular',
      fontSize: 12,
    },
    rangeTextActive: {
      color: greys(theme)[0],
    },
    indicator: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: 1,
      backgroundColor: '#ffffff50',
    },
  });
