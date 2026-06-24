import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View as RNView } from 'react-native';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import Svg, { Path, Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';
import { Text } from '@/shared/ui/primitives/Text';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { formatAmount } from '@/shared/lib/currency';
import { amountToNumber } from '@/shared/lib/cashu/amount';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import type { HistoryEntry } from '@cashu/coco-core';
import { isSettledReceiveHistoryEntry, isSettledSpendHistoryEntry } from '@sovranbitcoin/colada';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { zIndex } from '@/shared/styles/tokens';
import { Log, paymentLog } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChartMode = 'spent' | 'received';

interface MonthlyChartProps {
  history: HistoryEntry[];
  unit?: string;
  mode: ChartMode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Format an amount using the app's currency helper. */
function fmt(amount: number, unit: string): string {
  return formatAmount({ amount, unit });
}

/**
 * Build a smooth SVG path string from points using monotone cubic interpolation.
 */
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;

  let d = `M${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C${cpx},${prev.y} ${cpx},${curr.y} ${curr.x},${curr.y}`;
  }

  return d;
}

/**
 * Build a closed area path for gradient fill (path + bottom edge).
 */
function buildAreaPath(points: { x: number; y: number }[], bottomY: number): string {
  if (points.length === 0) return '';
  const linePath = buildSmoothPath(points);
  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  return `${linePath} L${lastPoint.x},${bottomY} L${firstPoint.x},${bottomY} Z`;
}

// ---------------------------------------------------------------------------
// Chart constants
// ---------------------------------------------------------------------------

const CHART_HEIGHT = 100;
const CHART_PADDING_TOP = 8;
const CHART_PADDING_BOTTOM = 24;
const CHART_PADDING_LEFT = 4;
const CHART_PADDING_RIGHT = 4;
const ACTUAL_LINE_WIDTH = 2.5;
const PROJECTED_LINE_WIDTH = 1.5;

const X_TICKS = [1, 6, 11, 16, 21, 28];

// Positive green for received
// ---------------------------------------------------------------------------
// Mode config
// ---------------------------------------------------------------------------

const MODE_CONFIG: Record<
  ChartMode,
  {
    title: string;
    /** Filter predicate: return true for transactions that count towards this chart. */
    filter: (entry: HistoryEntry) => boolean;
    /** Mock daily base amount in sats. */
    mockBase: number;
    /** Mock variation pattern. */
    mockPattern: number[];
  }
