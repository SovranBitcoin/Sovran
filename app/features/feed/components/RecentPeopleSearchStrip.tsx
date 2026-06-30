import React, { useCallback, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { nip19 } from 'nostr-tools';

import { useRecentPeopleProfiles } from '@/features/feed/hooks/useRecentPeopleProfiles';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import {
  remeasureVisualLayoutScope,
  useVisualScrollMetricsLogger,
} from '@/shared/lib/contentShiftLog';
import { navigateToProfile } from '@/features/contacts/lib/navigateToProfile';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import { truncateMiddle } from '@/shared/lib/strings';
import { useRecentPeopleStore } from '@/shared/stores/profile/recentPeopleStore';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';

const RECENT_PEOPLE_VISUAL_SCOPE = 'feed.search.recent_people';

export function RecentPeopleSearchStrip({
  showClear = false,
  title = 'Recent searches',
}: {
  showClear?: boolean;
  title?: string;
}) {
  const entries = useRecentPeopleStore((state) => state.entries);
  const clearRecentPeople = useRecentPeopleStore((state) => state.clearRecentPeople);
  const pubkeys = useMemo(() => entries.map((entry) => entry.pubkey), [entries]);
  const rows = useRecentPeopleProfiles(pubkeys);
  const [foreground, muted, accent] = useThemeColor(['foreground', 'muted', 'accent'] as const);
  const stripScrollMetrics = useVisualScrollMetricsLogger({
    scope: RECENT_PEOPLE_VISUAL_SCOPE,
    surface: 'search',
    component: 'RecentPeopleSearchStripScrollView',
    axis: 'x',
    phase: showClear ? 'editable' : 'ready',
    extra: () => ({
      rows: rows.length,
      title,
      showClear,
    }),
  });
  const {
    onContentSizeChange: handleStripContentSizeChange,
    onLayout: handleStripLayout,
    onScroll: reportStripScroll,
  } = stripScrollMetrics;
  const handleStripScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      reportStripScroll(event);
      remeasureVisualLayoutScope(RECENT_PEOPLE_VISUAL_SCOPE, 'horizontal_scroll', {
        extra: {
          rows: rows.length,
          title,
        },
      });
    },
    [reportStripScroll, rows.length, title]
  );

  if (rows.length === 0) return null;

  return (
    <VisualLayoutProbe
      scope={RECENT_PEOPLE_VISUAL_SCOPE}
      surface="search"
      component="RecentPeopleSearchStrip"
      itemKey="section"
      itemType="strip"
      style={styles.section}
      extra={{ rows: rows.length, title, showClear }}>
      <HStack align="center" justify="space-between" style={styles.title}>
        <Text bold size={15} color={foreground}>
          {title}
        </Text>
        {showClear ? (
          <Pressable
            onPress={clearRecentPeople}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Clear recent searches">
            <Text size={13} color={accent}>
              Clear
            </Text>
          </Pressable>
        ) : null}
      </HStack>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        onLayout={handleStripLayout}
        onContentSizeChange={handleStripContentSizeChange}
        onScroll={handleStripScroll}
        scrollEventThrottle={250}
        contentContainerStyle={styles.listContent}>
        {rows.map((row, index) => (
          <VisualLayoutProbe
            key={row.pubkey}
            scope={RECENT_PEOPLE_VISUAL_SCOPE}
            surface="search"
            component="RecentPersonCard"
            itemKey={`person:${row.pubkey.slice(0, 12)}`}
            itemType={row.isLoading && !row.metadata ? 'loading' : 'loaded'}
            index={index}
            extra={{ title }}>
            <RecentPersonCard
              pubkey={row.pubkey}
              displayName={resolveIdentityName({
                pubkey: row.pubkey,
                nostrProfile: row.metadata,
              })}
              picture={row.metadata?.picture}
              subtitle={row.metadata?.nip05 ?? safeShortNpub(row.pubkey)}
              isLoading={row.isLoading && !row.metadata}
              foreground={foreground}
              muted={muted}
            />
          </VisualLayoutProbe>
        ))}
      </ScrollView>
    </VisualLayoutProbe>
  );
}

function RecentPersonCard({
  pubkey,
  displayName,
  picture,
  subtitle,
  isLoading,
  foreground,
  muted,
}: {
  pubkey: string;
  displayName: string;
  picture?: string;
  subtitle: string;
  isLoading: boolean;
  foreground: string;
  muted: string;
}) {
  const handlePress = useCallback(() => navigateToProfile(pubkey), [pubkey]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${displayName}`}
      haptics
      activeOpacity={0.72}
      onPress={handlePress}
      style={styles.card}>
      <Avatar
        state={isLoading ? 'loading' : picture ? 'image' : 'fallback'}
        picture={picture}
        size={52}
        name={displayName}
        seed={pubkey}
      />
      <Text bold size={13} color={foreground} numberOfLines={1} style={styles.nameText}>
        {displayName}
      </Text>
      <Text size={11} color={muted} numberOfLines={1} style={styles.subtitleText}>
        {subtitle}
      </Text>
    </Pressable>
  );
}

function safeShortNpub(pubkey: string): string {
  try {
    return truncateMiddle(nip19.npubEncode(pubkey), 6);
  } catch {
    return truncateMiddle(pubkey, 6);
  }
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    marginBottom: 10,
  },
  listContent: {
    gap: 10,
  },
  card: {
    width: 82,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameText: {
    alignSelf: 'stretch',
    marginTop: 8,
    textAlign: 'center',
  },
  subtitleText: {
    alignSelf: 'stretch',
    marginTop: 3,
    textAlign: 'center',
  },
});
