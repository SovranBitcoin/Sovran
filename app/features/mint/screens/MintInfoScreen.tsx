import { useIdentityHeader } from '@/shared/ui/composed/IdentityHeader';
import { Screen } from '@/shared/ui/composed/Screen';
import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Stack } from 'expo-router';
import { z } from 'zod';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Text } from '@/shared/ui/primitives/Text';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { Notice } from '@/shared/ui/composed/Notice';
import { Section } from '@/shared/ui/composed/Section';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import Icon from '@/assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { RatingBarChart } from '@/features/mint/components/RatingBarChart';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Avatar, AvatarStatusDot } from '@/shared/ui/primitives/Avatar';
import * as Clipboard from 'expo-clipboard';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import Svg, { Circle } from 'react-native-svg';
import { useScreenActions } from 'wallet/react';
import { withAlpha } from '@/shared/lib/color';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { openExternalUrl } from '@/shared/lib/url';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { Button } from '@/shared/ui/primitives/Button';
import { useMintDetailRead, type MintDetailGroupStatus } from '../hooks/useMintDetailRead';
import type { MintAuditSummary } from '../lib/auditInfo';
import {
  formatMintInfoNostrFallback,
  getMintInfoNostrDisplayName,
  getSortedMintInfoContacts,
  resolveMintInfoNostrContactPubkey,
} from '../lib/mintInfoContacts';

const ParamsSchema = z.object({
  mintInfoEntry: z.string().min(1).max(64_000).optional(),
});

function ProgressRing({
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
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fadeAnim.get() }));

  useEffect(() => {
    fadeAnim.set(withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
  }, [fadeAnim]);

  return (
    <View style={{ width: size, height: size }}>
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

function AnimatedAvatar({
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
  const badgeAnim = useSharedValue(0);
  const badgeStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    bottom: -2,
    right: -2,
    opacity: badgeAnim.get(),
    transform: [{ scale: badgeAnim.get() }],
  }));

  useEffect(() => {
    if (status && !isLoading) {
      badgeAnim.set(withDelay(80, withSpring(1, { damping: 14, stiffness: 260 })));
    }
  }, [status, isLoading, badgeAnim]);

  const badgeSize = size * 0.33;

  return (
    <View>
      <MintIcon iconUrl={picture} size={size} name={name} alt={alt} isLoading={isLoading} />
      {status && (
        <Animated.View style={badgeStyle}>
          <AvatarStatusDot status={status} size={badgeSize} />
        </Animated.View>
      )}
    </View>
  );
}

/** Unknown counts render as a dash, never as a zero that reads as measured (hunch rule ui/unknown-values). */
const UNKNOWN = '—';

function StatsGrid({
  status,
  onRetry,
  audit,
}: {
  /** The audit group's read status; the block is ALWAYS mounted and swaps content in place. */
  status: MintDetailGroupStatus;
  onRetry: () => void;
  /** The same `selectMintAudit` reading the mint rows show, so the two agree. */
  audit?: MintAuditSummary;
}) {
  const [foreground, surfaceSecondary, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface-secondary',
    'surface-tertiary',
  ] as const);

  const { successRate, avgLatencyMs, mints, melts } = audit ?? {};
  const displayValues = {
    successRate: successRate !== undefined ? `${(successRate * 100).toFixed(1)}%` : UNKNOWN,
    avgTimeMs: avgLatencyMs !== undefined ? `${Math.round(avgLatencyMs)} ms` : UNKNOWN,
    totalMints: mints !== undefined ? Math.round(mints).toString() : UNKNOWN,
    totalMelts: melts !== undefined ? Math.round(melts).toString() : UNKNOWN,
  };

  const stats = [
    {
      label: 'Success rate',
      description: 'Of mint and melt operations',
      value: displayValues.successRate,
      accent: true,
    },
    {
      label: 'Average time',
      // ucash reports its own probe latency; the retired audit API timed swaps.
      description: audit?.source === 'ucash' ? 'Measured by the auditor' : 'For successful swaps',
      value: displayValues.avgTimeMs,
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
  ];

  const showSkeleton = status === 'loading';

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
                    style={{ color: withAlpha(foreground, 0.66), marginBottom: 4 }}>
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
                    style={{ color: withAlpha(foreground, 0.5), opacity: 0.8 }}>
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

  // One slot for every state so the block never unmounts (no layout shift
  // when audit lands, is missing, or fails): skeleton → values, or an inline
  // notice of the same width in place of the grid.
  return (
    <View
      style={styles.statsSlot}
      testID="mint-info-audit-status"
      accessibilityLabel={`Audit ${status}`}>
      {status === 'empty' ? (
        <Notice status="info" description="No audit data for this mint yet." />
      ) : status === 'error' ? (
        <VStack className="w-full items-center gap-3">
          <Notice
            status="warning"
            description="Couldn't load audit data right now."
            className="w-full"
          />
          <Button
            testID="mint-info-audit-retry"
            text="Try again"
            variant="secondary"
            size="compact"
            onPress={onRetry}
          />
        </VStack>
      ) : (
        <SkeletonContentCrossfade
          loading={showSkeleton}
          surfaceColor={surfaceSecondary}
          visualKey="mint-info-stats"
          visualSurface="mint-info"
          renderSkeleton={() => renderGrid(true)}
          renderContent={() => renderGrid(false)}
        />
      )}
    </View>
  );
}

