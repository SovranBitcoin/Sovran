import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Dimensions } from 'react-native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetTransactions } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { View, Text } from 'components/common/Themed';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Container from 'components/layout/Container';


const screenWidth = Dimensions.get('window').width;
const chartWidth = screenWidth / 2 - 24;

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

export default function Charts() {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation<'chart'>();
  const route = useTypedRoute<'charts'>();
  const profileId = useSelector((state) => state.nostr.currentProfile.id);
  const transactions = useSelector(memoizedGetTransactions({ id: profileId }));
  const styles = createStyles(theme);

  const balanceData = useMemo(() => {
    let total = 0;
    const data = transactions
      .filter((t) => t.unit === route.params.unit)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((tx) => {
        total += tx.transactionType === 'receive' ? tx.amount : -tx.amount;
        return total;
      });
    return {
      labels: data.map(() => ''),
      datasets: [{ data }],
    };
  }, [transactions, route.params.unit]);

  const txData = useMemo(() => {
    const sent = transactions
      .filter((t) => t.unit === route.params.unit && t.transactionType === 'send')
      .reduce((a, b) => a + b.amount, 0);
    const received = transactions
      .filter((t) => t.unit === route.params.unit && t.transactionType === 'receive')
      .reduce((a, b) => a + b.amount, 0);
    return {
      labels: ['Sent', 'Received'],
      datasets: [{ data: [sent, received] }],
    };
  }, [transactions, route.params.unit]);

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
          withHorizontalLabels={false}
          withVerticalLabels={false}
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
          withHorizontalLabels={false}
          withVerticalLabels={false}
          style={styles.chart}
        />
      ),
    },
  ];

  return (
    <Container>
      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {charts.map((c) => (
          <TouchableOpacity key={c.key} onPress={() => navigation.navigate('chart', { type: c.key, unit: route.params.unit })}>
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
