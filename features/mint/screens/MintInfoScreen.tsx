import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
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
import { Section } from '@/shared/ui/composed/Section';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import Icon from 'assets/icons';
import { Badge } from '@/shared/ui/primitives/Badge';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import * as Clipboard from 'expo-clipboard';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { useScreenActions } from '@sovranbitcoin/colada/react';
import opacity from 'hex-color-opacity';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import { log, useLifecycleLogger, Log } from '@/shared/lib/logger';
import { openExternalUrl } from '@/shared/lib/url';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';
import {
  formatMintInfoNostrFallback,
  getMintInfoNostrContactPubkey,
  getMintInfoNostrDisplayName,
  getSortedMintInfoContacts,
} from '../lib/mintInfoContacts';

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
  const fadeAnim = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value }));

  useEffect(() => {
    fadeAnim.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [fadeAnim]);

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <Animated.View style={fadeStyle}>
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
  okBg,
  okIcon,
  okOutline,
}: {
  picture?: string;
  name?: string;
  alt?: string;
  status?: string;
  size?: number;
  isLoading?: boolean;
  /** Solid-disc tint for the OK badge — overrides Badge variant="success"
   *  (now blue) so the verified mint reads as green. */
  okBg?: string;
  /** Checkmark glyph color — paired with `okBg` for the OK badge. */
  okIcon?: string;
  /** Optional outline color for the checkmark — usually the screen background
   *  so the glyph carries the same visual gap as the disc-to-avatar seam. */
  okOutline?: string;
}) {
  const badgeAnim = useSharedValue(0);
  const badgeStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    bottom: -2,
    right: -2,
    opacity: badgeAnim.value,
    transform: [{ scale: badgeAnim.value }],
  }));

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
      badgeAnim.value = withDelay(80, withSpring(1, { damping: 14, stiffness: 260 }));
    }
  }, [status, isLoading, badgeAnim]);

  const badgeSize = size * 0.33;
  // OK gets a custom solid green disc — Badge variant="success" is hardcoded
  // to a translucent blue wash + blue icon (deliberate app-wide retint), but
  // the verified mint badge reads as "good" in green here.
  // Ring around the disc in the screen background color — same visual weight
  // as the seam between the avatar and the badge, just continued all the way
  // around. `borderWidth` paints inside the box, so we add 2*ring to the
  // total width to keep the green disc itself the same size as before.
  const ring = okOutline ? 4 : 0;
  const okOuter = badgeSize + 4 + ring * 2;
  const okBadge =
    statusBadge?.variant === 'success' && okBg && okIcon ? (
      <View
        style={{
          width: okOuter,
          height: okOuter,
          borderRadius: okOuter / 2,
          backgroundColor: okBg,
          borderWidth: ring,
          borderColor: okOutline,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Icon name={statusBadge.icon} size={badgeSize} color={okIcon} />
      </View>
    ) : null;

  return (
    <View className="relative">
      <MintIcon iconUrl={picture} size={size} name={name} alt={alt} isLoading={isLoading} />
      {statusBadge && (
        <Animated.View style={badgeStyle}>
          {okBadge ?? (
            <Badge variant={statusBadge.variant} icon={statusBadge.icon} size={badgeSize} />
          )}
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
        label: 'Success rate',
        description:
          typeof swapSuccess === 'number' && typeof swapTotal === 'number'
            ? `${swapSuccess} of ${swapTotal} swaps`
            : 'Successful rate of swaps',
        value: `${displayValues.successRate}%`,
        accent: true,
      },
      {
        label: 'Average time',
        description: 'For successful swaps',
        value: `${displayValues.avgTimeMs} ms`,
        accent: true,
      },
      {
        label: 'Total mints',
        description: 'Total mint operations',
        value: displayValues.totalMints,
        accent: false,
      },
      {
        label: 'Total melts',
        description: 'Total melt operations',
        value: displayValues.totalMelts,
        accent: false,
      },
    ],
    [displayValues, swapSuccess, swapTotal]
  );

  const showSkeleton = !hasValidData;

  // Same grid chrome for both branches (only the `loading` bars differ), so the
  // crossfade swaps content under a fading skeleton with zero shift.
  const renderGrid = (loading: boolean) => (
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
                    loading={loading}
                    placeholder="SUCCESS RATE"
                    bold
                    size={12}
                    style={{ color: opacity(foreground, 0.66), marginBottom: 4 }}>
                    {stat.label.toUpperCase()}
                  </Text>
                  <Text
                    loading={loading}
                    placeholder="100%"
                    bold
                    size={stat.accent ? 24 : 20}
                    style={{ color: foreground, marginBottom: 2 }}>
                    {stat.value}
                  </Text>
                  <Text
                    loading={loading}
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

  return (
    <SkeletonContentCrossfade
      loading={showSkeleton}
      surfaceColor={surfaceSecondary}
      visualKey="mint-info-stats"
      visualSurface="mint-info"
      renderSkeleton={() => renderGrid(true)}
      renderContent={() => renderGrid(false)}
    />
  );
}
const StatsGrid = React.memo(StatsGridComponent);

/** Score with staggered star rows and distribution bars to the edge. */
function RatingBarChartComponent({ score }: { score: number }) {
  const [foreground, defaultColor, surfaceTertiary, starColor] = useThemeColor([
    'foreground',
    'default',
    'surface-tertiary',
    'yellow-300',
  ] as const);

  const fadeAnim = useSharedValue(0);
  const barScaleAnim = useSharedValue(0);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value, alignItems: 'center' }));
  const starFadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.value }));
  const barFillStyle = useAnimatedStyle(() => ({
    width: '100%',
    height: '100%',
    borderRadius: 4,
    transform: [{ scaleX: barScaleAnim.value }],
    transformOrigin: 'left center',
  }));

  const isValidScore = score >= 0;
  const showSkeleton = !isValidScore;

  const targetRow = isValidScore ? Math.max(1, Math.min(5, Math.ceil(score))) : 0;
  const goldPercentage = isValidScore && targetRow > 0 ? Math.min(1, score / targetRow) : 0;

  const formattedScore = isValidScore ? score.toFixed(1) : '0.0';

  const hasAnimatedRef = useRef(false);
  useEffect(() => {
    if (isValidScore && !hasAnimatedRef.current) {
      hasAnimatedRef.current = true;

      fadeAnim.value = 0;
      barScaleAnim.value = 0;

      fadeAnim.value = withTiming(1, { duration: 400 });
      barScaleAnim.value = withDelay(
        200,
        withTiming(goldPercentage, { duration: 800, easing: Easing.out(Easing.cubic) })
      );
    }
  }, [isValidScore, goldPercentage, fadeAnim, barScaleAnim]);

  const renderSkeleton = () => (
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

  const renderContent = () => (
    <HStack align="center" gap={16} className="w-full self-stretch px-4">
      <VStack align="center" className="shrink-0">
        <Animated.View style={fadeStyle}>
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
                {Array.from({ length: stars }).map((_, i) =>
                  isTargetRow ? (
                    <Animated.View key={i} style={starFadeStyle}>
                      <Icon name="ic:round-star" size={12} color={starColor} />
                    </Animated.View>
                  ) : (
                    <View key={i}>
                      <Icon name="ic:round-star" size={12} color={opacity(foreground, 0.4)} />
                    </View>
                  )
                )}
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
                  <Animated.View style={[barFillStyle, { backgroundColor: starColor }]} />
                )}
              </View>
            </HStack>
          );
        })}
      </VStack>
    </HStack>
  );

  return (
    <SkeletonContentCrossfade
      loading={showSkeleton}
      visualKey="mint-info-rating"
      visualSurface="mint-info"
      renderSkeleton={renderSkeleton}
      renderContent={renderContent}
    />
  );
}
const RatingBarChart = React.memo(RatingBarChartComponent);

