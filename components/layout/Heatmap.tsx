import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated } from 'react-native';
import { useSelector } from 'react-redux';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc'; // Add UTC plugin
import { memoizedGetTheme } from 'helper/redux/settings';
import { greens, greys, reds } from 'helper/colors';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import Image from 'components/common/Image';
import opacity from 'hex-color-opacity';

const DonutChart = ({
  size = 96,
  strokeWidth = 2.5,
  sections = [
    { value: 1, color: '#4CAF50' },
    { value: 1, color: '#FF9800' },
    { value: 1, color: '#2196F3' },
  ],
  children,
  gap = 3.5, // Gap between sections in degrees
  startAngle = 90, // Start angle in degrees (-90 starts at top)
}) => {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;

  // Calculate total value
  const totalValue = sections.reduce((sum, section) => sum + section.value, 0);

  // Convert gap from degrees to radians
  const gapRad = (gap * Math.PI) / 180;
  const totalGapRad = gapRad * sections.length;
  const availableAngle = 2 * Math.PI - totalGapRad;

  // Create paths for each section
  const sectionPaths = sections.map((section, index) => {
    const sectionAngle = (section.value / totalValue) * availableAngle;

    // Calculate start angle for this section
    let currentStartAngle = (startAngle * Math.PI) / 180;
    for (let i = 0; i < index; i++) {
      currentStartAngle += (sections[i].value / totalValue) * availableAngle + gapRad;
    }

    const endAngle = currentStartAngle + sectionAngle;

    // Create arc path
    const path = Skia.Path.Make();

    // Move to start point of outer arc
    const startX = center + radius * Math.cos(currentStartAngle);
    const startY = center + radius * Math.sin(currentStartAngle);
    path.moveTo(startX, startY);

    // Draw outer arc
    path.arcToOval(
      Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2),
      (currentStartAngle * 180) / Math.PI,
      (sectionAngle * 180) / Math.PI,
      false
    );

    // Draw line to inner arc start
    const innerRadius = radius - strokeWidth;
    const endX = center + innerRadius * Math.cos(endAngle);
    const endY = center + innerRadius * Math.sin(endAngle);
    path.lineTo(endX, endY);

    // Draw inner arc (reverse direction)
    path.arcToOval(
      Skia.XYWHRect(center - innerRadius, center - innerRadius, innerRadius * 2, innerRadius * 2),
      (endAngle * 180) / Math.PI,
      -(sectionAngle * 180) / Math.PI,
      false
    );

    // Close the path
    path.close();

    return {
      path,
      color: section.color,
    };
  });

  return (
    <View style={[{ margin: 'auto', width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        <Group>
          {sectionPaths.map((section, index) => (
            <Path strokeJoin="round" key={index} path={section.path} color={section.color} />
          ))}
        </Group>
      </Canvas>

      {/* Center content (logo) */}
      <View
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
        }}>
        {children}
      </View>
    </View>
  );
};

// Extend dayjs with UTC plugin
dayjs.extend(utc);

interface HeatmapProps {
  mintUrl: string;
  wallet?: any;
  mintInfo?: any;
}

interface Swap {
  created_at: string;
  state: string;
  time_taken: number;
}

