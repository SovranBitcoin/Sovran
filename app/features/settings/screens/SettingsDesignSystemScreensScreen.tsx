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
 */

import { useMemo, useState } from 'react';
import type { HistoryEntry } from '@cashu/coco-core';

import { asHistoryEntry } from '@/shared/lib/cashu/syntheticHistory';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { buildMintHistoryHref, buildMintInfoHref } from '@/shared/lib/nav/mintInfoRoutes';
import { buildModalProfileHref } from '@/shared/lib/nav/profileRoutes';
import { navigateToTransactionDetail } from '@/shared/lib/nav/transactionDetailRoutes';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useStylePaint } from '@/shared/styles/appStyle';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { PillTabs } from '@/shared/ui/composed/PillTabs';
import { Screen as ScreenWrapper } from '@/shared/ui/composed/Screen';
import { ScreenScrollView } from '@/shared/ui/composed/ScreenScrollView';
import { SectionHeading } from '@/shared/ui/composed/SectionHeading';
import { Surface, useSurfaceInset } from '@/shared/ui/composed/Surface';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

import { buildTimelineScenarios } from './designSystemTimelineScenarios';

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

  return (
    <ScreenWrapper name="SettingsDesignSystemScreensScreen" scroll="custom" safeArea="scroll">
      <ScreenScrollView
        contentContainerStyle={{
          gap: paint.style.space.group,
          paddingHorizontal: paint.style.space.gutter,
        }}>
        <Text size={13} color={paint.text.secondary}>
          Real screens on made-up data. Nothing here moves money: the entries exist only on this
          page, and their mint is not a real one.
        </Text>

        <View style={{ gap: paint.style.space.item }}>
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

        {scenarios.map((scenario) => (
          <Surface key={scenario.id} testID={`ds-screens-scenario-${scenario.id}`}>
            <SectionHeading label={scenario.label} detail={`${scenario.frames.length} states`} />
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
      </ScreenScrollView>
    </ScreenWrapper>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  const paint = useStylePaint();
  return (
    <View style={{ gap: paint.style.space.related }}>
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