export function MintInfoScreen() {
  useLifecycleLogger('MintInfoScreen');
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  // The mint-status ring + OK badge intentionally diverge from the theme
  // `success` token (which is blue app-wide after the retint commit). A
  // verified mint reads as "good" in green here, so pull the static green
  // scale instead. Ring uses the vivid `green-300` (a thin stroke needs the
  // brighter shade to register); the solid OK disc uses saturated `green-400`
  // with a pale `green-100` checkmark for tonal contrast.
  const [danger, success, starColor, okBadgeBg, okBadgeIcon] = useThemeColor([
    'danger',
    'green-300',
    'yellow-300',
    'green-400',
    'green-100',
  ] as const);
  const insets = useSafeAreaInsets();
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.info' });
  const { entry, actions } = useScreenActions('mintInfo', params?.mintInfoEntry);

  const mintUrl = (entry?.mintUrl as string) ?? '';
  const displayName = (entry?.displayName as string) ?? mintUrl;
  const contact = entry?.contact as
    | { method: string; info: import('@sovranbitcoin/colada').FormattedString }[]
    | undefined;
  const contactRows = getSortedMintInfoContacts(contact);
  const nostrContactPubkey = useMemo(
    () => getMintInfoNostrContactPubkey(contactRows),
    [contactRows]
  );
  const { data: nostrContactProfile, isLoading: nostrContactLoading } = useNostrProfile(
    nostrContactPubkey ?? null
  );
  const nostrContactPicture = nostrContactProfile?.picture || nostrContactProfile?.image;

  const handleMintUrlPress = useCallback(async () => {
    if (!mintUrl) return;
    log.info('mint.info.address.copy');
    await Clipboard.setStringAsync(mintUrl);
  }, [mintUrl]);

  const handleContactPress = useCallback(async (method: string, info: string, pubkey?: string) => {
    log.info('mint.info.contact.press', { method });
    const open = async (raw: string) => {
      const result = await openExternalUrl(raw);
      if (result.isErr()) {
        log.warn('mint.info.contact.open_failed', { method, reason: result.error.type });
        await Clipboard.setStringAsync(info);
      }
    };
    switch (method.toLowerCase()) {
      case 'email':
        await open(`mailto:${info.trim()}`);
        break;
      case 'twitter':
      case 'x':
        await open(`https://x.com/${encodeURIComponent(info.replace('@', ''))}`);
        break;
      case 'nostr':
        if (pubkey) {
          router.push(buildModalProfileHref({ pubkey }));
        } else {
          await Clipboard.setStringAsync(info);
        }
        break;
      default:
        await Clipboard.setStringAsync(info);
    }
  }, []);

  return (
    <Log name="MintInfoScreen" style={{ flex: 1, backgroundColor: background }}>
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
                    <ScreenHeaderAction
                      icon="ic:round-star"
                      color={starColor}
                      accessibilityLabel="View mint reviews"
                    />
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
              okBg={okBadgeBg}
              okIcon={okBadgeIcon}
              okOutline={background}
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

        {mintUrl && (
          <Section title="Mint address">
            <ListGroup variant="secondary">
              <PressableFeedback animation={false} onPress={handleMintUrlPress}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="humbleicons:url" size={20} color={opacity(foreground, 0.4)} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={3}>{mintUrl}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>Tap to copy</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon name="lets-icons:copy" size={18} color={opacity(foreground, 0.4)} />
                    </ListGroup.ItemSuffix>
                  </ListGroup.Item>
                </PressableFeedback.Scale>
                <PressableFeedback.Ripple />
              </PressableFeedback>
            </ListGroup>
          </Section>
        )}

        {contactRows.length > 0 && (
          <Section title="Contact">
            <ListGroup variant="secondary">
              {contactRows.map((c) => {
                const rowNostrPubkey = c.isNostr ? getMintInfoNostrContactPubkey([c]) : undefined;
                const rowProfile =
                  rowNostrPubkey && rowNostrPubkey === nostrContactPubkey
                    ? nostrContactProfile
                    : null;
                const rowPicture =
                  rowNostrPubkey && rowNostrPubkey === nostrContactPubkey
                    ? nostrContactPicture
                    : undefined;
                const fallbackNpub = c.isNostr
                  ? formatMintInfoNostrFallback(c.info, rowNostrPubkey)
                  : undefined;
                const title = c.isNostr
                  ? getMintInfoNostrDisplayName(rowProfile, fallbackNpub ?? c.info)
                  : c.info;
                return (
                  <PressableFeedback
                    key={`${c.method}:${c.info}:${c.originalIndex}`}
                    animation={false}
                    onPress={() => handleContactPress(c.method, c.info, rowNostrPubkey)}>
                    <PressableFeedback.Scale>
                      <ListGroup.Item disabled>
                        <ListGroup.ItemPrefix>
                          {c.isNostr ? (
                            <Avatar
                              state={
                                nostrContactLoading && rowNostrPubkey === nostrContactPubkey
                                  ? 'loading'
                                  : rowPicture
                                    ? 'image'
                                    : 'fallback'
                              }
                              picture={rowPicture}
                              seed={rowNostrPubkey ?? c.info}
                              name={title}
                              size={32}
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
                          <ListGroup.ItemTitle>{title}</ListGroup.ItemTitle>
                        </ListGroup.ItemContent>
                        <ListGroup.ItemSuffix />
                      </ListGroup.Item>
                    </PressableFeedback.Scale>
                    <PressableFeedback.Ripple />
                  </PressableFeedback>
                );
              })}
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
                      await actions.back.execute();
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
                        await actions.back.execute();
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
                        await actions.back.execute();
                      },
                    },
                  ]
          }
        />
      </BottomButtons>
    </Log>
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
