/**
 * @fileoverview Signer activity detail screen
 *
 * DetailsList for one activity entry: App / Action / Method / Kind / Result /
 * Time / Event ID (truncated + copyable).
 *
 * No raw-event block: activity entries persist only the engine-curated content
 * summary (≤80 chars, normal-class sign_event) and the signed event id — never
 * full event JSON (redaction contract in nip46ActivityStore) — so the plan's
 * monospace raw-event view is not reconstructable here. The stored summary is
 * shown as a Content row when present. Encrypt and decrypt entries instead
 * carry the line "Encrypted content is never stored or displayed."
 *
 * Route params: `id` — the activity entry id.
 */

import React, { useCallback, useMemo } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';

import Icon from 'assets/icons';
import {
  ACTIVITY_VERDICT_DISPLAY,
  appDisplayName,
  permissionEntryFor,
} from '@/features/nostrSigner/components/permissionCatalog';
import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import type { ActivityVerdict, Nip46Method } from '@/features/nostrSigner/lib/nip46Types';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatDate } from '@/shared/lib/date';
import { popup } from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import { DetailsList } from '@/shared/ui/composed/DetailsList';
import { Screen } from '@/shared/ui/composed/Screen';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

const EVENT_ID_TRUNCATE_CHARS = 8;

const ENCRYPTED_CONTENT_NOTE = 'Encrypted content is never stored or displayed.';

/**
 * Result row copy. The plan enumerates the four headline cases; every other
 * verdict falls back to its catalog label so this screen never invents copy.
 */
function resultLabelFor(verdict: ActivityVerdict): string {
  switch (verdict) {
    case 'approved_once':
    case 'approved_pairing':
      return 'Signed · by you';
    case 'auto_approved_grant':
      return 'Signed · Always Allow';
    case 'denied_once':
      return 'Denied';
    case 'expired':
      return 'Expired';
    default:
      return ACTIVITY_VERDICT_DISPLAY[verdict].label;
  }
}

function isEncryptionMethod(method: Nip46Method): boolean {
  return (
    method === 'nip04_encrypt' ||
    method === 'nip44_encrypt' ||
    method === 'nip04_decrypt' ||
    method === 'nip44_decrypt'
  );
}

function CopyableEventId({ eventId }: { eventId: string }) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);

  const copy = useCallback(() => {
    void Clipboard.setStringAsync(eventId);
    popup({ message: 'Copied', type: 'success', variant: 'toast', duration: 1500 });
  }, [eventId]);

  return (
    <Pressable
      haptics
      onPress={copy}
      accessibilityRole="button"
      accessibilityLabel="Copy event ID"
      style={{ padding: 4 }}>
      <HStack spacing={6} style={{ alignItems: 'center' }}>
        <Text size={14} bold color={foreground}>
          {truncateMiddle(eventId, EVENT_ID_TRUNCATE_CHARS)}
        </Text>
        <Icon name="lets-icons:copy" size={16} color={muted} />
      </HStack>
    </Pressable>
  );
}

export function SignerActivityDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const entryId = typeof params.id === 'string' ? params.id : undefined;
  const entry = useNip46ActivityStore((s) =>
    entryId === undefined ? undefined : s.entries.find((candidate) => candidate.id === entryId)
  );
  const connection = useNip46ConnectionsStore((s) =>
    entry === undefined ? undefined : s.apps[entry.clientPubkey]
  );
  const muted = useThemeColor('muted');

  const catalogEntry = useMemo(() => {
    if (entry === undefined) return null;
    return permissionEntryFor({
      method: entry.method,
      ...(entry.kind !== undefined && { kind: entry.kind }),
    });
  }, [entry]);

  // Entry gone (pruned by cap/age while this route was open) — nothing to show.
  if (entry === undefined || catalogEntry === null) {
    return (
      <Screen name="SignerActivityDetailScreen">
        <View />
      </Screen>
    );
  }

  const items = [
    { title: 'App', value: appDisplayName(connection) },
    { title: 'Action', value: catalogEntry.headline },
    { title: 'Method', value: entry.method },
    ...(entry.method === 'sign_event' && entry.kind !== undefined
      ? [{ title: 'Kind', value: `${entry.kind} — ${catalogEntry.permissionEditorLabel}` }]
      : []),
    ...(entry.summary !== undefined ? [{ title: 'Content', value: entry.summary }] : []),
    { title: 'Result', value: resultLabelFor(entry.verdict) },
    { title: 'Time', value: formatDate(entry.at, 'short-date-time') },
    ...(entry.eventId !== undefined
      ? [{ title: 'Event ID', value: <CopyableEventId eventId={entry.eventId} /> }]
      : []),
  ];

  return (
    <Screen name="SignerActivityDetailScreen">
      <View className="pt-2">
        <DetailsList items={items} />
        {isEncryptionMethod(entry.method) ? (
          <View className="px-6 pt-4">
            <HStack spacing={8} style={{ alignItems: 'center' }}>
              <Icon name="mdi:shield" size={16} color={muted} />
              <View style={{ flex: 1 }}>
                <Text size={13} color={muted}>
                  {ENCRYPTED_CONTENT_NOTE}
                </Text>
              </View>
            </HStack>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
