/**
 * @fileoverview Mint Info Modal Screen - Performance Optimized
 *
 * Key optimizations:
 * 1. ALL animations use useNativeDriver: true (opacity, transform only)
 * 2. Replaced width animations with scaleX transforms (native driver compatible)
 * 3. Removed expensive counting animations (text value updates)
 * 4. SVG progress ring uses static values with fade-in (strokeDashoffset doesn't support native driver)
 * 5. Minimized state updates during animations
 * 6. All components memoized with React.memo
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ScrollView,
  Animated,
  Alert,
  Linking,
  Easing,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Stack, router, useLocalSearchParams, Link } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { npubToPubkey } from 'components/blocks/Transaction';
import { useAuditedMint } from 'hooks/coco/useAuditedMint';
import { useKYMMint } from 'hooks/coco/useKYMMint';
import { Card } from 'components/ui/Card';
import { RowButton, Section } from 'app/settings-pages';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { Badge } from 'components/ui/Badge';
import { truncateMiddle } from 'helper/strings';
import * as Clipboard from 'expo-clipboard';
import { Skeleton } from 'components/ui/Skeleton';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { withSheetProvider } from 'hocs/withSheetProvider';
import Svg, { Circle } from 'react-native-svg';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useReceive } from 'coco-cashu-react';
import opacity from 'hex-color-opacity';

// ============================================================================
// Simple Progress Ring using SVG - Static (no animation for better performance)
// Note: SVG strokeDashoffset doesn't support native driver, so we show final state
// ============================================================================
function ProgressRingComponent({
  size = 84,
  strokeWidth = 3,
  progress = 0.5,
  successColor,
  errorColor,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  progress: number;
  successColor: string;
  errorColor: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Calculate final stroke offset (no animation - SVG props don't support native driver)
  const strokeDashoffset = circumference * (1 - progress);

  // Fade in the ring with native driver
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <Animated.View style={{ opacity: fadeAnim }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          {/* Background circle */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={errorColor}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
          {/* Progress circle - static final value */}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={successColor}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </Svg>
      </Animated.View>
      <View style={[StyleSheet.absoluteFill, styles.centered]}>{children}</View>
    </View>
  );
}
const ProgressRing = React.memo(ProgressRingComponent);

// ============================================================================
// Animated Avatar with status badge
// ============================================================================
function AnimatedAvatarComponent({
  picture,
  name,
  alt,
  status,
  size = 70,
  isLoading = false,
}: {
  picture?: string;
  name?: string;
  alt?: string;
  status?: string;
  size?: number;
  isLoading?: boolean;
}) {
  const badgeAnim = useRef(new Animated.Value(0)).current;

  const statusBadge = useMemo(() => {
    if (!status) return null;
    const config: Record<string, { variant: 'success' | 'error' | 'secondary'; icon: string }> = {
      OK: { variant: 'success', icon: 'fluent:checkmark-16-filled' },
      ERROR: { variant: 'error', icon: 'nonicons:error-16' },
      OFFLINE: { variant: 'secondary', icon: 'feather:wifi' },
    };
    return config[status];
  }, [status]);

  useEffect(() => {
    if (status && !isLoading) {
      Animated.spring(badgeAnim, {
        toValue: 1,
        friction: 4,
        tension: 100,
        useNativeDriver: true,
        delay: 300,
      }).start();
    }
  }, [status, isLoading, badgeAnim]);

  return (
    <View style={{ position: 'relative' }}>
      <Avatar
        picture={picture}
        size={size}
        variant="person"
        name={name}
        alt={alt}
        loading={isLoading}
      />
      {statusBadge && (
        <Animated.View
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            opacity: badgeAnim,
            transform: [{ scale: badgeAnim }],
          }}>
          <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={size * 0.33} />
        </Animated.View>
      )}
    </View>
  );
}
const AnimatedAvatar = React.memo(AnimatedAvatarComponent);

