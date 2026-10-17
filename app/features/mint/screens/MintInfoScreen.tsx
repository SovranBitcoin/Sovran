import { useIdentityHeader } from '@/shared/ui/composed/IdentityHeader';
import { Screen } from '@/shared/ui/composed/Screen';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
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
import { OperatorRunsSection } from '@/shared/blocks/OperatorRunsSection';
import { CircleActionButton } from '@/shared/ui/composed/CircleActionButton';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { buildMintHistoryHref } from '@/shared/lib/nav/mintInfoRoutes';
import { formatRate } from '@/shared/lib/number';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import Icon from '@/assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { RatingBarChart } from '@/features/mint/components/RatingBarChart';
import {
  StatsGrid as StatsGridBlock,
  UNKNOWN_STAT,
  type GridStat,
} from '@/shared/ui/composed/StatsGrid';
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
import {
  log,
  useLifecycleLogger,
  useQueryResultLogger,
  useWhyDidRender,
} from '@/shared/lib/logger';
import { urlHost, useVisualStateLogger, visualLayoutScopePart } from '@/shared/lib/contentShiftLog';
import { openExternalUrl } from '@/shared/lib/url';
import { useNostrProfile } from '@/shared/hooks/useNostrProfile';
import { useCachedMintMetadata } from '@/shared/stores/global/mintMetadataStore';
import { Button } from '@/shared/ui/primitives/Button';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { useMintDetailRead, type MintDetailGroupStatus } from '../hooks/useMintDetailRead';
import { useIsMintTrusted } from '../hooks/useIsMintTrusted';
import type { MintAuditSummary } from '../lib/auditInfo';
import { buildMintDetailsRows } from '../lib/mintDetailsRows';
import {
  formatMintInfoNostrFallback,
  getMintInfoNostrDisplayName,
  getSortedMintInfoContacts,
  resolveMintInfoNostrContactPubkey,
} from '../lib/mintInfoContacts';

const ParamsSchema = z.object({
  mintInfoEntry: z.string().min(1).max(64_000).optional(),
});

/**
 * The audit success rate as a ring around the mint's icon, drawn on the first
 * frame: it used to fade in after the content mounted, so it blinked into a
 * page that was already showing. With no audit it is a plain track, not a
 * half-green, half-red ring that read as a 50% score.
 */
