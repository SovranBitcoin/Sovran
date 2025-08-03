import React, { useEffect, useState, useRef } from 'react';
import { Linking, ScrollView, Alert, StyleSheet, Animated, Image } from 'react-native';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { greens, greys, reds, Theme } from 'helper/colors';
import Wrapper from '../wrapper';
import { RowButton, Section } from 'app/settings';
import { useSheetRouteParams, useSheetRouter } from 'react-native-actions-sheet';
import { useWallet } from 'helper/cashuClient';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Card } from 'components/common/Card';
import { useSelector } from 'react-redux';
import Icon, { CurrencyIcon } from 'assets/icons';
import { memoizedGetTheme } from 'helper/redux/settings';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { useTypedNavigation } from 'helper/navigation';
import { npubToPubkey } from 'components/layout/Transaction';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';

// Extend dayjs with UTC plugin
dayjs.extend(utc);

// DonutChart component
const DonutChart = ({
  size = 96,
  strokeWidth = 2.5,
  sections = [
    { value: 1, color: '#4CAF50' },
    { value: 1, color: '#FF9800' },
    { value: 1, color: '#2196F3' },
  ],
  children,
  gap = 3.5,
  startAngle = 90,
}: {
  size?: number;
  strokeWidth?: number;
  sections?: { value: number; color: string }[];
  children?: React.ReactNode;
  gap?: number;
  startAngle?: number;
}) => {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;

  const totalValue = sections.reduce((sum, section) => sum + section.value, 0);

  const gapRad = (gap * Math.PI) / 180;
  const totalGapRad = gapRad * sections.length;
  const availableAngle = 2 * Math.PI - totalGapRad;

  const sectionPaths = sections.map((section, index) => {
    const sectionAngle = (section.value / totalValue) * availableAngle;

    let currentStartAngle = (startAngle * Math.PI) / 180;
    for (let i = 0; i < index; i++) {
      currentStartAngle += (sections[i].value / totalValue) * availableAngle + gapRad;
    }

    const endAngle = currentStartAngle + sectionAngle;

    const path = Skia.Path.Make();

    const startX = center + radius * Math.cos(currentStartAngle);
    const startY = center + radius * Math.sin(currentStartAngle);
    path.moveTo(startX, startY);

    path.arcToOval(
      Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2),
      (currentStartAngle * 180) / Math.PI,
      (sectionAngle * 180) / Math.PI,
      false
    );

    const innerRadius = radius - strokeWidth;
    const endX = center + innerRadius * Math.cos(endAngle);
    const endY = center + innerRadius * Math.sin(endAngle);
    path.lineTo(endX, endY);

    path.arcToOval(
      Skia.XYWHRect(center - innerRadius, center - innerRadius, innerRadius * 2, innerRadius * 2),
      (endAngle * 180) / Math.PI,
      -(sectionAngle * 180) / Math.PI,
      false
    );

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

// Interfaces
interface Swap {
  created_at: string;
  state: string;
  time_taken: number;
  amount: number;
  fee: number;
}

interface SwapsByDay {
  swaps: Swap[];
  totalAmount: number;
  totalFees: number;
  count: number;
  successRate: number;
}

// StatsGrid component
const StatsGrid = ({
  theme,
  successRate,
  avgResponse,
}: {
  theme: Theme;
  successRate: number;
  avgResponse: number;
}) => {
  const stats = [
    {
      label: 'Success Rate',
      value: successRate ? `${(successRate * 100).toFixed(1)}%` : 'N/A',
      accent: true,
      description: 'Successful rate of transactions',
    },
    {
      label: 'Mint Speed',
      value: avgResponse ? `${(avgResponse / 1000).toFixed(1)}s` : 'N/A',
      accent: true,
      description: 'Typical processing time',
    },
  ];
  const styles = createStyles(theme);

  return (
    <View style={styles.container3}>
      {stats.map((stat, index) => (
        <View key={index} style={[styles.statCard]}>
          <View style={styles.cardContent}>
            <Text style={[styles.label, { color: greys(theme)[200] }]}>{stat.label}</Text>

            <Text
              style={[
                styles.value3,
                stat.accent ? styles.accentValue : {},
                { color: greys(theme)[0] },
              ]}>
              {stat.value}
            </Text>

            <Text style={[styles.description, { color: greys(theme)[300] }]}>
              {stat.description}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
};

const MintDetailPage = () => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const router = useSheetRouter('mint');
  const params = useSheetRouteParams('mint', 'mintDetailsPage') as { mintUrl?: string } | undefined;
  const navigation = useTypedNavigation();

  const { wallet, loading, error } = useWallet({
    mintUrl: params?.mintUrl,
    forceRefresh: true,
    profile: null,
    unit: null,
  });

  // Heatmap state
  const [data, setData] = useState<Record<string, SwapsByDay>>({});
  const [swaps, setSwaps] = useState<Swap[]>([]);

  // Animation values for the subtle pulsating effect
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    const walletWithAudits = wallet as any;
    if (!walletWithAudits?.audits?.swaps) return;

    setSwaps(walletWithAudits.audits.swaps);

    const swapsByDayWithStats = walletWithAudits?.audits?.swaps?.reduce(
      (acc: Record<string, SwapsByDay>, swap: any) => {
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
          acc[date].swaps.filter((s: any) => s.state === 'OK').length / acc[date].count;

        return acc;
      },
      {}
    );

    setData(swapsByDayWithStats);
  }, [wallet]);

  // Start the subtle heartbeat animation
  useEffect(() => {
    const startSubtleHeartbeat = () => {
      Animated.sequence([
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
        Animated.delay(600),
      ]).start(() => {
        startSubtleHeartbeat();
      });
    };

    startSubtleHeartbeat();
  }, [pulseAnim, opacityAnim]);

  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const handleContactPress = (method: string, info: string) => {
    switch (method) {
      case 'email':
        Linking.openURL(`mailto:${info}`);
        break;
      case 'twitter':
      case 'x':
        Linking.openURL(`https://x.com/${info.replace('@', '')}`);
        break;
      case 'nostr':
        navigation.navigate('userMessages', {
          pubkey: npubToPubkey(info),
        });
        router?.close();
        break;
      default:
        handleCopy(info);
    }
  };

  const getColor = (successRate: number | undefined) => {
    if (successRate === undefined || successRate === null) return greys(theme)[700];
    if (successRate >= 0.9) return '#0CED3E';
    if (successRate >= 0.7) return '#ED9E0C';
    if (successRate >= 0.5) return '#ED9E0C';
    if (successRate >= 0.3) return '#FF0000';
    if (successRate >= 0.1) return '#ED0C46';
    if (successRate >= 0) return '#ED0C46';
    return greys(theme)[700];
  };

  // Get mint info - try to access it safely
  const mintInfo = wallet?.mintInfo;

  console.log(1231222223123, JSON.stringify(mintInfo, null, 2));

  console.log('mintInfo', mintInfo);

  // Render the mint icon/logo even if loading
  const renderMintIcon = () => {
    if (mintInfo?.icon_url) {
      return <Image source={{ uri: mintInfo.icon_url }} style={styles.logoImage} />;
    } else {
      return (
        <View style={styles.logo}>
          <Text style={styles.logoText}>
            {mintInfo?.name ? mintInfo.name.charAt(0).toUpperCase() : 'M'}
          </Text>
        </View>
      );
    }
  };

  if (loading) {
    return (
      <Wrapper>
        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          <View style={styles.headerContainer}>
            <View style={styles.logoContainer}>
              <DonutChart
                sections={[
                  {
                    value: 1,
                    color: greys(theme)[600],
                  },
                ]}>
                {renderMintIcon()}
              </DonutChart>
            </View>
            <Text style={styles.mintTitle}>{mintInfo?.name || 'Loading...'}</Text>
            {mintInfo?.version && <Text style={styles.mintVersion}>{mintInfo.version}</Text>}
          </View>
        </ScrollView>
      </Wrapper>
    );
  }

  if (error || !wallet?.mintInfo) {
    return (
      <Wrapper>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Failed to load mint details</Text>
          <Text style={styles.errorSubtext}>{(error as any)?.message || 'Unknown error'}</Text>
        </View>
      </Wrapper>
    );
  }

  const days = 45;

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => router?.goBack(),
            },
          ]}
        />
      }>
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
        {/* Mint Header with integrated heatmap */}
        <View style={styles.headerContainer}>
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
              {renderMintIcon()}
            </DonutChart>
          </View>
          <Text style={styles.mintTitle}>{mintInfo?.name || 'Unknown Mint'}</Text>
          {mintInfo?.version && <Text style={styles.mintVersion}>{mintInfo.version}</Text>}

          {/* Heatmap visualization */}
          <View style={styles.heatmapContainer}>
            {new Array(days).fill(0).map((_, i) => {
              const date = dayjs()
                .utc()
                .subtract(days - i, 'day')
                .format('YYYY-MM-DD');

              const isLastCell = i === days - 1;

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
                    height: Math.floor(32 - (25 * Math.log(days - i)) / Math.log(days)),
                    backgroundColor: getColor(data[date]?.successRate),
                  };

              return <CellComponent key={date} style={cellStyle} />;
            })}
          </View>

          {/* Stats Grid */}
          <StatsGrid
            theme={theme}
            successRate={swaps?.filter((s) => s.state === 'OK').length / (swaps?.length || 1)}
            avgResponse={
              swaps?.reduce((acc, swap) => acc + swap.time_taken, 0) / (swaps?.length || 1)
            }
          />
        </View>

        {/* Description Card */}
        {mintInfo?.description && (
          <>
            <Card variant="info" message={mintInfo.description} />
            <Spacer size={12} />
          </>
        )}

        {/* Long Description */}
        {mintInfo?.description_long && (
          <>
            <Card variant="warning" message={mintInfo.description_long} />
            <Spacer size={12} />
          </>
        )}

        {/* Message of the Day */}
        {mintInfo?.motd && (
          <>
            <Card variant="warning" message={`Message: ${mintInfo.motd}`} />
            <Spacer size={12} />
          </>
        )}

        {/* Contact Section */}
        {mintInfo?.contact && mintInfo.contact.length > 0 && (
          <Section title="Contact">
            {mintInfo.contact.map((contact: any, index: number) => (
              <RowButton
                isFirst={index === 0}
                key={index}
                label={
                  contact.method.toUpperCase() === 'NOSTR' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <CurrencyIcon colors={[greys(theme)[400]]} width={20} currency={'nostr'} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </View>
                  ) : ['X', 'TWITTER'].includes(contact.method.toUpperCase()) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="hugeicons:new-twitter" size={20} color={greys(theme)[400]} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Icon name="mdi:at" size={20} color={greys(theme)[400]} />
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </View>
                  )
                }
                onPress={() => handleContactPress(contact.method, contact.info)}
              />
            ))}
          </Section>
        )}
      </ScrollView>
    </Wrapper>
  );
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
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
      color: greys(theme)[100],
      textAlign: 'center',
    },
    heatmapContainer: {
      width: '100%',
      marginTop: 16,
      flexDirection: 'row',
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'flex-end',
    },
    container3: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      margin: -6,
      marginTop: 8,
    },
    statCard: {
      width: '50%',
      padding: 6,
    },
    cardContent: {
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: greys(theme)[700],
      position: 'relative',
      overflow: 'hidden',
      minHeight: 90,
      justifyContent: 'space-between',
      backgroundColor: greys(theme)[800],
      shadowColor: greys(theme)[900],
      flex: 1,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 3,
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
    actionButton: {
      backgroundColor: greens[300],
      borderRadius: 8,
      marginVertical: 2,
    },
    actionText: {
      fontSize: 16,
      fontWeight: '600',
      color: greys(theme)[0],
      textAlign: 'center',
    },
  });

export default MintDetailPage;
