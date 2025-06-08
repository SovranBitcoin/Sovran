import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import { Tabs } from 'components/common/Tabs';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greens, shades, greys } from 'helper/colors';

interface HeatmapProps {
  mintUrl: string;
}

interface Swap {
  created_at: string;
  state: string;
  time_taken: number;
}

const TABS = ['Success Rate', 'Average Time'];

const Heatmap = ({ mintUrl }: HeatmapProps) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [selectedTab, setSelectedTab] = useState(TABS[0]);
  const [data, setData] = useState<Record<string, Swap[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      try {
        setLoading(true);
        const resp = await fetch(
          `http://localhost:3000/api/mint/audit?mintUrl=${encodeURIComponent(mintUrl)}`
        );
        const json = await resp.json();
        const byDay: Record<string, Swap[]> = {};
        json.swaps?.forEach((s: Swap) => {
          const d = s.created_at.split('T')[0];
          if (!byDay[d]) byDay[d] = [];
          byDay[d].push(s);
        });
        if (mounted) setData(byDay);
      } catch (e) {
        if (mounted) setData({});
      } finally {
        if (mounted) setLoading(false);
      }
    };
    fetchData();
    return () => {
      mounted = false;
    };
  }, [mintUrl]);

  const allSwaps = Object.values(data).flat();
  const totalSuccess = allSwaps.filter((s) => s.state === 'OK').length;
  const overallRate = allSwaps.length
    ? (totalSuccess / allSwaps.length) * 100
    : 0;
  const overallTime = allSwaps.length
    ? allSwaps.reduce((acc, s) => acc + (s.time_taken || 0), 0) / allSwaps.length
    : 0;

  const NUM_DAYS = 30;
  const NUM_COLS = 6;
  const NUM_ROWS = 5;
  const start = dayjs().subtract(NUM_DAYS - 1, 'day');
  const columns = [] as any[];
  for (let c = 0; c < NUM_COLS; c++) {
    const col: any[] = [];
    for (let r = 0; r < NUM_ROWS; r++) {
      const index = c * NUM_ROWS + r;
      if (index >= NUM_DAYS) {
        col.push({ date: null, successRate: 0, avgTime: 0, total: 0 });
        continue;
      }
      const date = start.add(index, 'day').format('YYYY-MM-DD');
      const swaps = data[date] || [];
      const success = swaps.filter((s) => s.state === 'OK').length;
      const total = swaps.length;
      const successRate = total ? success / total : 0;
      const avgTime = total
        ? swaps.reduce((acc, s) => acc + (s.time_taken || 0), 0) / total
        : 0;
      col.push({ date, successRate, avgTime, total });
    }
    columns.push(col);
  }

  const getColor = (cell: { successRate: number; avgTime: number; total: number }) => {
    if (cell.total === 0 || cell.date === null) return greys(theme)[1500];
    if (selectedTab === TABS[0]) {
      if (cell.successRate >= 0.9) return greens[400];
      if (cell.successRate >= 0.7) return '#FFB34D';
      return shades[400];
    } else {
      if (cell.avgTime <= 5000) return greens[400];
      if (cell.avgTime <= 10000) return '#FFB34D';
      return shades[400];
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {selectedTab === TABS[0] ? (
          <>
            <Text style={styles.title}>Success Rate</Text>
            <Text style={styles.value}>{overallRate.toFixed(1)}%</Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Average Time</Text>
            <Text style={styles.value}>{Math.round(overallTime).toLocaleString()} ms</Text>
          </>
        )}
      </View>
      <Tabs tabs={TABS} selectedTab={selectedTab} handleTabPress={setSelectedTab} />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={greys(theme)[0]} />
        </View>
      ) : (
        <View style={styles.grid}>
          {columns.map((col, cIdx) => (
            <View key={cIdx} style={styles.column}>
              {col.map((cell: any) => (
                <View key={cell.date} style={[styles.cell, { backgroundColor: getColor(cell) }]} />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    container: {
      width: '100%',
      marginTop: 16,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    title: {
      color: greys(theme)[600],
      fontFamily: 'OverpassRegular',
      fontSize: 16,
    },
    value: {
      color: greys(theme)[0],
      fontFamily: 'OverpassBold',
      fontSize: 16,
    },
    grid: {
      flexDirection: 'row',
      alignSelf: 'center',
    },
    column: {
      flexDirection: 'column',
      marginHorizontal: 1,
    },
    cell: {
      width: 14,
      height: 14,
      marginVertical: 1,
      borderRadius: 2,
    },
    loading: {
      padding: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

export default Heatmap;