> = {
  spent: {
    title: 'Spent this month',
    filter: (entry) => {
      return isSettledSpendHistoryEntry(entry);
    },
    mockBase: 3_200,
    mockPattern: [0.3, 0.1, 0.8, 1.4, 0.5, 1.1, 2.0, 0.7, 1.5],
  },
  received: {
    title: 'Received this month',
    filter: (entry) => {
      return isSettledReceiveHistoryEntry(entry);
    },
    mockBase: 5_400,
    mockPattern: [1.2, 0.4, 0.9, 0.2, 1.8, 0.6, 1.3, 0.8, 0.5],
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const MonthlyChart = function MonthlyChart({ history, unit = 'sat', mode }: MonthlyChartProps) {
  const [muted, foreground, dangerColor, successColor] = useThemeColor([
    'muted',
    'foreground',
    'danger',
    'success',
  ] as const);
  const { width: screenWidth } = useWindowDimensions();
  const mockMode = useSettingsStore((s) => s.mockMode);
  const quoteIdToGroup = useSwapTransactionsStore((s) => s.quoteIdToGroup);

  const config = MODE_CONFIG[mode];

  const borderColor = opacity(muted, 0.3);

  const actualLineColor = mode === 'spent' ? dangerColor : successColor;
  const projectedLineColor = opacity(foreground, 0.3);
  const labelColor = opacity(foreground, 0.66);

  // Use a unique gradient ID per mode to avoid SVG collisions when both charts render
  const gradientId = `monthlyGradient-${mode}`;

  // Chart dimensions
  const chartWidth = screenWidth - 32 - 32;
  const drawableWidth = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  const drawableHeight = CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;
  const totalSvgHeight = CHART_HEIGHT;

  // ---------------------------------------------------------------------------
  // Compute data
  // ---------------------------------------------------------------------------

  const {
    actualPoints,
    projectedPoints,
    totalAmount,
    projectedTotal,
    dailyChange,
    daysInMonth,
    todayDay,
  } = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const todayDay = now.getDate();

    const dailyAmounts = new Array<number>(daysInMonth).fill(0);

    if (mockMode) {
      for (let i = 0; i < todayDay; i++) {
        dailyAmounts[i] = Math.round(
          config.mockBase * config.mockPattern[i % config.mockPattern.length]
        );
      }
    } else {
      const monthStart = new Date(year, month, 1).getTime();
      const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999).getTime();

      const matching = history.filter((entry) => {
        if (entry.unit !== unit) return false;
        if (entry.createdAt < monthStart || entry.createdAt > monthEnd) return false;
        if (entry.type === 'mint' || entry.type === 'melt') {
          const quoteId = (entry as any).quoteId as string | undefined;
          if (quoteId && quoteIdToGroup[quoteId]) return false;
        }
        return config.filter(entry);
      });

      for (const entry of matching) {
        const day = new Date(entry.createdAt).getDate();
        dailyAmounts[day - 1] += amountToNumber(entry.amount);
      }
    }

    // Cumulative
    const cumulative = new Array<number>(daysInMonth).fill(0);
    cumulative[0] = dailyAmounts[0];
    for (let i = 1; i < daysInMonth; i++) {
      cumulative[i] = cumulative[i - 1] + dailyAmounts[i];
    }

    const totalAmount = cumulative[todayDay - 1];
    const yesterdayTotal = todayDay > 1 ? cumulative[todayDay - 2] : 0;
    const dailyChange = totalAmount - yesterdayTotal;

    const avgDaily = todayDay > 0 ? totalAmount / todayDay : 0;
    const projectedTotal = Math.round(avgDaily * daysInMonth);

    const dayToX = (day: number) =>
      CHART_PADDING_LEFT + ((day - 1) / (daysInMonth - 1)) * drawableWidth;
    const yMax = Math.max(projectedTotal, totalAmount, 1);
    const valueToY = (value: number) =>
      CHART_PADDING_TOP + drawableHeight - (value / yMax) * drawableHeight;

    const actualPoints: { x: number; y: number }[] = [];
    for (let day = 1; day <= todayDay; day++) {
      actualPoints.push({ x: dayToX(day), y: valueToY(cumulative[day - 1]) });
    }

    const projectedPoints: { x: number; y: number }[] = [];
    projectedPoints.push({ x: dayToX(todayDay), y: valueToY(totalAmount) });
    for (let day = todayDay + 1; day <= daysInMonth; day++) {
      projectedPoints.push({
        x: dayToX(day),
        y: valueToY(totalAmount + avgDaily * (day - todayDay)),
      });
    }

    return {
      actualPoints,
      projectedPoints,
      totalAmount,
      projectedTotal,
      dailyChange,
      daysInMonth,
      todayDay,
    };
  }, [history, unit, mockMode, config, drawableWidth, drawableHeight, quoteIdToGroup]);

  // ---------------------------------------------------------------------------
  // Build SVG paths
  // ---------------------------------------------------------------------------

  const actualPath = buildSmoothPath(actualPoints);
  const projectedPath = buildSmoothPath(projectedPoints);
  const projectedAreaPath = buildAreaPath(
    [...actualPoints, ...projectedPoints.slice(1)],
    CHART_PADDING_TOP + drawableHeight
  );

  const xTickPositions = useMemo(() => {
    const dayToX = (day: number) =>
      CHART_PADDING_LEFT + ((day - 1) / (daysInMonth - 1)) * drawableWidth;

    const ticks = X_TICKS.filter((d) => d <= daysInMonth);
    if (ticks[ticks.length - 1] !== daysInMonth) {
      ticks[ticks.length - 1] = daysInMonth;
    }

    return ticks.map((day) => ({ day, x: dayToX(day) }));
  }, [daysInMonth, drawableWidth]);

  const hasData = totalAmount > 0;

  useEffect(() => {
    paymentLog.debug('tx.monthly_chart.render', {
      mode,
      unit,
      historyCount: history.length,
      mockMode,
      actualPointCount: actualPoints.length,
      projectedPointCount: projectedPoints.length,
      totalAmount,
      projectedTotal,
      dailyChange,
      daysInMonth,
      todayDay,
      hasData,
      drawableWidth,
      drawableHeight,
    });
  }, [
    actualPoints.length,
    dailyChange,
    daysInMonth,
    drawableHeight,
    drawableWidth,
    hasData,
    history.length,
    mockMode,
    mode,
    projectedPoints.length,
    projectedTotal,
    todayDay,
    totalAmount,
    unit,
  ]);

  // Change indicator icon: spent = arrow-up (spending rising), received = arrow-up (income rising)
  const changeIcon = 'mdi:arrow-up';

  return (
    <Log name="MonthlyChart">
      <SquircleView style={[styles.card, { borderColor }]}>
        <BlurCardFrame accentColor={muted}>
          <RNView style={styles.container}>
            {/* Header */}
            <RNView style={styles.header}>
              <RNView style={styles.headerLeft}>
                <Text size={14} semibold color={opacity(foreground, 0.66)}>
                  {config.title}
                </Text>
                <RNView style={styles.amountRow}>
                  <AmountFormatter
                    amount={hasData ? totalAmount : 0}
                    unit={unit}
                    size={28}
                    weight="heavy"
                  />
                  {dailyChange > 0 ? (
                    <RNView
                      style={[
                        styles.changeChip,
                        { backgroundColor: opacity(actualLineColor, 0.12) },
                      ]}>
                      <Icon name={changeIcon} size={14} color={actualLineColor} />
                      <Text overpass size={13} semibold color={actualLineColor}>
                        {fmt(dailyChange, unit)}
                      </Text>
                    </RNView>
                  ) : null}
                </RNView>
              </RNView>
              {hasData && todayDay < daysInMonth ? (
                <RNView style={styles.headerRight}>
                  <AmountFormatter
                    amount={projectedTotal}
                    unit={unit}
                    size={14}
                    weight="medium"
                    color={opacity(foreground, 0.66)}
                  />
                </RNView>
              ) : null}
            </RNView>

            {/* Chart */}
            <Svg
              width={chartWidth}
              height={totalSvgHeight}
              viewBox={`0 0 ${chartWidth} ${totalSvgHeight}`}>
              <Defs>
                <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={foreground} stopOpacity="0.08" />
                  <Stop offset="1" stopColor={foreground} stopOpacity="0" />
                </LinearGradient>
              </Defs>

              {hasData ? <Path d={projectedAreaPath} fill={`url(#${gradientId})`} /> : null}

              {hasData && projectedPoints.length > 1 ? (
                <Path
                  d={projectedPath}
                  stroke={projectedLineColor}
                  strokeWidth={PROJECTED_LINE_WIDTH}
                  strokeDasharray={[6, 4]}
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}

              {hasData ? (
                <Path
                  d={actualPath}
                  stroke={actualLineColor}
                  strokeWidth={ACTUAL_LINE_WIDTH}
                  strokeLinecap="round"
                  fill="none"
                />
              ) : null}

              {xTickPositions.map(({ day, x }) => (
                <SvgText
                  key={day}
                  x={x}
                  y={totalSvgHeight - 4}
                  fontSize={11}
                  fontFamily="OxygenBold"
                  fill={labelColor}
                  textAnchor="middle">
                  {day}
                </SvgText>
              ))}
            </Svg>
          </RNView>
        </BlurCardFrame>
      </SquircleView>
    </Log>
  );
};

MonthlyChart.displayName = 'MonthlyChart';

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------

interface ChartWrapperProps {
  history: HistoryEntry[];
  unit?: string;
}

export const SpentThisMonth = function SpentThisMonth(props: ChartWrapperProps) {
  return <MonthlyChart {...props} mode="spent" />;
};
SpentThisMonth.displayName = 'SpentThisMonth';

export const ReceivedThisMonth = function ReceivedThisMonth(props: ChartWrapperProps) {
  return <MonthlyChart {...props} mode="received" />;
};
ReceivedThisMonth.displayName = 'ReceivedThisMonth';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  container: {
    padding: 16,
    gap: 8,
    zIndex: zIndex.raised,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: {
    gap: 2,
  },
  headerRight: {
    paddingTop: 4,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  changeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
    borderCurve: 'continuous',
  },
});
