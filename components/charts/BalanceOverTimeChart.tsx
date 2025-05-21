import React, { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, Dimensions, View as RNView } from 'react-native';
import Svg, { Path, Circle, Line } from 'react-native-svg';
import dayjs from 'dayjs';
import { useSelector } from 'react-redux';
import { greys, greens, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { Text, View } from 'components/common/Themed';

interface Tx {
  amount: number;
  date: string;
  transactionType: 'send' | 'receive';
  unit: string;
}

const { width: screenWidth } = Dimensions.get('window');
const chartHeight = 200;
const padding = 16;

const ranges: Record<string, number> = {
  '1D': 1,
  '1W': 7,
  '1M': 30,
  '1Y': 365,
  MAX: Infinity,
};

export default function BalanceOverTimeChart({ unit, transactions }: { unit: string; transactions: Tx[] }) {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const [range, setRange] = useState<keyof typeof ranges>('1W');
  const [touchX, setTouchX] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const end = dayjs();
    const days = ranges[range];
    const start = days === Infinity ? dayjs(0) : end.subtract(days, 'day');
    return transactions
      .filter((t) => t.unit === unit)
      .filter((t) => dayjs(t.date).isAfter(start))
      .sort((a, b) => dayjs(a.date).valueOf() - dayjs(b.date).valueOf());
  }, [transactions, unit, range]);

  const data = useMemo(() => {
    let total = 0;
    return filtered.map((tx) => {
      total += tx.transactionType === 'receive' ? tx.amount : -tx.amount;
      return { ...tx, balance: total } as Tx & { balance: number };
    });
  }, [filtered]);

  const minValue = Math.min(0, ...data.map((d) => d.balance));
  const maxValue = Math.max(0, ...data.map((d) => d.balance));

  const minDate = data[0] ? dayjs(data[0].date) : dayjs();
  const maxDate = data[data.length - 1] ? dayjs(data[data.length - 1].date) : dayjs();

  const scaleX = (d: dayjs.Dayjs) => {
    if (maxDate.isSame(minDate)) return padding;
    return (
      padding +
      ((d.valueOf() - minDate.valueOf()) / (maxDate.valueOf() - minDate.valueOf())) *
        (screenWidth - padding * 2)
    );
  };

  const scaleY = (v: number) => {
    if (maxValue === minValue) return chartHeight - padding;
    return (
      chartHeight -
      padding -
      ((v - minValue) / (maxValue - minValue)) * (chartHeight - padding * 2)
    );
  };

  const points = data.map((d) => ({
    x: scaleX(dayjs(d.date)),
    y: scaleY(d.balance),
    type: d.transactionType,
    balance: d.balance,
    date: dayjs(d.date),
  }));

  const pathData = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
    .join(' ');

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (e) => {
          setTouchX(e.nativeEvent.locationX);
        },
        onPanResponderMove: (e) => {
          setTouchX(e.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          setTouchX(null);
        },
        onPanResponderTerminate: () => {
          setTouchX(null);
        },
      }),
    [points]
  );

  const nearest = useMemo(() => {
    if (touchX === null || points.length === 0) return null;
    return points.reduce((prev, curr) =>
      Math.abs(curr.x - touchX) < Math.abs(prev.x - touchX) ? curr : prev
    );
  }, [touchX, points]);

  const yTicks = [minValue, (minValue + maxValue) / 2, maxValue];

  const lastUpdate = data[data.length - 1]?.date
    ? dayjs(data[data.length - 1].date)
    : null;
  const totalBalance = data[data.length - 1]?.balance || 0;

  return (
    <View>
      <Text weight="heavy" size={20} style={{ marginBottom: 4 }}>
        Total balance
      </Text>
      <Text weight="heavy" size={24} style={{ marginBottom: 4 }}>
        {totalBalance}
      </Text>
      {lastUpdate && (
        <Text size={12} style={{ marginBottom: 8 }}>
          last update {lastUpdate.format('YYYY-MM-DD HH:mm')}
        </Text>
      )}
      <RNView {...panResponder.panHandlers}>
        <Svg width={screenWidth} height={chartHeight}>
          <Path d={pathData} stroke={greys(theme)[0]} strokeWidth={2} fill="none" />
          {points.map((p, idx) => (
            <Circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={p.type === 'receive' ? greens[300] : reds[300]}
            />
          ))}
          {nearest && (
            <>
              <Line
                x1={nearest.x}
                y1={padding}
                x2={nearest.x}
                y2={chartHeight - padding}
                stroke={greys(theme)[600]}
                strokeDasharray="4 2"
              />
              <Circle
                cx={nearest.x}
                cy={nearest.y}
                r={6}
                stroke={greys(theme)[0]}
                strokeWidth={2}
                fill={nearest.type === 'receive' ? greens[300] : reds[300]}
              />
            </>
          )}
        </Svg>
      </RNView>
      <RNView style={styles.yLabels} pointerEvents="none">
        {yTicks.map((t, idx) => (
          <Text key={idx} size={12} style={{ position: 'absolute', top: scaleY(t) - 6 }}>
            {Math.round(t)}
          </Text>
        ))}
      </RNView>
      <RNView style={styles.buttonsContainer}>
        {Object.keys(ranges).map((key) => (
          <View key={key} style={{ marginHorizontal: 4 }}>
            <Text
              onPress={() => setRange(key as keyof typeof ranges)}
              style={[
                styles.rangeButton,
                range === key && styles.rangeButtonActive,
              ]}
            >
              {key}
            </Text>
          </View>
        ))}
      </RNView>
    </View>
  );
}

const createStyles = (theme: string) =>
  StyleSheet.create({
    yLabels: {
      position: 'absolute',
      right: 0,
      top: 0,
      height: chartHeight,
      width: 40,
      justifyContent: 'flex-start',
    },
    buttonsContainer: {
      marginTop: 8,
      flexDirection: 'row',
      justifyContent: 'center',
    },
    rangeButton: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 12,
      overflow: 'hidden',
      backgroundColor: greys(theme)[2100],
      color: greys(theme)[0],
      fontFamily: 'OverpassBold',
      textTransform: 'uppercase',
      fontSize: 12,
    },
    rangeButtonActive: {
      backgroundColor: greys(theme)[1500],
      color: greys(theme)[0],
    },
  });
