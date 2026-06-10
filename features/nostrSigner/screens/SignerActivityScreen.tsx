/**
 * @fileoverview Signer activity log screen
 *
 * Filterable list of NIP-46 request outcomes: filter chips (All · per-app ·
 * Denied), compact rows with the catalog verdict icon/tone, the catalog
 * headline, and a "{app} · {time}" subtitle. Auto-signed rows carry the
 * "Auto-signed — Always Allow" accent line. Tapping a row opens the
 * activity-detail route with the entry id.
 *
 * All presentation (headline, verdict icon/tone/accent) comes from
 * `permissionCatalog` — this screen derives nothing. App names are bounded
 * by `appDisplayName` (untrusted) and never logged.
 *
 * Route params (optional): `clientPubkey` — initial per-app filter, used by
 * the app-detail screen's "View Activity" link.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { LegendList } from '@legendapp/list/react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Button as HerouiButton } from 'heroui-native';

import Icon from 'assets/icons';
import {
  ACTIVITY_VERDICT_DISPLAY,
  appDisplayName,
  permissionEntryFor,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  useNip46ActivityStore,
  type Nip46ActivityEntry,
} from '@/features/nostrSigner/data/nip46ActivityStore';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { connectionForClient } from '@/features/nostrSigner/lib/connectionMatch';
import { ACTIVITY_CAP } from '@/features/nostrSigner/lib/nip46Types';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatRelative } from '@/shared/lib/date';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

// ListRow compact: 8px vertical padding ×2 + 40px icon circle.
const ESTIMATED_ROW_HEIGHT = 56;
// Chip strip: 10px vertical padding ×2 + ~36px chip height.
const CHIP_HEADER_HEIGHT = 56;
const CHIP_AVATAR_SIZE = 18;

const FOOTER_CAPTION = `Activity is stored only on this device. Sovran keeps your last ${ACTIVITY_CAP} requests. Decrypted content is never saved.`;

const EMPTY_TITLE = 'No activity yet';
const EMPTY_SUBTITLE = 'Approvals, denials and auto-signed requests will be logged here.';

type ActivityFilter = { kind: 'all' } | { kind: 'denied' } | { kind: 'app'; clientPubkey: string };

function entryMatchesFilter(
  entry: Nip46ActivityEntry,
  filter: ActivityFilter,
  appFilterKeys: ReadonlySet<string> | null
): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'denied':
      return ACTIVITY_VERDICT_DISPLAY[entry.verdict].tone === 'danger';
    case 'app':
      // A replaced app's history spans its old client keys too.
      return appFilterKeys !== null
        ? appFilterKeys.has(entry.clientPubkey)
        : entry.clientPubkey === filter.clientPubkey;
  }
}

/**
 * Distinct apps for the per-app chips, in entry order (newest first). Entries
 * from a REPLACED client key collapse into the live record's chip via the
 * previousClientPubkeys chain; fully-orphaned keys keep their own chip.
 */
function distinctClients(
  entries: readonly Nip46ActivityEntry[],
  apps: Record<string, Nip46Connection>
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const representative =
      connectionForClient(apps, entry.clientPubkey)?.clientPubkey ?? entry.clientPubkey;
    if (seen.has(representative)) continue;
    seen.add(representative);
    out.push(representative);
  }
  return out;
}

function FilterChip({
  selected,
  label,
  onPress,
  leading,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  leading?: React.ReactNode;
}) {
  return (
    <HerouiButton
      variant={selected ? 'primary' : 'secondary'}
      size="sm"
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityState={{ selected }}>
      {leading}
      <HerouiButton.Label>{label}</HerouiButton.Label>
    </HerouiButton>
  );
}

