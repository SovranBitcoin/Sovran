import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ScrollView, Animated, Alert } from 'react-native';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, greens, reds } from 'helper/colors';
import { Text } from 'components/ui/Text';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { VStack, Spacer, HStack, View } from 'components/ui/View';
import { useMintManagement } from 'hooks/coco';
import { useDiscoveredMints } from 'hooks/coco/useDiscoveredMints';
import { Card } from 'components/ui/Card';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
// migrate to non-skia package
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

// Extend dayjs with UTC plugin
dayjs.extend(utc);

// DonutChart component
const DonutChart = ({
  strokeWidth = 2.5,
  sections = [
    { value: 1, color: '#4CAF50' },
    { value: 1, color: '#FF9800' },
    { value: 1, color: '#2196F3' },
  ],
  children,
  gap = 3.5,
  startAngle = 90,
  padding = 6,
  size,
  style,
  variant = 'mint',
}: {
  strokeWidth?: number;
  sections?: { value: number; color: string }[];
  children?: React.ReactNode;
  gap?: number;
  startAngle?: number;
  padding?: number;
  size?: number;
  style?: any;
  variant?: 'round' | 'mint';
}) => {
  // Use provided size or default to 84, but allow parent styling to override
  const containerSize = size || 84;

  const center = containerSize / 2;
  const radius = (containerSize - strokeWidth) / 2;

  const totalValue = sections.reduce((sum, section) => sum + section.value, 0);

  const gapRad = (gap * Math.PI) / 180;
  const totalGapRad = gapRad * sections.length;
  const availableAngle = 2 * Math.PI - totalGapRad;

  // Only create section paths for round variant
  const sectionPaths =
    variant === 'round'
      ? sections.map((section, index) => {
          const sectionAngle = (section.value / totalValue) * availableAngle;

          let currentStartAngle = (startAngle * Math.PI) / 180;
          for (let i = 0; i < index; i++) {
            currentStartAngle += (sections[i].value / totalValue) * availableAngle + gapRad;
          }

          const endAngle = currentStartAngle + sectionAngle;

          const path = Skia.Path.Make();

          // Draw circular donut for round variant
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
            Skia.XYWHRect(
              center - innerRadius,
              center - innerRadius,
              innerRadius * 2,
              innerRadius * 2
            ),
            (endAngle * 180) / Math.PI,
            -(sectionAngle * 180) / Math.PI,
            false
          );

          path.close();

          return {
            path,
            color: section.color,
          };
        })
      : [];

  // Calculate border radius based on variant
  const borderRadius =
    variant === 'round'
      ? containerSize / 2 // Perfect circle for round variant
      : containerSize * 0.25; // Square rounded for mint variant (25% of size)

  return (
    <View
      style={{
        position: 'relative',
        width: containerSize,
        height: containerSize,
        borderRadius: borderRadius,
        overflow: 'hidden',
        ...style,
      }}>
      <Canvas style={{ width: containerSize, height: containerSize }}>
        <Group>
          {variant === 'round' ? (
            // For round variant, use the original circular paths
            sectionPaths.map((section, index) => (
              <Path strokeJoin="round" key={index} path={section.path} color={section.color} />
            ))
          ) : (
            // For mint variant, create a proper rounded rectangle donut
            <Group>
              {/* Create outer rounded rectangle */}
              <Path
                path={Skia.Path.Make().addRRect(
                  Skia.RRectXY(
                    Skia.XYWHRect(center - radius, center - radius, radius * 2, radius * 2),
                    borderRadius,
                    borderRadius
                  )
                )}
                color={sections[0]?.color || '#4CAF50'}
              />
              {/* Create inner rounded rectangle for donut effect */}
              <Path
                path={Skia.Path.Make().addRRect(
                  Skia.RRectXY(
                    Skia.XYWHRect(
                      center - (radius - strokeWidth),
                      center - (radius - strokeWidth),
                      (radius - strokeWidth) * 2,
                      (radius - strokeWidth) * 2
                    ),
                    borderRadius * ((radius - strokeWidth) / radius),
                    borderRadius * ((radius - strokeWidth) / radius)
                  )
                )}
                color="transparent"
                blendMode="clear"
              />
            </Group>
          )}
        </Group>
      </Canvas>

      <View
        style={{
          position: 'absolute',
          top: padding,
          left: padding,
          right: padding,
          bottom: padding,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
        {children}
      </View>
    </View>
  );
};

// StatsGrid component
const StatsGrid = ({
  theme,
  successRate,
  avgResponse,
  mintSpeed,
  totalMints,
  totalMelts,
}: {
  theme: any;
  successRate?: number;
  avgResponse?: number;
  mintSpeed?: number;
  totalMints?: number;
  totalMelts?: number;
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
      value: mintSpeed
        ? `${mintSpeed.toFixed(1)}s`
        : avgResponse
          ? `${(avgResponse / 1000).toFixed(1)}s`
          : 'N/A',
      accent: true,
      description: 'Typical processing time',
    },
    {
      label: 'Total Mints',
      value: totalMints ? totalMints.toString() : 'N/A',
      accent: false,
      description: 'Total mint operations',
    },
    {
      label: 'Total Melts',
      value: totalMelts ? totalMelts.toString() : 'N/A',
      accent: false,
      description: 'Total melt operations',
    },
  ];

  return (
    <HStack wrap="wrap" className="-m-1.5 mt-2">
      {stats.map((stat, index) => (
        <View key={index} className="w-1/2 p-1.5">
          <VStack
            justify="space-between"
            className="rounded-xl border p-4"
            style={{
              borderColor: greys(theme)[700],
              backgroundColor: greys(theme)[800],
              shadowColor: greys(theme)[900],
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 8,
              elevation: 3,
            }}>
            <Text
              className="mb-1 text-xs font-semibold uppercase tracking-wide"
              style={{ color: greys(theme)[200] }}>
              {stat.label}
            </Text>

            <Text
              className={`mb-0.5 text-2xl font-semibold leading-7 tracking-tight ${
                stat.accent ? 'text-2xl leading-8' : ''
              }`}
              style={{ color: greys(theme)[0] }}>
              {stat.value}
            </Text>

            <Text
              className="text-xs leading-4 tracking-wide opacity-80"
              style={{ color: greys(theme)[300] }}>
              {stat.description}
            </Text>
          </VStack>
        </View>
      ))}
    </HStack>
  );
};

