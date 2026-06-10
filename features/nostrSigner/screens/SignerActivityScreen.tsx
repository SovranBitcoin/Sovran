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
import { FlatList, ScrollView } from 'react-native';
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
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
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

const CHIP_AVATAR_SIZE = 18;

const FOOTER_CAPTION = `Activity is stored only on this device. Sovran keeps your last ${ACTIVITY_CAP} requests. Decrypted content is never saved.`;

const EMPTY_TITLE = 'No activity yet';
const EMPTY_SUBTITLE = 'Approvals, denials and auto-signed requests will be logged here.';

type ActivityFilter = { kind: 'all' } | { kind: 'denied' } | { kind: 'app'; clientPubkey: string };

function entryMatchesFilter(entry: Nip46ActivityEntry, filter: ActivityFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true;
    case 'denied':
      return ACTIVITY_VERDICT_DISPLAY[entry.verdict].tone === 'danger';
    case 'app':
      return entry.clientPubkey === filter.clientPubkey;
  }
}

/** Distinct client pubkeys in entry order (newest first), for per-app chips. */
function distinctClients(entries: readonly Nip46ActivityEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.clientPubkey)) continue;
    seen.add(entry.clientPubkey);
    out.push(entry.clientPubkey);
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

  const clientPubkeys = useMemo(() => distinctClients(entries), [entries]);
  const filtered = useMemo(
    () => entries.filter((entry) => entryMatchesFilter(entry, filter)),
    [entries, filter]
  );

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
      const appName = appDisplayName(apps[item.clientPubkey]);
      return (
        <ListRow
          padding="compact"
          iconCircle={{ icon: display.icon, color: toneColors[display.tone], size: 40 }}
          title={entry.headline}
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
    <Screen name="SignerActivityScreen" scroll="custom" safeArea>
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
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
