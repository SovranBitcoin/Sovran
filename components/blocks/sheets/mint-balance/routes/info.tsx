/**
 * @fileoverview InfoRoute - Detailed mint information and audit data
 *
 * @module components/blocks/sheets/mint-balance/routes/info
 *
 * @description
 * Displays comprehensive mint details including audit scores, contact info, stats,
 * and performance metrics. Users can view mint reliability, contact operators, and inspect details.
 *
 * **Navigation:**
 * - From: `router.navigate('info', {mintUrl})` from list route
 * - To: `router.goBack()` or external links (email, social, nostr)
 * - Close: `sheetRef.current?.hide()`
 *
 * **Data:**
 * - Payload: `useSheetPayload('mint-balance')` - Optional mintUrl override
 * - Params: `{mintUrl: string}` - Passed via `router.navigate('info', {mintUrl})`
 *
 * **Flow:** Load mint info → display stats → show contact options → user interacts → close
 *
 * @see {@link ./list}
 * @see {@link ./add}
 */

import React, { useState, useEffect, useRef } from 'react';
import { ScrollView, Animated, Alert, Linking } from 'react-native';
import { useSheetRef, useSheetPayload, RouteScreenProps } from 'react-native-actions-sheet';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import Wrapper from '../../wrapper';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { VStack, Spacer, HStack, View } from 'components/ui/View';
import { npubToPubkey } from 'components/blocks/Transaction';
import { useMintManagement } from 'hooks/coco';
import { extractDomain } from '@/helper/url';
import { useAuditedMint } from 'hooks/coco/useAuditedMint';
import { useKYMMint } from 'hooks/coco/useKYMMint';
import { Card } from 'components/ui/Card';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { Canvas, Path, Skia, Group } from '@shopify/react-native-skia';
import { getUsername } from '@/helper/username';

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
  const { getPrimaryColor } = useTheme();
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
            className="rounded-xl border border-primary-700 bg-primary-800 p-4"
            style={{
              shadowColor: getPrimaryColor('950'),
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.1,
              shadowRadius: 8,
              elevation: 3,
            }}>
            <Text bold overpass size={12} className="mb-1 uppercase tracking-wide text-primary-200">
              {stat.label}
            </Text>

            <Text
              bold
              overpass
              size={20}
              className={`mb-0.5 leading-7 tracking-tight text-primary-0 ${
                stat.accent ? 'text-2xl leading-8' : ''
              }`}>
              {stat.value}
            </Text>

            <Text
              bold
              overpass
              size={12}
              className="leading-4 tracking-wide text-primary-300 opacity-80">
              {stat.description}
            </Text>
          </VStack>
        </View>
      ))}
    </HStack>
  );
};

// RatingDisplay component
const RatingDisplay = ({ score, recommendations }: { score?: number; recommendations?: any[] }) => {
  const { getPrimaryColor } = useTheme();

  if (score === undefined) {
    return null;
  }

  // Determine which row should show gold stars
  // Use ceiling so that scores like 1.1 go to the 2-star row, 2.3 goes to 3-star row, etc.
  const targetRow = Math.max(1, Math.min(5, Math.ceil(score)));

  // Calculate the percentage of gold for the target row (score / rowStars)
  // This gives us the fraction of that row that should be gold
  const goldPercentage = Math.min(1, score / targetRow);

  // Calculate review distribution (5 stars down to 1 star)
  const distribution = [5, 4, 3, 2, 1].map((starRating) => {
    if (!recommendations || recommendations.length === 0) {
      return { stars: starRating, percentage: 0 };
    }
    const count = recommendations.filter((rec) => Math.round(rec.score) === starRating).length;
    const percentage = recommendations.length > 0 ? count / recommendations.length : 0;
    return { stars: starRating, percentage };
  });

  const displayScore = score % 1 === 0 ? score.toString() : score.toFixed(1);

  return (
    <HStack align="flex-start" gap={16} className="w-full px-4">
      {/* Large score display on the left */}
      <VStack align="center" spacing={0}>
        <Text size={32} heavy className="text-primary-0">
          {Number(displayScore).toFixed(1)}
        </Text>
        <Text size={12} className="text-primary-300">
          out of 5
        </Text>
      </VStack>

      {/* Star distribution bars on the right */}
      <VStack spacing={4} className="flex-1" style={{ flex: 1, minWidth: 0 }}>
        {distribution.map(({ stars, percentage }) => {
          const isTargetRow = stars === targetRow;
          // Calculate how many full stars should be gold (e.g., 1.1 in 2-star row = 1 full star)
          const fullGoldStars = isTargetRow ? Math.floor(goldPercentage * stars) : 0;
          // Calculate if there's a partial star (e.g., 1.1 in 2-star row has 0.1 of second star)
          const hasPartialStar = isTargetRow && goldPercentage * stars > fullGoldStars;

          return (
            <HStack
              key={stars}
              align="center"
              gap={4}
              className="w-full"
              style={{ flex: 1, minWidth: 0 }}>
              {/* Star rating label */}
              <HStack align="center" gap={2} style={{ flexShrink: 0 }}>
                {[5, 4, 3, 2, 1].slice(0, stars).map((_, idx) => {
                  const isFullGold = isTargetRow && idx < fullGoldStars;
                  const isPartialGold = isTargetRow && idx === fullGoldStars && hasPartialStar;

                  return (
                    <Icon
                      key={idx}
                      name="ic:round-star"
                      size={12}
                      color={
                        isFullGold ? '#FFD700' : isPartialGold ? '#FFD700' : getPrimaryColor('400')
                      }
                      style={
                        isPartialGold
                          ? { opacity: goldPercentage * stars - fullGoldStars }
                          : undefined
                      }
                    />
                  );
                })}
              </HStack>

              {/* Distribution bar directly after stars */}
              <View
                className="h-2 flex-1 overflow-hidden rounded-full"
                style={{
                  flex: 1,
                  minWidth: 0,
                  backgroundColor: isTargetRow
                    ? 'rgba(255, 215, 0, 0.2)' // Off-gold background for gold bar
                    : getPrimaryColor('700'),
                }}>
                <View
                  className="h-full rounded-full"
                  style={{
                    width: isTargetRow ? `${goldPercentage * 100}%` : `${percentage * 100}%`,
                    backgroundColor: isTargetRow
                      ? '#FFD700'
                      : percentage > 0
                        ? getPrimaryColor('400')
                        : 'transparent',
                  }}
                />
              </View>
            </HStack>
          );
        })}
      </VStack>
    </HStack>
  );
};