const Heatmap = ({ mintInfo, mintUrl, wallet }: HeatmapProps) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const [data, setData] = useState<Record<string, Swap[]>>({});
  const [swaps, setSwaps] = useState<Swap[]>([]);

  // Animation values for the subtle pulsating effect
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    if (!wallet?.audits?.swaps) return;

    setSwaps(wallet.audits.swaps);

    const swapsByDayWithStats = wallet?.audits?.swaps?.reduce((acc, swap) => {
      // Use dayjs to parse and format in UTC
      const date = dayjs(swap.created_at).utc().format('YYYY-MM-DD');

      if (!acc[date]) {
        acc[date] = {
          swaps: [],
          totalAmount: 0,
          totalFees: 0,
          count: 0,
          successRate: 0,
        };
      }

      acc[date].swaps.push(swap);
      acc[date].totalAmount += swap.amount;
      acc[date].totalFees += swap.fee;
      acc[date].count += 1;
      acc[date].successRate =
        acc[date].swaps.filter((s) => s.state === 'OK').length / acc[date].count;

      return acc;
    }, {});

    setData(swapsByDayWithStats);
  }, [wallet?.audits]);

  // Start the subtle heartbeat animation
  useEffect(() => {
    const startSubtleHeartbeat = () => {
      Animated.sequence([
        // Gentle pulse
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.66,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        // Return to normal
        Animated.parallel([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 1,
            duration: 400,
            useNativeDriver: true,
          }),
        ]),
        // Pause
        Animated.delay(600),
      ]).start(() => {
        startSubtleHeartbeat();
      });
    };

    startSubtleHeartbeat();
  }, [pulseAnim, opacityAnim]);

  // heatmap

  const getColor = (successRate) => {
    // base colors on green/yellow/red
    if (successRate >= 0.9) return '#0CED3E';
    if (successRate >= 0.7) return '#ED9E0C';
    if (successRate >= 0.5) return '#ED9E0C';
    if (successRate >= 0.3) return '#FF0000';
    if (successRate >= 0.1) return '#ED0C46';
    if (successRate >= 0) return '#ED0C46';
    return greys(theme)[1500];
  };

  if (!mintInfo || !wallet?.audits) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={greens[500]} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  const days = 45;

  return (
    <View
      style={{
        flex: 1,
      }}>
      <View style={styles.logoContainer}>
        <DonutChart
          sections={[
            {
              value: swaps?.filter((s) => s.state === 'OK').length || 0,
              color: greens[300],
            },
            {
              value: swaps?.filter((s) => s.state === 'ERROR').length || 0,
              color: reds[300],
            },
          ]}>
          {mintInfo.icon_url ? (
            <Image source={{ uri: mintInfo.icon_url }} style={styles.logoImage} />
          ) : (
            <View style={styles.logo}>
              <Text style={styles.logoText}>
                {mintInfo.name ? mintInfo.name.charAt(0).toUpperCase() : 'M'}
              </Text>
            </View>
          )}
        </DonutChart>
      </View>
      <Text style={styles.mintTitle}>{mintInfo.name || 'Unknown Mint'}</Text>
      {mintInfo.version && <Text style={styles.mintVersion}>{mintInfo.version}</Text>}
      <View style={styles.container}>
        {new Array(days).fill(0).map((_, i) => {
          // Also generate the date range in UTC for consistency
          const date = dayjs()
            .utc()
            .subtract(days - i, 'day')
            .format('YYYY-MM-DD');

          const isLastCell = i === days - 1; // Last cell in the array

          const CellComponent = isLastCell ? Animated.View : View;
          const cellStyle = isLastCell
            ? {
                flex: 1,
                width: 8,
                margin: 1,
                borderRadius: 4,
                backgroundColor: getColor(data[date]?.successRate),
                height: Math.floor(30 - (20 * Math.log(days - i)) / Math.log(days)),
                opacity: opacityAnim,
              }
            : {
                flex: 1,
                width: 8,
                margin: 1,
                borderRadius: 4,
                opacity: 0.66,
                // make height be based on index and it should be log scale i want it to be largest at 30 and go down
                height: Math.floor(32 - (25 * Math.log(days - i)) / Math.log(days)),
                backgroundColor: getColor(data[date]?.successRate),
              };

          return <CellComponent key={date} style={cellStyle} />;
        })}
      </View>
      <StatsGrid
        theme={theme}
        // calculate success rate overall based on all the swaps
        successRate={swaps?.filter((s) => s.state === 'OK').length / (swaps?.length || 1)}
        avgResponse={swaps?.reduce((acc, swap) => acc + swap.time_taken, 0) / (swaps?.length || 1)}
      />
    </View>
  );
};