// ============================================================================
// Stats Grid - Optimized with native driver only (no counting animation)
// ============================================================================
function StatsGridComponent({
  successRate,
  avgTimeMs,
  swapSuccess,
  swapTotal,
  totalMints,
  totalMelts,
  isLoading: _isLoading,
}: {
  successRate?: number;
  avgTimeMs?: number;
  swapSuccess?: number;
  swapTotal?: number;
  totalMints?: number;
  totalMelts?: number;
  isLoading: boolean;
}) {
  const { getPrimaryColor } = useTheme();

  // Final display values (no counting animation - better performance)
  const displayValues = useMemo(
    () => ({
      successRate: successRate !== undefined ? (successRate * 100).toFixed(1) : '0.0',
      avgTimeMs: avgTimeMs !== undefined ? Math.round(avgTimeMs).toString() : '0',
      totalMints: totalMints !== undefined ? Math.round(totalMints).toString() : '0',
      totalMelts: totalMelts !== undefined ? Math.round(totalMelts).toString() : '0',
    }),
    [successRate, avgTimeMs, totalMints, totalMelts]
  );

  // Single staggered fade animation using native driver
  const fadeAnims = useRef([
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
    new Animated.Value(0),
  ]).current;

  // Check if we have any valid data
  const hasValidData =
    successRate !== undefined ||
    avgTimeMs !== undefined ||
    totalMints !== undefined ||
    totalMelts !== undefined;

  // Trigger staggered fade-in when data loads
  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (hasValidData && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;

      // Staggered fade animations - all use native driver
      const animations = fadeAnims.map((anim, index) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          delay: index * 80,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      );

      Animated.stagger(80, animations).start();
    }
  }, [hasValidData, fadeAnims]);

  const stats = useMemo(
    () => [
      {
        label: 'Success Rate',
        description:
          typeof swapSuccess === 'number' && typeof swapTotal === 'number'
            ? `${swapSuccess} of ${swapTotal} swaps`
            : 'Successful rate of swaps',
        value: `${displayValues.successRate}%`,
        accent: true,
      },
      {
        label: 'Average Time',
        description: 'For successful swaps',
        value: `${displayValues.avgTimeMs} ms`,
        accent: true,
      },
      {
        label: 'Total Mints',
        description: 'Total mint operations',
        value: displayValues.totalMints,
        accent: false,
      },
      {
        label: 'Total Melts',
        description: 'Total melt operations',
        value: displayValues.totalMelts,
        accent: false,
      },
    ],
    [displayValues, swapSuccess, swapTotal]
  );

  // Show skeleton if we don't have valid data yet
  const showSkeleton = !hasValidData;

  return (
    <View style={styles.statsGrid}>
      {[0, 2].map((rowStart) => (
        <View key={rowStart} style={styles.statsRow}>
          {stats.slice(rowStart, rowStart + 2).map((stat, i) => {
            const index = rowStart + i;
            return (
              <View key={stat.label} style={styles.statItem}>
                <View
                  style={[
                    styles.statCard,
                    styles.statCardStretch,
                    {
                      backgroundColor: getPrimaryColor('800'),
                      borderColor: getPrimaryColor('700'),
                    },
                  ]}>
                  {showSkeleton ? (
                    <>
                      <Skeleton
                        style={[styles.skeletonLabel, { backgroundColor: getPrimaryColor('700') }]}
                      />
                      <Skeleton
                        style={[
                          styles.skeletonValue,
                          {
                            backgroundColor: getPrimaryColor('700'),
                            width: stat.accent ? 100 : 60,
                          },
                        ]}
                      />
                      <Skeleton
                        style={[styles.skeletonDesc, { backgroundColor: getPrimaryColor('700') }]}
                      />
                    </>
                  ) : (
                    <Animated.View style={{ opacity: fadeAnims[index] }}>
                      <Text
                        bold
                        overpass
                        size={12}
                        style={{ color: opacity(getPrimaryColor('0'), 0.66), marginBottom: 4 }}>
                        {stat.label.toUpperCase()}
                      </Text>
                      <Text
                        bold
                        overpass
                        size={stat.accent ? 24 : 20}
                        style={{ color: getPrimaryColor('0'), marginBottom: 2 }}>
                        {stat.value}
                      </Text>
                      <Text
                        bold
                        overpass
                        size={12}
                        style={{ color: opacity(getPrimaryColor('0'), 0.5), opacity: 0.8 }}>
                        {stat.description}
                      </Text>
                    </Animated.View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
const StatsGrid = React.memo(StatsGridComponent);

// ============================================================================
// Rating Display - Optimized with native driver (scaleX instead of width)
// ============================================================================
function RatingDisplayComponent({
  score,
  isLoading: _isLoading,
}: {
  score: number;
  recommendations?: any[];
  isLoading: boolean;
}) {
  const { getPrimaryColor, getYellowColor } = useTheme();

  // All animations use native driver
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const barScaleAnim = useRef(new Animated.Value(0)).current;

  // Check if we have valid data - score of -1 means not loaded
  const isValidScore = score >= 0;
  const showSkeleton = !isValidScore;

  const targetRow = isValidScore ? Math.max(1, Math.min(5, Math.ceil(score))) : 0;
  const goldPercentage = isValidScore && targetRow > 0 ? Math.min(1, score / targetRow) : 0;

  // Final formatted score (no counting animation - direct display)
  const formattedScore = isValidScore ? score.toFixed(1) : '0.0';

  // Trigger animation when score loads - all native driver
  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (isValidScore && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;

      // Reset
      fadeAnim.setValue(0);
      barScaleAnim.setValue(0);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        // Use scaleX instead of width - supports native driver
        Animated.timing(barScaleAnim, {
          toValue: goldPercentage,
          duration: 800,
          delay: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [isValidScore, goldPercentage, fadeAnim, barScaleAnim]);

  // Show skeleton when loading or no valid score
  if (showSkeleton) {
    return (
      <HStack align="center" gap={16} style={{ width: '100%', paddingHorizontal: 16 }}>
        <VStack align="center" style={{ width: 60 }}>
          <Skeleton
            style={{
              width: 48,
              height: 32,
              borderRadius: 4,
              backgroundColor: getPrimaryColor('700'),
            }}
          />
          <Skeleton
            style={{
              width: 40,
              height: 14,
              marginTop: 8,
              borderRadius: 4,
              backgroundColor: getPrimaryColor('700'),
            }}
          />
        </VStack>
        <VStack gap={4} style={{ flex: 1 }}>
          {[5, 4, 3, 2, 1].map((stars) => (
            <HStack key={stars} align="center" gap={8}>
              <HStack gap={2}>
                {Array.from({ length: stars }).map((_, i) => (
                  <Icon key={i} name="ic:round-star" size={12} color={getPrimaryColor('600')} />
                ))}
              </HStack>
              <View
                style={{
                  flex: 1,
                  height: 8,
                  backgroundColor: getPrimaryColor('700'),
                  borderRadius: 4,
                }}
              />
            </HStack>
          ))}
        </VStack>
      </HStack>
    );
  }

  return (
    <HStack align="center" gap={16} style={{ width: '100%', paddingHorizontal: 16 }}>
      {/* Score display */}
      <VStack align="center" style={{ width: 60 }}>
        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
          <Text heavy size={28} style={{ color: getPrimaryColor('0') }}>
            {formattedScore}
          </Text>
          <Text size={12} style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
            out of 5
          </Text>
        </Animated.View>
      </VStack>

      {/* Star distribution */}
      <VStack gap={4} style={{ flex: 1 }}>
        {[5, 4, 3, 2, 1].map((stars) => {
          const isTargetRow = stars === targetRow;
          return (
            <HStack key={stars} align="center" gap={8}>
              <HStack gap={2}>
                {Array.from({ length: stars }).map((_, i) => (
                  <Animated.View key={i} style={{ opacity: isTargetRow ? fadeAnim : 1 }}>
                    <Icon
                      name="ic:round-star"
                      size={12}
                      color={
                        isTargetRow ? getYellowColor('300') : opacity(getPrimaryColor('0'), 0.4)
                      }
                    />
                  </Animated.View>
                ))}
              </HStack>
              <View
                style={{
                  flex: 1,
                  height: 8,
                  backgroundColor: getPrimaryColor('700'),
                  borderRadius: 4,
                  overflow: 'hidden',
                }}>
                {isTargetRow && (
                  <Animated.View
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: getYellowColor('300'),
                      borderRadius: 4,
                      // Use scaleX with left origin instead of width animation
                      transform: [{ scaleX: barScaleAnim }],
                      // Transform origin left - scale from left edge
                      transformOrigin: 'left center',
                    }}
                  />
                )}
              </View>
            </HStack>
          );
        })}
      </VStack>
    </HStack>
  );
}
const RatingDisplay = React.memo(RatingDisplayComponent);

// ============================================================================
// Helper
// ============================================================================
const getMintDisplayName = (
  mintInfo?: any,
  auditMintInfo?: any,
  auditInfo?: any,
  mintUrl?: string
): string => {
  return (
    mintInfo?.name ||
    auditMintInfo?.name ||
    auditInfo?.auditorData?.name ||
    mintUrl?.split('//')[1]?.split('/')[0] ||
    'Unknown Mint'
  );
};

// ============================================================================
// Main Component
// ============================================================================
function MintInfoModal() {
  const { getPrimaryColor, getRedColor, getGreenColor, getYellowColor } = useTheme();
  const insets = useSafeAreaInsets();
  const { mintUrl, fromScan, fromAccepter, token } = useLocalSearchParams<{
    mintUrl: string;
    fromScan?: string;
    fromAccepter?: string;
    token?: string;
  }>();
  const {
    getMintInfo,
    isKnownMint,
    addMint,
    isLoading: mintManagementLoading,
  } = useMintManagement();
  const { receive } = useReceive();

  const [mintInfo, setMintInfo] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isKnownMintState, setIsKnownMintState] = useState<boolean | null>(null);
  const [addingMint, setAddingMint] = useState(false);

  const {
    auditInfo,
    mintInfo: auditMintInfo,
    loading: auditLoading,
  } = useAuditedMint(mintUrl || '');
  const {
    score: kymScore,
    recommendations: kymRecommendations,
    loading: kymLoading,
  } = useKYMMint(mintUrl || '');

  const handleCopy = useCallback(async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
    } catch {
      Alert.alert('Error', 'Failed to copy to clipboard');
    }
  }, []);

  const handleContactPress = useCallback(
    async (method: string, info: string) => {
      try {
        switch (method.toLowerCase()) {
          case 'email':
            await Linking.openURL(`mailto:${info}`);
            break;
          case 'twitter':
          case 'x':
            await Linking.openURL(`https://x.com/${info.replace('@', '')}`);
            break;
          case 'nostr':
            router.navigate({ pathname: '/userMessages', params: { pubkey: npubToPubkey(info) } });
            break;
          default:
            await handleCopy(info);
        }
      } catch {
        handleCopy(info);
      }
    },
    [handleCopy]
  );

  useEffect(() => {
    const fetchMintInfo = async () => {
      if (!mintUrl) {
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        const data = await getMintInfo(mintUrl);
        setMintInfo(data);
      } catch {
      } finally {
        setLoading(false);
      }
    };
    fetchMintInfo();
  }, [mintUrl, getMintInfo]);

  // Check if mint is already known/trusted
  useEffect(() => {
    const checkIfKnown = async () => {
      if (!mintUrl) {
        setIsKnownMintState(null);
        return;
      }
      try {
        const known = await isKnownMint(mintUrl);
        setIsKnownMintState(known);
      } catch {
        // Treat errors as mint not being known
        setIsKnownMintState(false);
      }
    };
    checkIfKnown();
  }, [mintUrl, isKnownMint]);

  // Handler to add mint
  const handleAddMint = useCallback(async () => {
    if (!mintUrl) return;
    setAddingMint(true);
    try {
      await addMint(mintUrl);
      if (fromAccepter === '1' && token) {
        // Trust + redeem in one step, then dismiss back
        await receive(token);
        router.back();
      } else if (fromAccepter === '1') {
        router.back();
      } else {
        Alert.alert('Success', 'Mint added successfully', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to add mint');
    } finally {
      setAddingMint(false);
    }
  }, [mintUrl, addMint, fromAccepter, token, receive]);

  const isLoading = loading || auditLoading;

  // Calculate stats
  const { successRate, totalMints, totalMelts } = useMemo(() => {
    const mints = auditInfo?.auditorData?.mints;
    const melts = auditInfo?.auditorData?.melts;
    const errors = auditInfo?.auditorData?.errors;
    const totalOps = (mints || 0) + (melts || 0);
    const rate =
      typeof auditInfo?.successRate === 'number'
        ? auditInfo.successRate
        : typeof auditInfo?.score === 'number'
          ? auditInfo.score / 5
          : totalOps > 0
            ? 1 - (errors || 0) / totalOps
            : undefined;
    return { successRate: rate, totalMints: mints, totalMelts: melts };
  }, [auditInfo]);

  const displayName = useMemo(
    () => getMintDisplayName(mintInfo, auditMintInfo, auditInfo, mintUrl),
    [mintInfo, auditMintInfo, auditInfo, mintUrl]
  );

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <Stack.Screen
        options={{
          title: fromAccepter === '1' ? 'Verify Mint' : isLoading ? 'Mint Details' : displayName,
          headerRight:
            fromAccepter === '1'
              ? undefined
              : () => (
                  <Link
                    href={{
                      pathname: '/reviews',
                      params: { mintUrl: mintUrl || '' },
                    }}
                    asChild>
                    <TouchableOpacity style={{ padding: 8 }}>
                      <Icon name="ic:round-star" size={24} color={getYellowColor('300')} />
                    </TouchableOpacity>
                  </Link>
                ),
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 16,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <VStack align="center" style={{ paddingVertical: 24, paddingBottom: 32 }}>
          {/* Progress Ring with Avatar */}
          <ProgressRing
            size={84}
            progress={successRate ?? 0.5}
            successColor={getGreenColor('300')}
            errorColor={getRedColor('300')}>
            <AnimatedAvatar
              picture={mintInfo?.icon_url || auditMintInfo?.icon_url}
              name={displayName}
              alt={`${displayName} icon`}
              status={auditInfo?.auditorData?.state}
              size={70}
              isLoading={isLoading}
            />
          </ProgressRing>

          <Spacer size={16} />

          {/* Rating Display */}
          <RatingDisplay
            score={kymScore ?? -1}
            recommendations={kymRecommendations}
            isLoading={kymLoading}
          />

          {/* Stats Grid */}
          <StatsGrid
            successRate={successRate}
            avgTimeMs={auditInfo?.avgTimeMs}
            swapSuccess={auditInfo?.swapSuccess}
            swapTotal={auditInfo?.swapTotal}
            totalMints={totalMints}
            totalMelts={totalMelts}
            isLoading={isLoading}
          />
        </VStack>

        {/* Info Cards */}
        {mintInfo?.description && (
          <>
            <Card variant="info" message={mintInfo.description} />
            <Spacer size={12} />
          </>
        )}

        {mintInfo?.description_long && (
          <>
            <Card variant="warning" message={mintInfo.description_long} />
            <Spacer size={12} />
          </>
        )}

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
                    <HStack align="center" gap={8}>
                      <CurrencyIcon
                        colors={[opacity(getPrimaryColor('0'), 0.4)]}
                        width={20}
                        currency="nostr"
                      />
                      <Text style={{ color: opacity(getPrimaryColor('0'), 0.9) }} bold>
                        {truncateMiddle(contact.info, 10)}
                      </Text>
                    </HStack>
                  ) : ['X', 'TWITTER'].includes(contact.method.toUpperCase()) ? (
                    <HStack align="center" gap={8}>
                      <Icon
                        name="hugeicons:new-twitter"
                        size={20}
                        color={opacity(getPrimaryColor('0'), 0.4)}
                      />
                      <Text style={{ color: opacity(getPrimaryColor('0'), 0.9) }} bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : contact.method.toUpperCase() === 'EMAIL' ? (
                    <HStack align="center" gap={8}>
                      <Icon name="mdi:at" size={20} color={opacity(getPrimaryColor('0'), 0.4)} />
                      <Text style={{ color: opacity(getPrimaryColor('0'), 0.9) }} bold>
                        {contact.info}
                      </Text>
                    </HStack>
                  ) : (
                    <Text style={{ color: opacity(getPrimaryColor('0'), 0.9) }} bold>
                      {contact.info}
                    </Text>
                  )
                }
                onPress={() => handleContactPress(contact.method, contact.info)}
              />
            ))}
          </Section>
        )}

        {/* Settings: entry point for mint distribution + rebalance tooling.
            We only show this for known/added mints (not random scanned mints). */}
        {isKnownMintState && fromAccepter !== '1' && (
          <Section title="Settings">
            <RowButton
              isFirst
              isLast
              label={
                <HStack align="center" gap={8}>
                  <Icon
                    name="fluent:split-vertical-24-filled"
                    size={20}
                    color={opacity(getPrimaryColor('0'), 0.4)}
                  />
                  <Text style={{ color: opacity(getPrimaryColor('0'), 0.9) }} bold>
                    Balance split
                  </Text>
                </HStack>
              }
              // Route into the balance split editor (mint-flow modal).
              onPress={() => router.navigate('/distribution')}
            />
          </Section>
        )}
      </ScrollView>

      <BottomButtons>
        <ButtonHandler
          buttons={
            fromAccepter === '1'
              ? [
                  {
                    text: 'Reject',
                    variant: 'secondary',
                    onPress: async () => {
                      router.back();
                    },
                  },
                  {
                    text: addingMint ? 'Accepting...' : 'Accept',
                    variant: 'primary',
                    disabled: addingMint || mintManagementLoading,
                    onPress: handleAddMint,
                  },
                ]
              : mintUrl && (fromScan === '1' || isKnownMintState === false)
                ? [
                    {
                      text: 'Close',
                      variant: 'secondary',
                      onPress: async () => {
                        router.back();
                      },
                    },
                    {
                      text: addingMint ? 'Adding...' : 'Add mint',
                      variant: 'primary',
                      disabled: addingMint || mintManagementLoading,
                      onPress: handleAddMint,
                    },
                  ]
                : [
                    {
                      text: 'Close',
                      variant: 'secondary',
                      onPress: async () => {
                        router.back();
                      },
                    },
                  ]
          }
        />
      </BottomButtons>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsGrid: {
    width: '100%',
    alignSelf: 'stretch',
    marginTop: 16,
    marginHorizontal: -6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
  },
  statItem: {
    flex: 1,
    padding: 6,
  },
  statCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  statCardStretch: {
    flex: 1,
  },
  skeletonLabel: {
    width: 80,
    height: 14,
    borderRadius: 4,
    marginBottom: 8,
  },
  skeletonValue: {
    height: 28,
    borderRadius: 4,
    marginBottom: 4,
  },
  skeletonDesc: {
    width: 120,
    height: 14,
    borderRadius: 4,
  },
});

export default withSheetProvider(MintInfoModal);