// ReviewsList component
const ReviewsList = ({ recommendations }: { recommendations?: any[] }) => {
  const { getPrimaryColor } = useTheme();
  const [currentPage, setCurrentPage] = useState(0);
  const reviewsPerPage = 3;

  if (!recommendations || recommendations.length === 0) {
    return null;
  }

  // Calculate pagination
  const totalPages = Math.ceil(recommendations.length / reviewsPerPage);
  const startIndex = currentPage * reviewsPerPage;
  const endIndex = Math.min(startIndex + reviewsPerPage, recommendations.length);
  const currentReviews = recommendations.slice(startIndex, endIndex);

  const handlePrevPage = () => {
    setCurrentPage((prev) => Math.max(0, prev - 1));
  };

  const handleNextPage = () => {
    setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
  };

  return (
    <VStack spacing={12} className="w-full px-4">
      {/* Reviews */}
      <VStack spacing={0} className="w-full">
        {currentReviews.map((review, index) => {
          // Extract review data - adjust property names based on actual KYM structure
          const reviewText = review.comment;
          const reviewScore = review.score;

          // Determine display name - prefer name, fallback to truncated npub
          const displayName = getUsername(review.pubkey);

          return (
            <View key={index} style={{ width: '100%' }}>
              {index > 0 && (
                <View
                  className="h-px w-full"
                  style={{ backgroundColor: getPrimaryColor('700'), marginVertical: 16 }}
                />
              )}
              <HStack align="flex-start" gap={12} style={{ width: '100%', flex: 1 }}>
                {/* Avatar */}
                <View style={{ flexShrink: 0 }}>
                  <Avatar seed={review.pubkey} size={40} variant="person" />
                </View>

                {/* Review content */}
                <VStack spacing={4} className="flex-1" style={{ flex: 1, minWidth: 0 }}>
                  {/* User identifier and date */}
                  <HStack
                    align="center"
                    justify="space-between"
                    className="w-full"
                    style={{ flex: 1, minWidth: 0 }}>
                    <HStack align="center" gap={6} style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        size={14}
                        bold
                        className="text-primary-0"
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{ flex: 1, minWidth: 0 }}>
                        {displayName}
                      </Text>
                    </HStack>
                  </HStack>

                  {/* Star rating */}
                  <HStack align="center" gap={2} style={{ flexShrink: 0 }}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Icon
                        key={star}
                        name="ic:round-star"
                        size={14}
                        color={star <= Math.round(reviewScore) ? '#FFD700' : getPrimaryColor('600')}
                      />
                    ))}
                  </HStack>

                  {/* Review text */}
                  {reviewText && (
                    <Text
                      size={14}
                      className="text-primary-200"
                      numberOfLines={10}
                      ellipsizeMode="tail"
                      style={{ flex: 1, minWidth: 0 }}>
                      {reviewText}
                    </Text>
                  )}
                </VStack>
              </HStack>
            </View>
          );
        })}
      </VStack>

      {/* Pagination Controls */}
      <View
        className="w-full rounded-full border border-primary-600 bg-primary-900 px-4"
        style={{ position: 'relative' }}>
        <HStack align="center" className="w-full">
          {/* Previous Button - 50% width */}
          <View
            className="flex-1 p-3"
            style={{
              width: '50%',
              opacity: currentPage === 0 ? 0.5 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onTouchEnd={() => currentPage > 0 && handlePrevPage()}>
            <Icon name="fa6-solid:chevron-left" size={12} color={getPrimaryColor('200')} />
          </View>

          <Text size={12} bold className="text-primary-200">
            {currentPage + 1} / {totalPages}
          </Text>

          {/* Next Button - 50% width */}
          <View
            className="flex-1 p-3"
            style={{
              width: '50%',
              opacity: currentPage === totalPages - 1 ? 0.5 : 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onTouchEnd={() => currentPage < totalPages - 1 && handleNextPage()}>
            <Icon name="fa6-solid:chevron-right" size={12} color={getPrimaryColor('200')} />
          </View>
        </HStack>
      </View>
    </VStack>
  );
};

/**
 * InfoRoute Component
 *
 * @component
 * @param {RouteScreenProps<'mint-balance', 'info'>} props
 * @returns {JSX.Element}
 */
const InfoRoute = ({ params }: RouteScreenProps<'mint-balance', 'info'>) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();
  const sheetRef = useSheetRef('mint-balance');
  const payload = useSheetPayload('mint-balance');
  const { getMintInfo } = useMintManagement();

  const [mintInfo, setMintInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReviews, setShowReviews] = useState(false);

  // Animation values for the subtle pulsating effect
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.8)).current;

  // Get mintUrl from route params, global variable, or payload
  const mintUrl = params?.mintUrl || (global as any).currentMintUrl || payload?.mintUrl;

  console.log('🔍 INFO PAGE DEBUG:');
  console.log('📋 Params:', params);
  console.log('📋 Params mintUrl:', params?.mintUrl);
  console.log('📋 Payload mintUrl:', payload?.mintUrl);
  console.log('📋 Final mintUrl:', mintUrl);

  // Use audited mint hook to get audit data for this specific mint
  const {
    auditInfo,
    mintInfo: auditMintInfo,
    loading: auditLoading,
    error: auditError,
  } = useAuditedMint(mintUrl);

  // Fetch KYM rating data
  const { score: kymScore, recommendations: kymRecommendations } = useKYMMint(mintUrl);
  /**
   * Handles text copying to clipboard
   *
   * @async
   * @description Copies text to clipboard with error handling
   *
   * **Process:** Clipboard.setStringAsync() → show alert on error
   * **Effects:** Clipboard write, error alerts
   *
   * @param {string} text - Text to copy
   */
  const handleCopy = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  };

  /**
   * Handles contact method interactions
   *
   * @async
   * @description Opens appropriate app/link based on contact method, falls back to clipboard
   *
   * **Process:** switch method → openURL/navigate → fallback to clipboard
   * **Effects:** External app opens, navigation, clipboard write, sheet close
   *
   * @param {string} method - Contact method (email, twitter, nostr, etc.)
   * @param {string} info - Contact information
   */
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
        name={mintInfo?.name || auditMintInfo?.name || extractDomain(mintUrl || '')}
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
            <Text size={24} bold className="mb-1 text-center font-bold text-primary-0">
              {mintInfo?.name || 'Loading...'}
            </Text>
            {/* {mintInfo?.version && (
              <Text className="text-center text-sm text-primary-100">{mintInfo.version}</Text>
            )} */}
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
          <Text size={24} bold className="mb-1 text-center font-bold text-primary-0">
            {displayName}
          </Text>
          {/* {mintInfo?.version && (
            <Text className="text-center text-sm text-primary-100">{mintInfo.version}</Text>
          )} */}

          {/* Rating Display */}
          {kymScore !== undefined && (
            <>
              <Spacer size={16} />
              <RatingDisplay score={kymScore} recommendations={kymRecommendations} />
            </>
          )}

          {/* Reviews List */}
          {kymRecommendations && kymRecommendations.length > 0 && (
            <>
              <Spacer size={8} />
              {!showReviews ? (
                <View className="w-full px-4">
                  <HStack justify="flex-end" className="w-full">
                    <Text
                      size={14}
                      bold
                      style={{
                        color: '#FFD700',
                        textDecorationLine: 'underline',
                      }}
                      onPress={() => setShowReviews(true)}>
                      Show {kymRecommendations.length} review
                      {kymRecommendations.length !== 1 ? 's' : ''}
                    </Text>
                  </HStack>
                </View>
              ) : (
                <ReviewsList recommendations={kymRecommendations} />
              )}
            </>
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