export function MintInfoScreen() {
  useLifecycleLogger('MintInfoScreen');
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);
  const [danger, success, starColor] = useThemeColor([
    'danger',
    'green-300',
    'yellow-300',
  ] as const);
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.info' });
  const { entry, actions } = useScreenActions('mintInfo', params?.mintInfoEntry);

  const mintUrl = (entry?.mintUrl as string) ?? '';
  const displayName = (entry?.displayName as string) ?? mintUrl;
  const morph = useIdentityHeader({
    identity: {
      kind: 'mint',
      name: displayName,
      seed: mintUrl,
      picture: entry?.iconUrl as string | undefined,
    },
    title: entry?.fromAccepter ? 'Verify Mint' : 'Mint Details',
    collapseAt: 110,
  });
  // The inspect paths seed mintInfoEntry with only { mintUrl }, so KYM review
  // data never arrives via the entry on that route. Fall back to the same
  // review cache the mint list rows read,
  // otherwise the reviews header action and rating chart silently vanish.
  const cachedMeta = useCachedMintMetadata(mintUrl || null);
  const detail = useMintDetailRead(mintUrl, entry);
  const kymScore =
    typeof entry?.kymScore === 'number' ? entry.kymScore : (cachedMeta?.averageScore ?? undefined);
  // Audit comes from the metadata store alone, through the selector the mint
  // rows use. The entry's audit fields are a snapshot of that store taken at
  // navigation, so reading them here let the page lag behind its own row.
  const audit = detail.meta.audit;
  const ringProgress = audit?.successRate ?? 0.5;
  const identityError = detail.identityError;
  const contact = entry?.contact as
    { method: string; info: import('wallet').FormattedString }[] | undefined;
  const contactRows = getSortedMintInfoContacts(contact);
  // NUT-06 first; a placeholder there (e.g. the literal `npub…`) falls back to
  // the operator nagg's discovery row resolved for this mint.
  const nostrContactPubkey = resolveMintInfoNostrContactPubkey(
    contactRows,
    cachedMeta?.operatorPubkey
  );
  const { data: nostrContactProfile, isLoading: nostrContactLoading } = useNostrProfile(
    nostrContactPubkey ?? null
  );
  const nostrContactPicture = nostrContactProfile?.picture || nostrContactProfile?.image;

  const handleMintUrlPress = async () => {
    if (!mintUrl) return;
    log.info('mint.info.address.copy');
    await Clipboard.setStringAsync(mintUrl);
  };

  const handleContactPress = async (method: string, info: string, pubkey?: string) => {
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
  };

  return (
    <Screen
      name="MintInfoScreen"
      scroll="animated"
      scrollY={morph.scrollY}
      bgColor={background}
      footer={
        <BottomButtons>
          <ButtonHandler
            buttons={
              entry?.fromAccepter
                ? [
                    {
                      testID: 'mint-info-close',
                      text: 'Reject',
                      variant: 'secondary',
                      onPress: async () => {
                        await actions.back.execute();
                      },
                    },
                    {
                      testID: 'mint-info-trust',
                      text: actions.trust.loading ? 'Accepting...' : 'Accept',
                      variant: 'primary',
                      disabled: !actions.trust.available || actions.trust.loading,
                      onPress: () => actions.trust.execute(),
                    },
                  ]
                : mintUrl && (entry?.fromScan || !entry?.isTrusted)
                  ? [
                      {
                        testID: 'mint-info-close',
                        text: 'Close',
                        variant: 'secondary',
                        onPress: async () => {
                          await actions.back.execute();
                        },
                      },
                      {
                        testID: 'mint-info-trust',
                        text: actions.trust.loading ? 'Adding...' : 'Add mint',
                        variant: 'primary',
                        disabled: !actions.trust.available || actions.trust.loading,
                        onPress: () => actions.trust.execute(),
                      },
                    ]
                  : [
                      {
                        testID: 'mint-info-close',
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
      }>
      <Stack.Screen
        options={withGlassHeaderItems({
          title: entry?.fromAccepter ? 'Verify Mint' : 'Mint Details',
          headerTitle: morph.headerTitle,
          headerRight:
            entry?.fromAccepter || !(typeof kymScore === 'number' && kymScore >= 0)
              ? undefined
              : () => (
                  <ScreenHeaderAction
                    onPress={() => router.navigate({ pathname: '/reviews', params: { mintUrl } })}
                    icon="ic:round-star"
                    color={starColor}
                    testID="mint-info-reviews"
                    accessibilityLabel="View mint reviews"
                  />
                ),
        })}
      />

      {morph.probe}
      <View className="pt-4">
        <VStack align="center" className="w-full pb-8 pt-6">
          <Animated.View className="items-center" style={morph.contentStyle}>
            <ProgressRing
              size={84}
              progress={ringProgress}
              successColor={success}
              errorColor={danger}>
              <AnimatedAvatar
                picture={entry?.iconUrl as string | undefined}
                name={displayName}
                alt={`${displayName} icon`}
                status={audit?.state}
                size={70}
                isLoading={detail.identity === 'loading'}
              />
            </ProgressRing>
            <Text bold size={22} numberOfLines={2} className="mt-3 text-center">
              {displayName}
            </Text>
          </Animated.View>

          <Spacer size={16} />

          {typeof kymScore === 'number' && kymScore >= 0 && (
            // Keyed by mintUrl so a screen reused for a different mint remounts
            // the chart (fresh roll-in) instead of rolling the prior mint's score.
            <RatingBarChart key={mintUrl} score={kymScore} />
          )}

          <StatsGrid status={detail.audit} onRetry={detail.retry} audit={audit} />
        </VStack>

        {identityError && (
          <>
            <Notice status="warning" description={identityError} />
            <VStack className="w-full items-center pb-3">
              <Button
                testID="mint-info-retry"
                text="Try again"
                variant="secondary"
                size="compact"
                onPress={detail.retry}
              />
            </VStack>
            <Spacer size={12} />
          </>
        )}

        {typeof entry?.description === 'string' && (
          <>
            <Notice status="info" title="About this mint" description={entry.description} />
            <Spacer size={12} />
          </>
        )}

        {typeof entry?.longDescription === 'string' && (
          <>
            <Notice
              status="info"
              icon="ri:file-text-line"
              title="Details"
              description={entry.longDescription}
            />
            <Spacer size={12} />
          </>
        )}

        {typeof entry?.motd === 'string' && (
          <>
            <Notice status="warning" title="Message from the mint" description={entry.motd} />
            <Spacer size={12} />
          </>
        )}

        {mintUrl && (
          <Section title="Mint address">
            <ListGroup variant="secondary">
              <PressableFeedback
                animation={false}
                accessibilityRole="button"
                accessibilityLabel={`Copy mint address, ${mintUrl}`}
                testID="mint-info-url-copy"
                onPress={handleMintUrlPress}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon name="humbleicons:url" size={20} color={withAlpha(foreground, 0.4)} />
                    </ListGroup.ItemPrefix>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={3}>{mintUrl}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription>Tap to copy</ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                    <ListGroup.ItemSuffix>
                      <Icon name="lets-icons:copy" size={18} color={withAlpha(foreground, 0.4)} />
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
                const rowNostrPubkey = c.isNostr
                  ? resolveMintInfoNostrContactPubkey([c], cachedMeta?.operatorPubkey)
                  : undefined;
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
                    // Stable id for device tests: the row's visible label is a
                    // resolved display name (data-bearing, flaky to select on).
                    testID={
                      c.isNostr
                        ? 'mint-info-contact-nostr'
                        : `mint-info-contact-${c.method.toLowerCase()}`
                    }
                    accessibilityRole={c.isNostr ? 'button' : 'link'}
                    accessibilityLabel={
                      c.isNostr ? 'Open Nostr contact profile' : `${c.method}, ${c.info}`
                    }
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
                              color={withAlpha(foreground, 0.4)}
                            />
                          ) : c.method.toUpperCase() === 'EMAIL' ? (
                            <Icon name="mdi:at" size={20} color={withAlpha(foreground, 0.4)} />
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
              <PressableFeedback
                animation={false}
                accessibilityRole="button"
                accessibilityLabel="Balance split"
                testID="mint-info-balance-split"
                onPress={() => router.navigate('/distribution')}>
                <PressableFeedback.Scale>
                  <ListGroup.Item disabled>
                    <ListGroup.ItemPrefix>
                      <Icon
                        name="fluent:split-vertical-24-filled"
                        size={20}
                        color={withAlpha(foreground, 0.4)}
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
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsSlot: {
    width: '100%',
    alignSelf: 'stretch',
    marginTop: 16,
  },
  statsGrid: {
    width: '100%',
    alignSelf: 'stretch',
    marginHorizontal: -6,
  },
  statsRow: {
    flexDirection: 'row',
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