const StatsGrid = ({ theme, successRate, avgResponse }) => {
  const stats = [
    {
      label: 'Success Rate',
      value: successRate ? `${successRate * 100}%` : 'N/A',
      accent: true,
      description: 'Successful rate of transactions',
    },
    {
      label: 'Mint Speed',
      value: avgResponse ? `${(avgResponse / 1000).toFixed(1)}s` : 'N/A',
      accent: true,
      description: 'Typical processing time',
    },
    // {
    //   label: 'Rating',
    //   value: '4/5',
    //   accent: true,
    //   // user review count
    //   description: 'Out of 183 reviews',
    // },
    // {
    //   label: 'User Reviews',
    //   value: '182',
    //   accent: false,
    //   description: 'Community feedback',
    // },
    // {
    //   label: 'Rating',
    //   value: '4.8',
    //   accent: true,
    //   description: 'Out of 5 stars',
    // },
  ];
  const styles = createStyles(theme);

  return (
    <View style={styles.container3}>
      {stats.map((stat, index) => (
        <View key={index} style={[styles.statCard]}>
          {/* Subtle gradient overlay for depth */}

          <View style={styles.cardContent}>
            <Text style={[styles.label, { color: greys(theme)[400] }]}>{stat.label}</Text>

            <Text
              style={[
                styles.value3,
                stat.accent ? styles.accentValue : {},
                { color: greys(theme)[0] },
              ]}>
              {stat.value}
            </Text>

            <Text style={[styles.description, { color: greys(theme)[600] }]}>
              {stat.description}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
};

const createStyles = (theme: string) =>
  StyleSheet.create({
    container3: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      margin: -6, // Negative margin to offset card spacing
      marginTop: 8,
    },

    statCard: {
      width: '50%',
      padding: 6, // Outer padding for consistent grid gaps
    },

    cardContent: {
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: greys(theme)[1500],
      position: 'relative',
      overflow: 'hidden',
      minHeight: 90,
      justifyContent: 'space-between',
      backgroundColor: greys(theme)[1800],
      shadowColor: greys(theme)[1900],
      flex: 1,

      // Subtle shadow for depth
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 3,
    },

    gradientOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: opacity(greys(theme)[1900], 0.1),
    },

    label: {
      fontFamily: 'OverpassSemibold',
      fontSize: 13,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
      marginBottom: 4,
      opacity: 0.9,
    },

    value3: {
      fontFamily: 'OverpassSemibold',
      fontSize: 24,
      lineHeight: 28,
      marginBottom: 2,
      letterSpacing: -0.5,
    },

    accentValue: {
      fontSize: 26,
      lineHeight: 30,
    },

    description: {
      fontFamily: 'OverpassRegular',
      fontSize: 11,
      lineHeight: 14,
      opacity: 0.8,
      letterSpacing: 0.1,
    },

    accentLine: {
      position: 'absolute',
      top: 0,
      left: 16,
      right: 16,
      height: 2,
      borderRadius: 1,
    },
    container: {
      width: '100%',
      marginTop: 16,
      flexDirection: 'row',
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'flex-end',
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
    scrollContainer: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 16,
      color: greys(theme)[200],
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 20,
    },
    errorText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: '#D32F2F',
      textAlign: 'center',
      marginBottom: 8,
    },
    errorSubtext: {
      fontSize: 14,
      color: greys(theme)[200],
      textAlign: 'center',
    },
    headerContainer: {
      alignItems: 'center',
      paddingVertical: 24,
      paddingBottom: 32,
    },
    logoContainer: {
      marginBottom: 16,
    },
    logo: {
      width: 84,
      height: 84,
      borderRadius: 100,
      backgroundColor: '#3f836d',
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoImage: {
      width: 84,
      height: 84,
      borderRadius: 100,
      backgroundColor: greys(theme)[0],
    },
    logoText: {
      fontSize: 40,
      fontWeight: 'bold',
      color: '#ffffff',
    },
    mintTitle: {
      fontSize: 28,
      fontFamily: 'OverpassBold',
      color: greys(theme)[0],
      textAlign: 'center',
      marginBottom: 4,
    },
    mintVersion: {
      fontSize: 14,
      color: greys(theme)[200],
      textAlign: 'center',
    },
    descriptionContainer: {
      marginHorizontal: 16,
      marginBottom: 16,
      padding: 16,
      backgroundColor: greys(theme)[700],
      borderRadius: 12,
      borderLeftWidth: 4,
      borderLeftColor: '#FFA726',
    },
    descriptionText: {
      fontSize: 14,
      color: greys(theme)[100],
      lineHeight: 20,
    },
    actionButton: {
      backgroundColor: greens[500],
      borderRadius: 8,
      marginVertical: 2,
    },
    destructiveButton: {
      backgroundColor: '#D32F2F',
      borderRadius: 8,
      marginVertical: 2,
    },
    actionText: {
      fontSize: 16,
      fontWeight: '600',
      color: greys(theme)[0],
      textAlign: 'center',
    },
    destructiveText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#ffffff',
      textAlign: 'center',
    },
    copiedText: {
      fontSize: 12,
      color: greens[400],
      fontWeight: '600',
    },
    container2: {
      position: 'relative',
      justifyContent: 'center',
      alignItems: 'center',
    },
    centerContent2: {
      position: 'absolute',
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

export default Heatmap;
