/**
 * @fileoverview Design System · Screens.
 *
 * One list that opens the app's real screens on fixed, made-up data, so a
 * design pass can reach every state of a screen without a funded wallet or a
 * payment in the right phase:
 *
 *  - every transaction detail screen, at every step of every timeline
 *    scenario, in any unit, locked or not;
 *  - profiles of several kinds;
 *  - mint info, reviews and the other mint screens, for a mint that answers
 *    and one that does not.
 *
 * The rows navigate through the same helpers the wallet uses. The entries are
 * the Timeline page's scenarios (`designSystemTimelineScenarios`), so a state
 * added there appears here too.
 *
 * A pinned jump index (options, each payment type, profiles, mints) scrolls
 * to its section and follows the scroll, so the options stay one tap away.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
} from 'react-native';
import type { HistoryEntry } from '@cashu/coco-core';

import { activeJumpSection } from '@/features/settings/design-system/jumpIndex';

import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { buildMintHistoryHref, buildMintInfoHref } from '@/shared/lib/nav/mintInfoRoutes';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useStylePaint } from '@/shared/styles/appStyle';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { PillTabs, PILL_TABS_HEIGHT } from '@/shared/ui/composed/PillTabs';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface, useSurfaceInset } from '@/shared/ui/composed/Surface';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import {
  buildTimelineScenarios,
  type TimelineScenarioGroup,
} from './designSystemTimelineScenarios';

const UNITS = ['sat', 'usd', 'eur'] as const;
type Unit = (typeof UNITS)[number];

/** How the Bitcoin amount is written; the labels show the same 21,000 sats. */
const BTC_DISPLAYS = ['0', '1', '2', '3'] as const;
const BTC_DISPLAY_LABEL: Record<(typeof BTC_DISPLAYS)[number], string> = {
  '0': '₿0.00021',
  '1': '21,000 ⚡',
  '2': '21,000 sats',
  '3': '₿21,000',
};

const LOCKS = ['Unlocked', 'Locked'] as const;
/** A fixed, well-formed compressed key; nothing is ever locked to it for real. */
const DEMO_LOCK_PUBKEY = '02a1633cafcc01ebfb6d78e39f687a1f0995c62fc95f51ead10a02ee0be551b5dc';

/** Public Nostr accounts with long-lived, well-filled profiles. */
const PROFILES = [
  {
    id: 'verified',
    title: 'Verified address',
    subtitle: 'A domain-checked name, banner and bio',
    pubkey: '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2',
  },
  {
    id: 'developer',
    title: 'Long bio and many follows',
    subtitle: 'Stress for wrapping and counts',
    pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d',
  },
  {
    id: 'empty',
    title: 'No profile at all',
    subtitle: 'A key nobody has published for: every fallback at once',
    pubkey: '5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e5c0de1e7ab1e0001',
  },
] as const;

const MINTS = [
  { id: 'live', title: 'A mint that answers', mintUrl: 'https://mint.minibits.cash/Bitcoin' },
  { id: 'dead', title: 'A mint that does not', mintUrl: 'https://mint.example' },
] as const;

type JumpSection = 'options' | TimelineScenarioGroup | 'profiles' | 'mints' | 'wallet';

const JUMP_LABEL: Record<Exclude<JumpSection, TimelineScenarioGroup>, string> = {
  options: 'Options',
  profiles: 'Profiles',
  mints: 'Mints',
  wallet: 'Your mints',
};
const jumpLabel = (section: JumpSection) =>
  section in JUMP_LABEL ? JUMP_LABEL[section as keyof typeof JUMP_LABEL] : section;
const jumpTestID = (section: JumpSection) => `ds-screens-jump-${section.toLowerCase()}`;

function withVariant(entry: HistoryEntry, unit: Unit, locked: boolean): HistoryEntry {
  return asHistoryEntry({
    ...entry,
    unit,
    // Fiat units count cents: the same face value, not the same number.
    ...(unit === 'sat' ? {} : { amount: 2_100 }),
    // The recorded-lock annotation, which is what the lock readers look for.
    ...(locked
      ? { metadata: { ...entry.metadata, lockType: 'p2pk', lockPubkey: DEMO_LOCK_PUBKEY } }
      : {}),
  });
}

