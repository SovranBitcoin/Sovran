import React, { useState, useEffect, useRef } from 'react';
import { ScrollView, Animated, Alert, Linking } from 'react-native';
import { useSheetRef, useSheetPayload } from 'react-native-actions-sheet';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { VStack, Spacer, HStack, View } from 'components/ui/View';
import { npubToPubkey } from 'components/blocks/Transaction';
import { useMintManagement } from 'hooks/coco';
import { useAuditedMint } from 'hooks/coco/useAuditedMint';
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
  successRate,
  avgResponse,
  mintSpeed,
  totalMints,
  totalMelts,
}: {
  successRate?: number;
  avgResponse?: number;
  mintSpeed?: number;
  totalMints?: number;
  totalMelts?: number;
}) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();
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
            className="border-primary-700 bg-primary-800 rounded-xl border p-4"
            style={{
              shadowColor: getPrimaryColor('950'),
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 8,
              elevation: 3,
            }}>
            <Text className="text-primary-200 mb-1 text-xs font-semibold uppercase tracking-wide">
              {stat.label}
            </Text>

            <Text
              className={`text-primary-0 mb-0.5 text-2xl font-semibold leading-7 tracking-tight ${
                stat.accent ? 'text-2xl leading-8' : ''
              }`}>
              {stat.value}
            </Text>

            <Text className="text-primary-300 text-xs leading-4 tracking-wide opacity-80">
              {stat.description}
            </Text>
          </VStack>
        </View>
      ))}
    </HStack>
  );
};

const InfoRoute = () => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();
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

  // Use audited mint hook to get audit data for this specific mint
  const {
    auditInfo,
    mintInfo: auditMintInfo,
    loading: auditLoading,
    error: auditError,
  } = useAuditedMint(mintUrl);

  // Debug logging
  console.log('InfoRoute - mintUrl:', mintUrl);
  console.log('InfoRoute - global.currentMintUrl:', (global as any).currentMintUrl);
  console.log('InfoRoute - payload:', payload);
  console.log('InfoRoute - auditInfo:', auditInfo);
  console.log('InfoRoute - auditMintInfo:', auditMintInfo);

  // Helper functions
  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  const handleContactPress = async (method: string, info: string) => {
    try {
      switch (method.toLowerCase()) {
        case 'email':
          await Linking.openURL(`mailto:${info}`);
          break;
        case 'twitter':
        case 'x':
          // Remove @ symbol if present and open X app
          const username = info.replace('@', '');
          await Linking.openURL(`https://x.com/${username}`);
          break;
        case 'nostr':
          // Convert npub to pubkey if needed and navigate to userMessages
          const pubkey = npubToPubkey(info);
          router.push({
            pathname: '/userMessages',
            params: {
              pubkey: pubkey,
            },
          });
          // Close the current sheet
          sheetRef.current?.hide();
          break;
        default:
          // Fallback to copying to clipboard
          await handleCopy(info);
      }
    } catch (error) {
      console.error('Error opening contact link:', error);
      // Fallback to copying to clipboard if opening fails
      Alert.alert('Unable to open', 'Copying to clipboard instead', [
        {
          text: 'OK',
          onPress: () => handleCopy(info),
        },
      ]);
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
        picture={mintInfo?.icon_url || auditMintInfo?.icon_url}
        size={70}
        variant="person"
        name={
          mintInfo?.name || auditMintInfo?.name || mintUrl?.replace('https://', '').split('/')[0]
        }
        alt={`${mintInfo?.name || auditMintInfo?.name || 'Mint'} icon`}
        status={auditInfo?.auditorData?.state}
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
                variant="round"
                sections={[
                  {
                    value: 5,
                    color: getPrimaryColor('600'),
                  },
                  {
                    value: 5,
                    color: getPrimaryColor('700'),
                  },
                ]}>
                {renderMintIcon()}
              </DonutChart>
            </VStack>
            <Text className="text-primary-0 mb-1 text-center text-3xl font-bold">
              {mintInfo?.name || 'Loading...'}
            </Text>
            {mintInfo?.version && (
              <Text className="text-primary-100 text-center text-sm">{mintInfo.version}</Text>
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
    auditMintInfo?.name ||
    auditInfo?.auditorData?.name ||
    mintUrl?.split('//')[1]?.split('/')[0] ||
    'Unknown Mint';

  // Calculate stats from audit data
  const totalMints = auditInfo?.auditorData?.mints;
  const totalMelts = auditInfo?.auditorData?.melts;
  const totalErrors = auditInfo?.auditorData?.errors;

  // Calculate success rate: prefer KYM score, fallback to error-based calculation
  const successRate = auditInfo?.score
    ? auditInfo.score / 5 // KYM score is 0-5, normalize to 0-1
    : (() => {
        const totalOps = (totalMints || 0) + (totalMelts || 0);
        return totalOps > 0 ? 1 - (totalErrors || 0) / totalOps : undefined;
      })();

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
              variant="round"
              sections={[
                {
                  value: hasError ? 3 : (successRate || 0.5) * 10,
                  color: hasError ? getPrimaryColor('600') : getGreenColor('300'),
                },
                {
                  value: hasError ? 7 : (1 - (successRate || 0.5)) * 10,
                  color: hasError ? getPrimaryColor('700') : getRedColor('300'),
                },
              ]}>
              {renderMintIcon()}
            </DonutChart>
          </VStack>
          <Text className="text-primary-0 mb-1 text-center text-3xl font-bold">{displayName}</Text>
          {mintInfo?.version && (
            <Text className="text-primary-100 text-center text-sm">{mintInfo.version}</Text>
          )}

          {/* Stats Grid */}
          <StatsGrid
            successRate={successRate}
            mintSpeed={auditInfo?.speedIndex}
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
                      <CurrencyIcon
                        colors={[getPrimaryColor('400')]}
                        width={20}
                        currency={'nostr'}
                      />
                      <Text className="text-primary-50" bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </HStack>
                  ) : ['X', 'TWITTER'].includes(contact.method.toUpperCase()) ? (
                    <HStack align="center" gap={8}>
                      <Icon name="hugeicons:new-twitter" size={20} color={getPrimaryColor('400')} />
                      <Text className="text-primary-50" bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <HStack align="center" gap={8}>
                      <Icon name="mdi:at" size={20} color={getPrimaryColor('400')} />
                      <Text className="text-primary-50" bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : (
                    <HStack align="center">
                      <Text className="text-primary-50" bold>
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