const InfoRoute = () => {
  const theme = useSelector(memoizedGetTheme);
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getMintInfo } = useMintManagement();

  const [mintInfo, setMintInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Animation values for the subtle pulsating effect
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.8)).current;

  // Get mintUrl from global variable or payload
  const mintUrl = (global as any).currentMintUrl || payload?.mintUrl;

  // Use discovered mints hook to get audit data
  const { mints: discoveredMints, loading: auditLoading, error: auditError } = useDiscoveredMints();

  // Find the specific mint data from discovered mints
  const auditData = useMemo(() => {
    if (!mintUrl || !discoveredMints.length) return null;
    return discoveredMints.find((mint) => mint.url === mintUrl);
  }, [discoveredMints, mintUrl]);

  // Debug logging
  console.log('InfoRoute - mintUrl:', mintUrl);
  console.log('InfoRoute - global.currentMintUrl:', (global as any).currentMintUrl);
  console.log('InfoRoute - payload:', payload);
  console.log('InfoRoute - auditData:', auditData);

  // Helper functions
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
        // Linking.openURL(`mailto:${info}`);
        handleCopy(info);
        break;
      case 'twitter':
      case 'x':
        // Linking.openURL(`https://x.com/${info.replace('@', '')}`);
        handleCopy(info);
        break;
      case 'nostr':
        handleCopy(info);
        break;
      default:
        handleCopy(info);
    }
  };

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

  useEffect(() => {
    const fetchMintInfo = async () => {
      if (!mintUrl) {
        setError('No mint URL provided');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch mint info using Coco - audit data comes from useDiscoveredMints
        const mintInfoData = await getMintInfo(mintUrl);
        setMintInfo(mintInfoData);
      } catch (err) {
        console.error('Failed to fetch mint info:', err);
        setError('Failed to load mint information');
      } finally {
        setLoading(false);
      }
    };

    fetchMintInfo();
  }, [mintUrl, getMintInfo]);

  const renderMintIcon = () => {
    return (
      <Avatar
        picture={mintInfo?.icon_url || auditData?.mintInfo?.icon_url}
        size={70}
        variant="mint"
        name={
          mintInfo?.name ||
          auditData?.auditInfo?.auditorData?.name ||
          mintUrl?.replace('https://', '').split('/')[0]
        }
        alt={`${mintInfo?.name || auditData?.auditInfo?.auditorData?.name || 'Mint'} icon`}
        status={auditData?.auditInfo?.auditorData?.state}
      />
    );
  };

  // Combined loading state - show loading if either mint info or audit data is loading
  const isLoading = loading || auditLoading;

  if (isLoading) {
    return (
      <Wrapper
        buttons={
          <ButtonHandler
            context="sheet"
            buttons={[
              {
                text: 'Close',
                variant: 'secondary',
                onPress: async () => sheetRef.current?.hide(),
              },
            ]}
          />
        }>
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <VStack align="center" className="py-6 pb-8">
            <VStack align="center" className="mb-4">
              <DonutChart
                size={84}
                variant="mint"
                sections={[
                  {
                    value: 1,
                    color: greys(theme)[600],
                  },
                ]}>
                {renderMintIcon()}
              </DonutChart>
            </VStack>
            <Text
              className="mb-1 text-center text-3xl font-bold"
              style={{ color: greys(theme)[0] }}>
              {mintInfo?.name || 'Loading...'}
            </Text>
            {mintInfo?.version && (
              <Text className="text-center text-sm" style={{ color: greys(theme)[100] }}>
                {mintInfo.version}
              </Text>
            )}
          </VStack>
        </ScrollView>
      </Wrapper>
    );
  }

  const hasError = error || auditError || !mintInfo;

  // Fallback mint name from URL if no mint info available
  const displayName =
    mintInfo?.name ||
    auditData?.auditInfo?.auditorData?.name ||
    mintUrl?.split('//')[1]?.split('/')[0] ||
    'Unknown Mint';

  // Calculate stats from audit data
  const successRate = auditData?.auditInfo?.recommendations?.length
    ? auditData.auditInfo.recommendations.reduce((acc: number, rec: any) => acc + rec.score, 0) /
      auditData.auditInfo.recommendations.length /
      5
    : undefined;

  const totalMints = auditData?.auditInfo?.auditorData?.mints;
  const totalMelts = auditData?.auditInfo?.auditorData?.melts;

  return (
    <Wrapper
      buttons={
        <ButtonHandler
          context="sheet"
          buttons={[
            {
              text: 'Close',
              variant: 'secondary',
              onPress: async () => sheetRef.current?.hide(),
            },
          ]}
        />
      }>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Error notification if there's an issue loading data */}
        {hasError && (
          <>
            <Card
              variant="warning"
              message={`Failed to load complete mint details: ${
                error || auditError || 'Some information may be missing'
              }`}
            />
            <Spacer size={12} />
          </>
        )}

        {/* Mint Header with integrated stats */}
        <VStack align="center" className="py-6 pb-8">
          <VStack align="center" className="mb-4">
            <DonutChart
              size={84}
              variant="mint"
              sections={[
                {
                  value: successRate ? successRate * 10 : 1,
                  color: hasError ? greys(theme)[600] : greens[300],
                },
                {
                  value: successRate ? (1 - successRate) * 10 : 0,
                  color: hasError ? greys(theme)[700] : reds[300],
                },
              ]}>
              {renderMintIcon()}
            </DonutChart>
          </VStack>
          <Text className="mb-1 text-center text-3xl font-bold" style={{ color: greys(theme)[0] }}>
            {displayName}
          </Text>
          {mintInfo?.version && (
            <Text className="text-center text-sm" style={{ color: greys(theme)[100] }}>
              {mintInfo.version}
            </Text>
          )}

          {/* Stats Grid */}
          <StatsGrid
            theme={theme}
            successRate={successRate}
            totalMints={totalMints}
            totalMelts={totalMelts}
          />
        </VStack>

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

        {/* Contact Section - only show if we have contact info */}
        {mintInfo?.contact && mintInfo.contact.length > 0 && (
          <Section title="Contact">
            {mintInfo.contact.map((contact: any, index: number) => (
              <RowButton
                isFirst={index === 0}
                key={index}
                label={
                  contact.method.toUpperCase() === 'NOSTR' ? (
                    <HStack align="center" gap={8}>
                      <CurrencyIcon colors={[greys(theme)[400]]} width={20} currency={'nostr'} />
                      <Text style={{ color: greys(theme)[50] }} bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </HStack>
                  ) : ['X', 'TWITTER'].includes(contact.method.toUpperCase()) ? (
                    <HStack align="center" gap={8}>
                      <Icon name="hugeicons:new-twitter" size={20} color={greys(theme)[400]} />
                      <Text style={{ color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <HStack align="center" gap={8}>
                      <Icon name="mdi:at" size={20} color={greys(theme)[400]} />
                      <Text style={{ color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : (
                    <HStack align="center">
                      <Text style={{ color: greys(theme)[50] }} bold>
                        {contact.info}
                      </Text>
                    </HStack>
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

export default InfoRoute;
