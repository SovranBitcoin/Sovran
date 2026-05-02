import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { ScrollView, Animated, Linking, Easing, StyleSheet } from 'react-native';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { Stack, Link } from 'expo-router';
import { z } from 'zod';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Text } from '@/shared/ui/primitives/Text';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Card } from '@/shared/ui/composed/Card';
import { Section } from '@/features/settings/screens/SettingsScreen';
import Icon, { CurrencyIcon } from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Badge } from '@/shared/ui/primitives/Badge';
import * as Clipboard from 'expo-clipboard';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useScreenActions } from 'coco-payment-ux/react';
import opacity from 'hex-color-opacity';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';

const ParamsSchema = z.object({
  mintInfoEntry: z.string().min(1).max(64_000).optional(),
});

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

  const strokeDashoffset = circumference * (1 - progress);
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
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={errorColor}
            strokeWidth={strokeWidth}
            fill="transparent"
          />
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
    <View className="relative">
      <Avatar
        state={isLoading ? 'loading' : picture ? 'image' : 'fallback'}
        picture={picture}
        size={size}
        name={name}
        alt={alt}
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

function StatsGridComponent({
  successRate,
  avgTimeMs,
  swapSuccess,
  swapTotal,
  totalMints,
  totalMelts,
}: {
  successRate?: number;
  avgTimeMs?: number;
  swapSuccess?: number;
  swapTotal?: number;
  totalMints?: number;
  totalMelts?: number;
}) {
  const [foreground, surfaceSecondary, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
  ] as const);

  const displayValues = useMemo(
    () => ({
      successRate: successRate !== undefined ? (successRate * 100).toFixed(1) : '0.0',
      avgTimeMs: avgTimeMs !== undefined ? Math.round(avgTimeMs).toString() : '0',
      totalMints: totalMints !== undefined ? Math.round(totalMints).toString() : '0',
      totalMelts: totalMelts !== undefined ? Math.round(totalMelts).toString() : '0',
    }),
    [successRate, avgTimeMs, totalMints, totalMelts]
  );

  const hasValidData =
    successRate !== undefined ||
    avgTimeMs !== undefined ||
    totalMints !== undefined ||
    totalMelts !== undefined;

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

  const showSkeleton = !hasValidData;

  return (
    <View style={styles.statsGrid}>
      {[0, 2].map((rowStart) => (
        <View key={rowStart} style={styles.statsRow}>
          {stats.slice(rowStart, rowStart + 2).map((stat) => {
            return (
              <View key={stat.label} style={styles.statItem}>
                <View
                  style={[
                    styles.statCard,
                    styles.statCardStretch,
                    {
                      backgroundColor: surfaceSecondary,
                      borderColor: surfaceTertiary,
                    },
                  ]}>
                  <Text
                    loading={showSkeleton}
                    placeholder="SUCCESS RATE"
                    bold
                    size={12}
                    style={{ color: opacity(foreground, 0.66), marginBottom: 4 }}>
                    {stat.label.toUpperCase()}
                  </Text>
                  <Text
                    loading={showSkeleton}
                    placeholder="100%"
                    bold
                    size={stat.accent ? 24 : 20}
                    style={{ color: foreground, marginBottom: 2 }}>
                    {stat.value}
                  </Text>
                  <Text
                    loading={showSkeleton}
                    placeholder="Completion rate"
                    bold
                    size={12}
                    style={{ color: opacity(foreground, 0.5), opacity: 0.8 }}>
                    {stat.description}
                  </Text>
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

/** Score with staggered star rows and distribution bars to the edge. */
function RatingBarChartComponent({ score }: { score: number }) {
  const [foreground, defaultColor, surfaceTertiary, warning] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'yellow-300',
  ] as const);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const barScaleAnim = useRef(new Animated.Value(0)).current;

  const isValidScore = score >= 0;
  const showSkeleton = !isValidScore;

  const targetRow = isValidScore ? Math.max(1, Math.min(5, Math.ceil(score))) : 0;
  const goldPercentage = isValidScore && targetRow > 0 ? Math.min(1, score / targetRow) : 0;

  const formattedScore = isValidScore ? score.toFixed(1) : '0.0';

  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (isValidScore && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;

      fadeAnim.setValue(0);
      barScaleAnim.setValue(0);

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
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

  if (showSkeleton) {
    return (
      <HStack align="center" gap={16} className="w-full self-stretch px-4">
        <VStack align="center" className="shrink-0">
          <Skeleton className="bg-surface-tertiary h-8 w-12 rounded" />
          <Skeleton className="bg-surface-tertiary mt-2 h-3.5 w-10 rounded" />
        </VStack>
        <VStack gap={4} className="min-w-0 flex-1" style={{ flex: 1 }}>
          {[5, 4, 3, 2, 1].map((stars) => (
            <HStack key={stars} align="center" gap={2} className="w-full min-w-0">
              <HStack gap={2} className="shrink-0">
                {Array.from({ length: stars }).map((_, i) => (
                  <Icon key={i} name="ic:round-star" size={12} color={defaultColor} />
                ))}
              </HStack>
              <View
                className="bg-surface-tertiary min-w-0 flex-1 rounded"
                style={{ height: 8, minWidth: 24 }}
              />
            </HStack>
          ))}
        </VStack>
      </HStack>
    );
  }

  return (
    <HStack align="center" gap={16} className="w-full self-stretch px-4">
      <VStack align="center" className="shrink-0">
        <Animated.View style={{ opacity: fadeAnim, alignItems: 'center' }}>
          <Text heavy size={28} style={{ color: foreground }}>
            {formattedScore}
          </Text>
          <Text size={12} style={{ color: opacity(foreground, 0.5) }}>
            out of 5
          </Text>
        </Animated.View>
      </VStack>

      <VStack gap={4} className="min-w-0 flex-1" style={{ flex: 1 }}>
        {[5, 4, 3, 2, 1].map((stars) => {
          const isTargetRow = stars === targetRow;
          return (
            <HStack key={stars} align="center" gap={2} className="w-full min-w-0">
              <HStack gap={2} className="shrink-0">
                {Array.from({ length: stars }).map((_, i) => (
                  <Animated.View key={i} style={{ opacity: isTargetRow ? fadeAnim : 1 }}>
                    <Icon
                      name="ic:round-star"
                      size={12}
                      color={isTargetRow ? warning : opacity(foreground, 0.4)}
                    />
                  </Animated.View>
                ))}
              </HStack>
              <View
                className="min-w-0 flex-1 overflow-hidden rounded"
                style={{
                  height: 8,
                  minWidth: 24,
                  backgroundColor: surfaceTertiary,
                  borderRadius: 4,
                }}>
                {isTargetRow && (
                  <Animated.View
                    style={{
                      width: '100%',
                      height: '100%',
                      backgroundColor: warning,
                      borderRadius: 4,
                      transform: [{ scaleX: barScaleAnim }],
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
const RatingBarChart = React.memo(RatingBarChartComponent);

export function MintInfoScreen() {
  useLifecycleLogger('MintInfoScreen');
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const [danger, success, warning] = useThemeColor(['danger', 'success', 'yellow-300'] as const);
  const insets = useSafeAreaInsets();
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.info' });
  const { entry, actions } = useScreenActions('mintInfo', params?.mintInfoEntry);

  const mintUrl = (entry?.mintUrl as string) ?? '';
  const displayName = (entry?.displayName as string) ?? mintUrl;

  log.debug('mint.info.display', { mintUrl, displayName, hasEntry: !!entry });

  const handleContactPress = useCallback(async (method: string, info: string) => {
    log.info('mint.info.contact.press', { method });
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
          router.push({ pathname: '/(user-flow)/profile', params: { npub: info } });
          break;
        default:
          await Clipboard.setStringAsync(info);
      }
    } catch {
      await Clipboard.setStringAsync(info);
    }
  }, []);

  const contact = entry?.contact as
    | { method: string; info: import('coco-payment-ux').FormattedString }[]
    | undefined;

  return (
    <Screen name="MintInfoScreen" style={{ flex: 1, backgroundColor: background }}>
      <Stack.Screen
        options={{
          title: entry?.fromAccepter ? 'Verify Mint' : displayName || 'Mint Details',
          headerRight:
            entry?.fromAccepter || !(typeof entry?.kymScore === 'number' && entry.kymScore >= 0)
              ? undefined
              : () => (
                  <Link
                    href={{
                      pathname: '/reviews',
                      params: { mintUrl },
                    }}
                    asChild>
                    <TouchableOpacity style={{ padding: 8 }}>
                      <Icon name="ic:round-star" size={24} color={warning} />
                    </TouchableOpacity>
                  </Link>
                ),
        }}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: insets.top + 16,
          paddingHorizontal: 16,
          paddingBottom: 120,
        }}
        showsVerticalScrollIndicator={false}>
        <VStack align="center" className="w-full pb-8 pt-6">
          <ProgressRing
            size={84}
            progress={(entry?.successRate as number) ?? 0.5}
            successColor={success}
            errorColor={danger}>
            <AnimatedAvatar
              picture={entry?.iconUrl as string | undefined}
              name={displayName}
              alt={`${displayName} icon`}
              status={entry?.auditState as string | undefined}
              size={70}
              isLoading={!entry}
            />
          </ProgressRing>

          <Spacer size={16} />

          {typeof entry?.kymScore === 'number' && entry.kymScore >= 0 && (
            <RatingBarChart score={entry.kymScore} />
          )}

          {(entry?.auditState != null || typeof entry?.auditScore === 'number') && (
            <StatsGrid
              successRate={entry?.successRate as number | undefined}
              avgTimeMs={entry?.avgTimeMs as number | undefined}
              swapSuccess={entry?.swapSuccess as number | undefined}
              swapTotal={entry?.swapTotal as number | undefined}
              totalMints={entry?.totalMints as number | undefined}
              totalMelts={entry?.totalMelts as number | undefined}
            />
          )}
        </VStack>

        {typeof entry?.description === 'string' && (
          <>
            <Card variant="info" message={entry.description} />
            <Spacer size={12} />
          </>
        )}

        {typeof entry?.longDescription === 'string' && (
          <>
            <Card variant="warning" message={entry.longDescription} />
            <Spacer size={12} />
          </>
        )}

        {typeof entry?.motd === 'string' && (
          <>
            <Card variant="warning" message={`Message: ${entry.motd}`} />
            <Spacer size={12} />
          </>
        )}

        {contact && contact.length > 0 && (
          <Section title="Contact">
            <ListGroup variant="secondary">
              {contact.map((c, index) => (
                <PressableFeedback
                  key={index}
                  animation={false}
                  onPress={() => handleContactPress(c.method, c.info.toString())}>
                  <PressableFeedback.Scale>
                    <ListGroup.Item disabled>
                      <ListGroup.ItemPrefix>
                        {c.method.toUpperCase() === 'NOSTR' ? (
                          <CurrencyIcon
                            colors={[opacity(foreground, 0.4)]}
                            width={20}
                            currency="nostr"
                          />
                        ) : ['X', 'TWITTER'].includes(c.method.toUpperCase()) ? (
                          <Icon
                            name="hugeicons:new-twitter"
                            size={20}
                            color={opacity(foreground, 0.4)}
                          />
                        ) : c.method.toUpperCase() === 'EMAIL' ? (
                          <Icon name="mdi:at" size={20} color={opacity(foreground, 0.4)} />
                        ) : undefined}
                      </ListGroup.ItemPrefix>
                      <ListGroup.ItemContent>
                        <ListGroup.ItemTitle>
                          {c.method.toUpperCase() === 'NOSTR'
                            ? c.info.truncate(10)
                            : c.info.toString()}
                        </ListGroup.ItemTitle>
                      </ListGroup.ItemContent>
                      <ListGroup.ItemSuffix />
                    </ListGroup.Item>
                  </PressableFeedback.Scale>
                  <PressableFeedback.Ripple />
                </PressableFeedback>
              ))}
            </ListGroup>
          </Section>
        )}

        {entry?.isTrusted === true && !entry?.fromAccepter && (
          <Section title="Settings">
            <ListGroup variant="secondary">
              <PressableFeedback animation={false} onPress={() => router.navigate('/distribution')}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon
                        name="fluent:split-vertical-24-filled"
                        size={20}
                        color={opacity(foreground, 0.4)}
                      />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle>Balance split</ListGroup.ItemTitle>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix />
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            </ListGroup>
          </Section>
        )}
      </ScrollView>

      <BottomButtons>
        <ButtonHandler
          buttons={
            entry?.fromAccepter
              ? [
                  {
                    text: 'Reject',
                    variant: 'secondary',
                    onPress: async () => {
                      router.back();
                    },
                  },
                  {
                    text: actions.trust.loading ? 'Accepting...' : 'Accept',
                    variant: 'primary',
                    disabled: !actions.trust.available || actions.trust.loading,
                    onPress: () => actions.trust.execute(),
                  },
                ]
              : mintUrl && (entry?.fromScan || !entry?.isTrusted)
                ? [
                    {
                      text: 'Close',
                      variant: 'secondary',
                      onPress: async () => {
                        router.back();
                      },
                    },
                    {
                      text: actions.trust.loading ? 'Adding...' : 'Add mint',
                      variant: 'primary',
                      disabled: !actions.trust.available || actions.trust.loading,
                      onPress: () => actions.trust.execute(),
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
    </Screen>
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
});