export function SettingsDesignSystemScreensScreen() {
  const paint = useStylePaint();
  const [unit, setUnit] = useState<Unit>('sat');
  const [lock, setLock] = useState<(typeof LOCKS)[number]>('Unlocked');
  const displayBtc = useSettingsStore((s) => s.displayBtc);
  const setDisplayBtc = useSettingsStore((s) => s.setDisplayBtc);
  const ownPubkey = useNostrKeysContext().keys?.pubkey;

  // Fixed for the life of the screen so rows keep their timestamps.
  const scenarios = useMemo(() => buildTimelineScenarios(Date.now() - 5 * 60 * 1000), []);
  const groups = useMemo(() => [...new Set(scenarios.map((s) => s.group))], [scenarios]);
  const sections = useMemo<readonly JumpSection[]>(
    () => ['options', ...groups, 'profiles', 'mints', 'wallet'],
    [groups]
  );

  // Section tops inside the content frame. The frame starts right below the
  // pinned index, so scrolling to a top puts that section just under it.
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef<Partial<Record<JumpSection, number>>>({});
  // A jump's own scroll animation must not walk the index back through the
  // sections it passes; clear once the jump settles (momentum end or fallback
  // timeout for accessibility/non-drag scrolling) or on the next touch drag.
  const jumping = useRef(false);
  const jumpResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState<JumpSection>('options');

  const clearJump = () => {
    jumping.current = false;
    if (jumpResetTimer.current !== null) {
      clearTimeout(jumpResetTimer.current);
      jumpResetTimer.current = null;
    }
  };

  useEffect(() => clearJump, []);

  const measure = (section: JumpSection) => (event: LayoutChangeEvent) => {
    offsets.current[section] = event.nativeEvent.layout.y;
  };
  const jump = (section: JumpSection) => {
    clearJump();
    jumping.current = true;
    setActive(section);
    scrollRef.current?.scrollTo({ y: offsets.current[section] ?? 0, animated: true });
    jumpResetTimer.current = setTimeout(clearJump, 600);
  };
  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (jumping.current) return;
    const y = nativeEvent.contentOffset.y;
    const atEnd =
      y > 0 && y + nativeEvent.layoutMeasurement.height >= nativeEvent.contentSize.height - 1;
    const next = activeJumpSection(sections, offsets.current, y, atEnd);
    if (next) setActive(next);
  };

  return (
    <ScreenWrapper
      name="SettingsDesignSystemScreensScreen"
      scroll="custom"
      safeArea="scroll"
      headerAppearance="opaque"
      stickyContentHeight={PILL_TABS_HEIGHT}
      stickyContent={
        <View className="border-separator border-b">
          <PillTabs
            tabs={sections}
            activeTab={active}
            onTabChange={jump}
            labelFor={jumpLabel}
            testIDFor={jumpTestID}
          />
        </View>
      }>
      <ScreenScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={clearJump}
        onMomentumScrollEnd={clearJump}
        contentContainerStyle={{
          paddingTop: PILL_TABS_HEIGHT + paint.style.space.item,
          paddingHorizontal: paint.style.space.gutter,
        }}>
        <View className="gap-6">
          <View className="gap-3" onLayout={measure('options')} testID="ds-screens-options">
            <Text size={13} color={paint.text.secondary}>
              Real screens on made-up data. Nothing here moves money: the entries exist only on this
              page, and their mint is not a real one.
            </Text>
            <Control label="Unit">
              <PillTabs
                tabs={UNITS}
                activeTab={unit}
                onTabChange={setUnit}
                labelFor={(tab) => tab.toUpperCase()}
                testIDFor={(tab) => `ds-screens-unit-${tab}`}
              />
            </Control>
            <Control label="Lock">
              <PillTabs
                tabs={LOCKS}
                activeTab={lock}
                onTabChange={setLock}
                testIDFor={(tab) => `ds-screens-lock-${tab.toLowerCase()}`}
              />
            </Control>
            <Control label="Bitcoin display · changes your setting">
              <PillTabs
                tabs={BTC_DISPLAYS}
                activeTab={BTC_DISPLAYS.find((d) => d === String(displayBtc)) ?? '3'}
                onTabChange={(tab) => setDisplayBtc(Number(tab))}
                labelFor={(tab) => BTC_DISPLAY_LABEL[tab]}
                testIDFor={(tab) => `ds-screens-btc-${tab}`}
              />
            </Control>
          </View>

          {groups.map((group) => (
            <View key={group} className="gap-6" onLayout={measure(group)}>
              {scenarios
                .filter((scenario) => scenario.group === group)
                .map((scenario) => (
                  <Surface key={scenario.id} testID={`ds-screens-scenario-${scenario.id}`}>
                    <SectionHeading
                      label={scenario.label}
                      detail={`${scenario.frames.length} states`}
                    />
                    {scenario.frames.map((frame, index) => (
                      <LinkRow
                        key={`${scenario.id}-${index}`}
                        testID={`ds-screens-${scenario.id}-${index}`}
                        title={frame.note}
                        subtitle={`${frame.historyEntry.type} · ${String(
                          (frame.historyEntry as { state?: unknown }).state ?? 'no state'
                        )}`}
                        onPress={() =>
                          navigateToTransactionDetail(
                            withVariant(frame.historyEntry, unit, lock === 'Locked'),
                            'design-system.screens'
                          )
                        }
                      />
                    ))}
                  </Surface>
                ))}
            </View>
          ))}

          <View onLayout={measure('profiles')}>
            <Surface testID="ds-screens-profiles">
              <SectionHeading label="Profiles" />
              {ownPubkey ? (
                <LinkRow
                  testID="ds-screens-profile-own"
                  title="Your own profile"
                  subtitle="Edit affordances instead of pay and follow"
                  onPress={() => router.navigate(buildModalProfileHref({ pubkey: ownPubkey }))}
                />
              ) : null}
              {PROFILES.map((profile) => (
                <LinkRow
                  key={profile.id}
                  testID={`ds-screens-profile-${profile.id}`}
                  title={profile.title}
                  subtitle={profile.subtitle}
                  onPress={() => router.navigate(buildModalProfileHref({ pubkey: profile.pubkey }))}
                />
              ))}
            </Surface>
          </View>

          <View className="gap-6" onLayout={measure('mints')}>
            {MINTS.map((mint) => (
              <Surface key={mint.id} testID={`ds-screens-mint-${mint.id}`}>
                <SectionHeading label={mint.title} detail={new URL(mint.mintUrl).host} />
                <LinkRow
                  testID={`ds-screens-mint-${mint.id}-info`}
                  title="Mint info"
                  subtitle="Identity, contact, limits, supported features"
                  onPress={() => router.navigate(buildMintInfoHref(mint.mintUrl))}
                />
                <LinkRow
                  testID={`ds-screens-mint-${mint.id}-reviews`}
                  title="Ratings and reviews"
                  subtitle="Score, review list and its empty state"
                  onPress={() =>
                    router.navigate({
                      pathname: '/(mint-flow)/reviews',
                      params: { mintUrl: mint.mintUrl },
                    })
                  }
                />
                <LinkRow
                  testID={`ds-screens-mint-${mint.id}-history`}
                  title="Change history"
                  subtitle="What the mint has changed about itself"
                  onPress={() => router.navigate(buildMintHistoryHref(mint.mintUrl))}
                />
              </Surface>
            ))}
          </View>

          <View onLayout={measure('wallet')}>
            <Surface testID="ds-screens-wallet">
              <SectionHeading label="Your mints" />
              <LinkRow
                testID="ds-screens-mint-add"
                title="Add a mint"
                subtitle="Discovery, search and recommended mints"
                onPress={() => router.navigate('/(mint-flow)/add')}
              />
              <LinkRow
                testID="ds-screens-mint-distribution"
                title="Balance by mint"
                subtitle="How the balance is spread, and rebalancing"
                onPress={() => router.navigate('/(mint-flow)/distribution')}
              />
            </Surface>
          </View>
        </View>
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  const paint = useStylePaint();
  return (
    <View className="gap-1">
      <Text size={13} semibold color={paint.text.secondary}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function LinkRow(props: { title: string; subtitle: string; testID: string; onPress: () => void }) {
  // Inside the surface, so the row shares the heading's left edge.
  const inset = useSurfaceInset();
  return (
    <ListRow
      paddingHorizontal={inset}
      title={props.title}
      subtitle={props.subtitle}
      testID={props.testID}
      onPress={props.onPress}
      accessibilityLabel={`${props.title}. ${props.subtitle}`}
    />
  );
}
