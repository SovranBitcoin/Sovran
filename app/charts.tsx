import React from 'react';
import { ScrollView, StyleSheet, Dimensions, View as RNView } from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, greens, reds } from 'helper/colors';
import { View, Text } from 'components/common/Themed';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
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

const screenWidth = Dimensions.get('window').width;
const chartWidth = screenWidth / 2 - 24;

function chartConfig(theme: string) {
  return {
    backgroundColor: greys(theme)[2300],
    backgroundGradientFrom: greys(theme)[2300],
    backgroundGradientTo: greys(theme)[2300],
    decimalPlaces: 0,
    color: () => '#ffffff',
    labelColor: () => '#ffffff',
    propsForDots: { r: '4' },
  } as const;
}

export default function Charts() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation<'chart'>();
  const styles = createStyles(theme);

  const charts = [
    {
      key: 'balance',
      title: 'Balance over time',
      render: () => (
        <LineChart
          data={balanceData}
          width={chartWidth}
          height={160}
          withShadow={false}
          chartConfig={chartConfig(theme)}
          withInnerLines={false}
          withDots={false}
          renderDotContent={({ x, y, index }) => (
            <RNView
              key={index}
              style={{
                position: 'absolute',
                left: x - 3,
                top: y - 3,
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: balancePoints[index].incoming ? greens[400] : reds[400],
              }}
            />
          )}
          style={styles.chart}
        />
      ),
    },
    {
      key: 'io',
      title: 'Sent vs Received',
      render: () => (
        <BarChart
          data={txData}
          width={chartWidth}
          height={160}
          chartConfig={chartConfig(theme)}
          withInnerLines={false}
          style={styles.chart}
        />
      ),
    },
  ];

  return (
    <Container>
      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {charts.map((c) => (
          <TouchableOpacity key={c.key} onPress={() => navigation.navigate('chart', { type: c.key })}>
            <View style={styles.item}>
              <Text style={styles.title}>{c.title}</Text>
              {c.render()}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </Container>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      paddingTop: 16,
    },
    item: {
      width: chartWidth,
      marginBottom: 16,
      borderRadius: 12,
      backgroundColor: greys(theme)[1800],
      padding: 8,
    },
    title: {
      fontFamily: 'OverpassSemibold',
      fontSize: 14,
      marginBottom: 8,
      color: greys(theme)[0],
    },
    chart: {
      borderRadius: 12,
    },
  });