function ProgressRing({
  size = 84,
  strokeWidth = 3,
  progress,
  successColor,
  errorColor,
  trackColor,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  /** Share of operations that succeeded, 0..1; `undefined` when not audited. */
  progress: number | undefined;
  successColor: string;
  errorColor: string;
  trackColor: string;
  children?: React.ReactNode;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={progress === undefined ? trackColor : errorColor}
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {progress !== undefined && (
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={successColor}
            strokeWidth={strokeWidth}
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            strokeLinecap="round"
          />
        )}
      </Svg>
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
  const { successRate, avgLatencyMs, mints, melts } = audit ?? {};

  const stats: GridStat[] = [
    {
      label: 'Success rate',
      description: 'Of mint and melt operations',
      value: successRate !== undefined ? formatRate(successRate) : UNKNOWN_STAT,
      placeholder: '100%',
      accent: true,
    },
    {
      label: 'Average time',
      // ucash reports its own probe latency; the retired audit API timed swaps.
      description: audit?.source === 'ucash' ? 'Measured by the auditor' : 'For successful swaps',
      value: avgLatencyMs !== undefined ? `${Math.round(avgLatencyMs)} ms` : UNKNOWN_STAT,
      placeholder: '420 ms',
      accent: true,
    },
    {
      label: 'Total mints',
      description: 'Total mint operations',
      value: mints !== undefined ? Math.round(mints).toString() : UNKNOWN_STAT,
      placeholder: '12,345',
    },
    {
      label: 'Total melts',
      description: 'Total melt operations',
      value: melts !== undefined ? Math.round(melts).toString() : UNKNOWN_STAT,
      placeholder: '12,345',
    },
  ];

  // One slot for every state so the block never unmounts (no layout shift
  // when audit lands, is missing, or fails): skeleton → values, or an inline
  // notice of the same width in place of the grid.
  if (status === 'empty') {
    return (
      <View
        style={styles.statsSlot}
        testID="mint-info-audit-status"
        accessibilityLabel="Audit empty">
        <Notice status="info" description="No audit data for this mint yet." />
      </View>
    );
  }
  if (status === 'error') {
    return (
      <View
        style={styles.statsSlot}
        testID="mint-info-audit-status"
        accessibilityLabel="Audit error">
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
      </View>
    );
  }
  return (
    <StatsGridBlock
      stats={stats}
      loading={status === 'loading'}
      visualKey="mint-info-stats"
      visualSurface="mint-info"
      testID="mint-info-audit-status"
      accessibilityLabel={`Audit ${status}`}
    />
  );
}

export function MintInfoScreen() {
  useLifecycleLogger('MintInfoScreen');
  const [foreground, background] = useThemeColor(['foreground', 'surface'] as const);
  const [danger, success, ringTrack] = useThemeColor([
    'danger',
    'green-300',
    'surface-tertiary',
  ] as const);
  const params = useRouteParams(ParamsSchema, { where: 'mint-flow.info' });
  const { entry, actions } = useScreenActions('mintInfo', params?.mintInfoEntry);

  // COERCED, not cast: the screen-actions manager puts a `FormattedString` (a
  // String SUBCLASS) on the entry, so `as string` was a lie. It matters twice.
  // A boxed string fails `===` against a primitive, and it gets a fresh object
  // identity every time the entry is rebuilt — which showed up in the render
  // log as `mintUrl: 24x new object identity`, invalidating everything keyed on
  // it. A primitive compares by value, so those re-renders simply stop.
  const mintUrl = entry?.mintUrl != null ? String(entry.mintUrl) : '';
  // Fetched value first, then whatever the caller already had on screen, then
  // the URL. The seed is why opening a mint from search paints its name and
  // icon on the first frame instead of skeletoning them for a round-trip.
  const seedDisplayName = entry?.seedDisplayName;
  const displayName =
    entry?.displayName != null
      ? String(entry.displayName)
      : typeof seedDisplayName === 'string' && seedDisplayName.length > 0
        ? seedDisplayName
        : mintUrl;
  const iconUrl =
    (entry?.iconUrl as string | undefined) ?? (entry?.seedIconUrl as string | undefined);
  const morph = useIdentityHeader({
    identity: {
      kind: 'mint',
      name: displayName,
      seed: mintUrl,
      picture: iconUrl,
    },
    title: entry?.fromAccepter ? 'Verify Mint' : 'Mint Details',
    collapseAt: 110,
  });
  // The inspect paths seed mintInfoEntry with only { mintUrl }, so KYM review
  // data never arrives via the entry on that route. Fall back to the same
  // review cache the mint list rows read,
  // otherwise the reviews action and rating chart silently vanish.
  // Installed-or-not, answered from the in-memory trusted list on the FIRST
  // render. The bridge's async `isTrusted` still arrives on the entry and is
  // taken as confirmation, but nothing waits for it: gating on the entry alone
  // made an installed mint flash "Add mint" and delayed its Settings section,
  // because `!entry?.isTrusted` reads UNKNOWN as UNTRUSTED.
  const isTrusted = useIsMintTrusted(mintUrl) || entry?.isTrusted === true;
  const cachedMeta = useCachedMintMetadata(mintUrl || null);
  const detail = useMintDetailRead(mintUrl, entry);
  const kymScore =
    typeof entry?.kymScore === 'number'
      ? entry.kymScore
      : (cachedMeta?.averageScore ??
        (typeof entry?.seedKymScore === 'number' ? entry.seedKymScore : undefined));
  const hasScore = typeof kymScore === 'number' && kymScore >= 0;
  // Audit comes from the metadata store alone, through the selector the mint
  // rows use. The entry's audit fields are a snapshot of that store taken at
  // navigation, so reading them here let the page lag behind its own row.
  const audit = detail.meta.audit;
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
  // The footer's Details button asks for the modal; DetailsSection opens it.
  const [detailsOpen, setDetailsOpen] = useState(false);

  // ── Instrumentation ───────────────────────────────────────────────────────
  // Four groups land independently (identity from the route entry, audit and
  // reviews from their own reads, social from the operator profile), each
  // flipping one section from skeleton to content. These three probes say, in
  // order: what the tree was handed, why it re-rendered, and what the user saw
  // move. Read together with
  //   npx tsx codereview/log-doctor/index.ts reads --latest
  //   npx tsx codereview/log-doctor/index.ts renders --latest
  //   npx tsx codereview/log-doctor/index.ts visual --scope 'mint-info' --latest
  const mintInfoVisualScope = `mint-info.${visualLayoutScopePart(urlHost(mintUrl))}`;
  useQueryResultLogger({
    source: 'useMintDetailRead',
    status: detail.identity,
    count: contactRows.length,
    extra: {
      audit: detail.audit,
      reviews: detail.reviews,
      social: detail.social,
      kymScoreKnown: kymScore !== undefined,
      auditKnown: audit !== undefined,
      operatorProfileLoading: nostrContactLoading,
      identityError: !!identityError,
      isTrusted,
    },
  });
  useWhyDidRender('MintInfoScreen', {
    mintUrl,
    entry,
    actions,
    cachedMeta,
    detail,
    audit,
    contactRows,
    nostrContactProfile,
    nostrContactLoading,
    morphScrollY: morph.scrollY,
  });
  useVisualStateLogger({
    enabled: !!mintUrl,
    scope: mintInfoVisualScope,
    surface: 'mintDetail',
    component: 'MintInfoScreen',
    stateKey: 'mint-info-state',
    phase:
      detail.identity === 'loading'
        ? 'identity-loading'
        : detail.audit === 'loading' || detail.reviews === 'loading'
          ? 'groups-loading'
          : detail.social === 'loading'
            ? 'social-loading'
            : 'ready',
    state: {
      identity: detail.identity,
      audit: detail.audit,
      reviews: detail.reviews,
      social: detail.social,
      contactRows: contactRows.length,
      // The pair that made the button flash: `isTrusted` is what the UI gates
      // on, `entryTrustConfirmed` is the async answer catching up. They should
      // agree from the first frame for an installed mint.
      isTrusted,
      entryTrustConfirmed: entry?.isTrusted === true,
      auditKnown: audit !== undefined,
      kymScoreKnown: kymScore !== undefined,
      iconKnown: Boolean(iconUrl),
      // Was this page opened with what the caller already had on screen? A
      // `seeded: true` row whose phase is `ready` on the first frame is the
      // whole point; `seeded: false` means a caller still has plumbing to do.
      seeded: Boolean(entry?.seedDisplayName || entry?.seedIconUrl),
      nameFromSeed: entry?.displayName == null && Boolean(entry?.seedDisplayName),
      operatorAvatarKnown: Boolean(nostrContactPicture),
      identityError: Boolean(identityError),
    },
    remeasure: true,
  });

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
    <>
      {/* Outside the Screen: its content mounts after the push animation, and a
          title declared in there left the native one showing for the whole
          slide before this one swapped in. */}
      <Stack.Screen
        options={withGlassHeaderItems({
          title: entry?.fromAccepter ? 'Verify Mint' : 'Mint Details',
          headerTitle: morph.headerTitle,
        })}
      />
      <Screen
        name="MintInfoScreen"
        scroll="animated"
        scrollY={morph.scrollY}
        headerBand={morph.headerBand}
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
                  : mintUrl && (entry?.fromScan || !isTrusted)
                    ? [
                        {
                          // The header already closes the page. This slot opens
                          // everything else known about the mint, every value
                          // copyable, as the transaction pages do.
                          testID: 'mint-info-details-open',
                          text: 'Details',
                          accessibilityLabel: 'Mint details',
                          variant: 'secondary',
                          onPress: () => setDetailsOpen(true),
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
                          testID: 'mint-info-details-open',
                          text: 'Details',
                          accessibilityLabel: 'Mint details',
                          variant: 'secondary',
                          onPress: () => setDetailsOpen(true),
                        },
                      ]
              }
            />
          </BottomButtons>
        }>
        {morph.probe}
        <DetailsSection
          trigger="none"
          label="Mint details"
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          items={buildMintDetailsRows({
            mintUrl,
            entry,
            cached: cachedMeta,
            operator: {
              pubkey: nostrContactPubkey,
              name: getMintInfoNostrDisplayName(nostrContactProfile, ''),
            },
          })}
        />
        <View className="pt-4">
          <VStack align="center" className="w-full pb-8 pt-6">
            <Animated.View className="items-center" style={morph.contentStyle}>
              <ProgressRing
                size={84}
                progress={audit?.successRate}
                successColor={success}
                errorColor={danger}
                trackColor={ringTrack}>
                <AnimatedAvatar
                  picture={iconUrl}
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

            {/* The two things a reader does with a mint page besides trusting it,
              as the same labelled circles the profile page uses for Send Money /
              Message / QR. Always both, whatever the reviews read says: the
              reviews screen shows "no reviews yet" honestly, and a row that
              appeared only once a score was known moved the chart under it.
              The reviews star used to be a header action, invisible to the
              accepter flow and to anyone who did not know to look up there. */}
            <HStack className="mt-4 justify-center gap-7">
              <CircleActionButton
                icon="ic:round-star"
                systemIcon="star"
                label="Reviews"
                testID="mint-info-reviews"
                accessibilityLabel="View mint reviews"
                onPress={() => router.navigate({ pathname: '/reviews', params: { mintUrl } })}
              />
              <CircleActionButton
                icon="mdi:history"
                systemIcon="clock.arrow.circlepath"
                label="History"
                testID="mint-info-history"
                accessibilityLabel="View mint update history"
                onPress={() => mintUrl && router.navigate(buildMintHistoryHref(mintUrl))}
              />
            </HStack>

            <Spacer size={16} />

            {hasScore || detail.reviews !== 'error' ? (
              // Keyed by mintUrl so a screen reused for a different mint remounts
              // the chart (fresh roll-in) instead of rolling the prior mint's score.
              // Mounted at one height in every state but a failed read with no
              // score to show: a skeleton while the reviews read is out, the score
              // once known, and the stars marked "No ratings yet" when nobody has
              // rated the mint, so the stars never vanish and the grid never moves.
              <RatingBarChart
                key={mintUrl}
                score={hasScore ? kymScore : -1}
                empty={detail.reviews !== 'loading'}
              />
            ) : (
              // A failed read says so and offers the read again, as the audit
              // block below does.
              <VStack
                className="w-full items-center gap-3 pb-3"
                testID="mint-info-reviews-status"
                accessibilityLabel="Reviews error">
                <Notice
                  status="warning"
                  description="Couldn't load reviews right now."
                  className="w-full"
                />
                <Button
                  testID="mint-info-reviews-retry"
                  text="Try again"
                  variant="secondary"
                  size="compact"
                  onPress={detail.retry}
                />
              </VStack>
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

          {/* One two-line slot for the mint's own words, mounted before the
            NUT-06 read answers so the card fills in place instead of landing
            under the grid at whatever height the copy needs. Longer copy folds
            behind "Show more". Skipped only when the identity read failed —
            the retry notice above already owns that space. */}
          {!identityError ? (
            <>
              <Notice
                status="info"
                title="About this mint"
                loading={detail.identity === 'loading'}
                reserveLines={2}
                collapseLines={3}
                description={
                  typeof entry?.description === 'string' && entry.description.trim()
                    ? entry.description
                    : 'This mint has not published a description.'
                }
                testID="mint-info-about"
              />
              <Spacer size={12} />
            </>
          ) : null}

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

          {typeof entry?.longDescription === 'string' && (
            <>
              <Notice
                status="info"
                icon="ri:file-text-line"
                title="More about this mint"
                collapseLines={4}
                description={entry.longDescription}
                testID="mint-info-details"
              />
              <Spacer size={12} />
            </>
          )}

          {typeof entry?.motd === 'string' && (
            <>
              <Notice
                status="warning"
                title="Message from the mint"
                collapseLines={4}
                description={entry.motd}
                testID="mint-info-motd"
              />
              <Spacer size={12} />
            </>
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

          <OperatorRunsSection
            pubkey={nostrContactPubkey}
            excludeMintUrl={mintUrl}
            title="Operator also runs"
            testID="mint-info-operator-runs"
          />

          {isTrusted && !entry?.fromAccepter && (
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
    </>
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
});
