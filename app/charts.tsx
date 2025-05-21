import React from 'react';
import { ScrollView, StyleSheet, Dimensions } from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { View, Text } from 'components/common/Themed';
import { useTypedNavigation } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Container from 'components/layout/Container';

const balanceData = {
  labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
  datasets: [{ data: [20, 45, 28, 80, 99, 43] }],
};

const txData = {
  labels: ['Sent', 'Received'],
  datasets: [{ data: [50, 75] }],
};

const screenWidth = Dimensions.get('window').width;
const chartWidth = screenWidth / 2 - 24;

function chartConfig(theme: string) {
  return {
    backgroundColor: greys(theme)[2100],
    backgroundGradientFrom: greys(theme)[2100],
    backgroundGradientTo: greys(theme)[2100],
    fillShadowGradient: '#367be2',
    fillShadowGradientOpacity: 0.2,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(54, 123, 226, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
    propsForDots: {
      r: '3',
      strokeWidth: '2',
      stroke: '#367be2',
    },
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
          chartConfig={chartConfig(theme)}
          withInnerLines={false}
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
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 2,
    },
    title: {
      fontFamily: 'OverpassSemibold',
      fontSize: 14,
      marginBottom: 8,
      color: greys(theme)[0],
    },
    chart: {
      borderRadius: 12,
      marginTop: 4,
    },
  });