export function SignerActivityScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ clientPubkey?: string }>();
  const entries = useNip46ActivityStore((s) => s.entries);
  const apps = useNip46ConnectionsStore((s) => s.apps);
  const [muted, success, danger, warning] = useThemeColor([
    'muted',
    'success',
    'danger',
    'warning',
  ] as const);

  const initialFilter: ActivityFilter = useMemo(() => {
    const candidate = typeof params.clientPubkey === 'string' ? params.clientPubkey : undefined;
    return candidate !== undefined && isNostrPubkeyHex(candidate)
      ? { kind: 'app', clientPubkey: candidate }
      : { kind: 'all' };
    // Route params are the screen's input; re-deriving on change is intended.
  }, [params.clientPubkey]);
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);

  const toneColors = useMemo(
    () => ({ success, danger, warning }) as const,
    [success, danger, warning]
  );

  const clientPubkeys = useMemo(() => distinctClients(entries, apps), [entries, apps]);
  // Per-app filter allowed set: the live key plus every key it replaced.
  const appFilterKeys = useMemo(() => {
    if (filter.kind !== 'app') return null;
    const live = apps[filter.clientPubkey];
    return new Set<string>([filter.clientPubkey, ...(live?.previousClientPubkeys ?? [])]);
  }, [filter, apps]);
  const filtered = useMemo(
    () => entries.filter((entry) => entryMatchesFilter(entry, filter, appFilterKeys)),
    [entries, filter, appFilterKeys]
  );

  // Content scrolls UNDER the transparent blur header (thread-page style).
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const listContentStyle = useMemo(
    () => ({ paddingTop: headerHeight, paddingBottom: insets.bottom }),
    [headerHeight, insets.bottom]
  );
  const indicatorInsets = useMemo(() => ({ top: headerHeight }), [headerHeight]);

  const openDetail = useCallback((entryId: string) => {
    router.push(`/(signer-flow)/activity-detail?id=${encodeURIComponent(entryId)}` as never);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Nip46ActivityEntry }) => {
      const display = ACTIVITY_VERDICT_DISPLAY[item.verdict];
      const entry = permissionEntryFor({
        method: item.method,
        ...(item.kind !== undefined && { kind: item.kind }),
      });
      const appName = appDisplayName(connectionForClient(apps, item.clientPubkey));
      return (
        <ListRow
          padding="compact"
          iconCircle={{ icon: display.icon, color: toneColors[display.tone], size: 40 }}
          title={item.summaryV2?.headline ?? entry.headline}
          subtitle={`${appName} · ${formatRelative(item.at, 'chat-bubble')}`}
          accent={
            display.accentLine !== undefined ? (
              <Text size={12} color={toneColors[display.tone]} numberOfLines={1}>
                {display.accentLine}
              </Text>
            ) : undefined
          }
          trailing={<Icon name="mdi:chevron-right" size={20} color={muted} />}
          onPress={() => openDetail(item.id)}
          accessibilityHint="Opens the request details"
        />
      );
    },
    [apps, muted, openDetail, toneColors]
  );

  const chips = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}>
      <FilterChip
        selected={filter.kind === 'all'}
        label="All"
        onPress={() => setFilter({ kind: 'all' })}
      />
      {clientPubkeys.map((clientPubkey) => {
        const connection = apps[clientPubkey];
        return (
          <FilterChip
            key={clientPubkey}
            selected={filter.kind === 'app' && filter.clientPubkey === clientPubkey}
            label={appDisplayName(connection)}
            leading={
              <Avatar
                state={connection?.image ? 'image' : 'fallback'}
                picture={connection?.image}
                seed={clientPubkey}
                fallbackVariant="beam"
                size={CHIP_AVATAR_SIZE}
                alt={appDisplayName(connection)}
              />
            }
            onPress={() => setFilter({ kind: 'app', clientPubkey })}
          />
        );
      })}
      <FilterChip
        selected={filter.kind === 'denied'}
        label="Denied"
        onPress={() => setFilter({ kind: 'denied' })}
      />
    </ScrollView>
  );

  return (
    <Screen name="SignerActivityScreen" scroll="custom">
      {/* Legend List: the activity log holds up to ACTIVITY_CAP entries —
          recycled fixed-height rows keep scrolling cheap. Rows are stateless
          (ListRow + derived props), so recycling is safe. */}
      <LegendList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        recycleItems
        estimatedItemSize={ESTIMATED_ROW_HEIGHT}
        estimatedHeaderSize={CHIP_HEADER_HEIGHT}
        drawDistance={400}
        contentContainerStyle={listContentStyle}
        scrollIndicatorInsets={indicatorInsets}
        ListHeaderComponent={chips}
        ListEmptyComponent={
          <EmptyState icon="lucide:activity" title={EMPTY_TITLE} subtitle={EMPTY_SUBTITLE} />
        }
        ListFooterComponent={
          <View className="px-6 pb-8 pt-4">
            <Text size={12} color={muted} style={{ textAlign: 'center', lineHeight: 17 }}>
              {FOOTER_CAPTION}
            </Text>
          </View>
        }
        style={{ flex: 1 }}
      />
    </Screen>
  );
}
