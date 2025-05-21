import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, Dimensions } from 'react-native';
import { BarChart } from 'react-native-chart-kit';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { memoizedGetTransactions } from 'helper/redux/cashu';
import { greys } from 'helper/colors';
import { Text } from 'components/common/Themed';
import { useTypedRoute } from 'helper/navigation';
import Container from 'components/layout/Container';
import BalanceOverTimeChart from 'components/charts/BalanceOverTimeChart';

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
  const route = useTypedRoute<'chart'>();
  const { type } = route;
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

  const profileId = useSelector((state) => state.nostr.currentProfile.id);
  const transactions = useSelector(memoizedGetTransactions({ id: profileId }));

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

  const renderChart = () => {
    if (type === 'balance') {
      return <BalanceOverTimeChart unit={route.params.unit} transactions={transactions} />;
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
