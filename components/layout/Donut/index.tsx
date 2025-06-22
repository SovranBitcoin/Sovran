import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import DonutChart from './DonutChart';
import { useFont } from '@shopify/react-native-skia';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import RenderItem from './RenderItem';
import { SafeAreaView } from 'react-native-safe-area-context';
import { View } from 'components/common/View';
import { greys, shades } from 'helper/colors';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';

export interface DonutData {
  amount: number;
  label: string;
  [key: string]: any;
}

interface DonutChartContainerProps {
  data: DonutData[];
  titleText?: string;
  totalValueSuffix?: string;
  colors?: string[];
}

const RADIUS = 160;
const STROKE_WIDTH = 30;
const OUTER_STROKE_WIDTH = 46;
const GAP = 0.04;

export const DonutChartContainer = ({
  data,
  titleText,
  totalValueSuffix,
  colors = Object.values(shades),
  disableItems = false,
  isSpecialCase = false,
}: DonutChartContainerProps) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [chartData, setChartData] = useState<(DonutData & { percentage: number; color: string })[]>(
    []
  );
  const totalValue = useSharedValue(0);
  const decimals = useSharedValue<number[]>([]);

  const generateData = () => {
    const filteredData = data;

    const total = filteredData.reduce((acc, item) => acc + item.amount, 0);
    const percentages = filteredData.map((item) => Math.round((item.amount / total) * 100));
    const generateDecimals = percentages.map((number) => Number(number.toFixed(0)) / 100);

    totalValue.value = withTiming(total, { duration: 1000 });
    decimals.value = [...generateDecimals];

    const arrayOfObjects = filteredData.map((item, index) => ({
      ...item,
      percentage: percentages[index],
      color: colors[index % colors.length],
    }));

    setChartData(arrayOfObjects);
  };

  useEffect(() => {
    generateData();
  }, [data]);

  const font = useFont(require('../../../assets/fonts/Overpass/overpass-bold.otf'), 32);
  const smallFont = useFont(require('../../../assets/fonts/Overpass/overpass-bold.otf'), 20);

  if (!font || !smallFont) {
    return <View />;
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={{ alignItems: 'center' }}
        showsVerticalScrollIndicator={false}>
        <View style={styles.chartContainer}>
          <DonutChart
            radius={RADIUS}
            gap={GAP}
            strokeWidth={STROKE_WIDTH}
            outerStrokeWidth={OUTER_STROKE_WIDTH}
            font={font}
            smallFont={smallFont}
            totalValue={totalValue}
            n={chartData.length}
            decimals={decimals}
            colors={colors}
            titleText={titleText}
            totalValueSuffix={totalValueSuffix}
            isSpecialCase={isSpecialCase}
            chartData={chartData}
          />
        </View>
        {!disableItems &&
          chartData.map((item, index) => {
            return <RenderItem item={item} key={index} index={index} />;
          })}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: greys(theme)[2300],
    },
    chartContainer: {
      width: RADIUS * 2,
      height: RADIUS * 2,
    },
  });

export default DonutChartContainer;
