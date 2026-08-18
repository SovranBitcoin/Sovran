/**
 * @fileoverview Signer activity detail screen
 *
 * Identity header (app avatar + name + relative time), then a compact card of
 * label-above-value rows: Action / Content / Result. Protocol jargon (raw
 * method, kind number, event id hex) lives behind a collapsed "Technical
 * details" expander — power-user material, hidden by default.
 *
 * No raw-event block: activity entries persist only the engine-curated content
 * summary (≤80 chars, normal-class sign_event) and the signed event id — never
 * full event JSON (redaction contract in nip46ActivityStore) — so a monospace
 * raw-event view is not reconstructable here. Encrypt and decrypt entries
 * carry the line "Encrypted content is never stored or displayed."
 *
 * Route params: `id` — the activity entry id.
 */

import React, { useCallback, useMemo, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { ListGroup, Separator } from 'heroui-native';

import Icon from 'assets/icons';
import {
  ACTIVITY_VERDICT_DISPLAY,
  appDisplayName,
  permissionEntryFor,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  DecryptPeerCard,
  ReferencedNoteCard,
} from '@/features/nostrSigner/components/SummaryPreviewCards';
import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import { connectionForClient } from '@/features/nostrSigner/lib/connectionMatch';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import type { ActivityVerdict, Nip46Method } from '@/features/nostrSigner/lib/nip46Types';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { popup } from '@/shared/lib/popup';
import { truncateMiddle } from '@/shared/lib/strings';
import { Screen } from '@/shared/ui/composed/Screen';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const EVENT_ID_TRUNCATE_CHARS = 8;

const ENCRYPTED_CONTENT_NOTE = 'Encrypted content is never stored or displayed.';
const TECHNICAL_DETAILS_LABEL = 'Technical details';

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
      style={{ paddingVertical: 2 }}>
      <HStack gap={6} style={{ alignItems: 'center' }}>
        <Text size={14} bold color={foreground}>
          {truncateMiddle(eventId, EVENT_ID_TRUNCATE_CHARS)}
        </Text>
        <Icon name="lets-icons:copy" size={16} color={muted} />
      </HStack>
    </Pressable>
  );
}

/** Compact label-above-value row — no title/value horizontal split. */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  return (
    <ListGroup.Item disabled>
      <ListGroup.ItemContent>
        <VStack gap={2}>
          <Text size={12} color={muted}>
            {label}
          </Text>
          {typeof value === 'string' ? (
            <Text size={14} color={foreground}>
              {value}
            </Text>
          ) : (
            value
          )}
        </VStack>
      </ListGroup.ItemContent>
    </ListGroup.Item>
  );
}

export function SignerActivityDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string }>();
  const entryId = typeof params.id === 'string' ? params.id : undefined;
  const entry = useNip46ActivityStore((s) =>
    entryId === undefined ? undefined : s.entries.find((candidate) => candidate.id === entryId)
  );
  const apps = useNip46ConnectionsStore((s) => s.apps);
  // Resolve through the previousClientPubkeys chain so pre-replacement
  // entries still attribute to the live app record.
  const connection =
    entry === undefined ? undefined : connectionForClient(apps, entry.clientPubkey);
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const [techExpanded, setTechExpanded] = useState(false);

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

  const appName = appDisplayName(connection);
  const summaryLine = entry.summary?.line ?? entry.contentPreview;

  return (
    <Screen name="SignerActivityDetailScreen">
      <View className="pt-3">
        {/* App identity header (app-supplied metadata — bounded, untrusted) */}
        <HStack gap={12} style={{ alignItems: 'center' }}>
          <Avatar
            state={connection?.image ? 'image' : 'fallback'}
            picture={connection?.image}
            seed={entry.clientPubkey}
            size={44}
            alt={appName}
          />
          <VStack gap={2} style={{ flex: 1 }}>
            <Text size={16} bold color={foreground} numberOfLines={1}>
              {appName}
            </Text>
            <Text size={12} color={muted} numberOfLines={1}>
              {formatRelative(entry.at, 'chat-bubble')}
            </Text>
          </VStack>
        </HStack>

        {/* What happened */}
        <View className="mt-3">
          <ListGroup variant="secondary">
            <DetailRow label="Action" value={entry.summary?.headline ?? catalogEntry.headline} />
            {summaryLine !== undefined ? (
              <>
                <Separator className="mx-4" />
                <DetailRow label="Content" value={summaryLine} />
              </>
            ) : null}
            <Separator className="mx-4" />
            <DetailRow label="Result" value={resultLabelFor(entry.verdict)} />
            <Separator className="mx-4" />
            <DetailRow label="Time" value={formatDate(entry.at, 'short-date-time')} />
          </ListGroup>
        </View>

        {/* Referenced-note preview (reaction/repost/reply target) */}
        {entry.summary?.refEventId !== undefined ? (
          <View className="pt-3">
            <ReferencedNoteCard eventId={entry.summary.refEventId} />
          </View>
        ) : null}
        {/* Decrypt conversation peer */}
        {entry.summary?.refPubkey !== undefined ? (
          <View className="pt-3">
            <DecryptPeerCard peerPubkey={entry.summary.refPubkey} />
          </View>
        ) : null}
        {isEncryptionMethod(entry.method) ? (
          <View className="pt-3">
            <HStack gap={8} style={{ alignItems: 'center' }}>
              <Icon name="mdi:shield" size={16} color={muted} />
              <View style={{ flex: 1 }}>
                <Text size={13} color={muted}>
                  {ENCRYPTED_CONTENT_NOTE}
                </Text>
              </View>
            </HStack>
          </View>
        ) : null}

        {/* Protocol jargon, collapsed by default */}
        <Pressable
          haptics
          accessibilityRole="button"
          accessibilityState={{ expanded: techExpanded }}
          accessibilityLabel={TECHNICAL_DETAILS_LABEL}
          onPress={() => setTechExpanded((value) => !value)}
          style={{ paddingTop: 14 }}>
          <HStack gap={4} style={{ alignItems: 'center' }}>
            <Text size={13} bold color={muted}>
              {TECHNICAL_DETAILS_LABEL}
            </Text>
            <Icon
              name={techExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
              size={16}
              color={muted}
            />
          </HStack>
        </Pressable>
        {techExpanded ? (
          <View className="mt-2">
            <ListGroup variant="secondary">
              <DetailRow label="Method" value={entry.method} />
              {entry.method === 'sign_event' && entry.kind !== undefined ? (
                <>
                  <Separator className="mx-4" />
                  <DetailRow
                    label="Kind"
                    value={`${entry.kind} — ${catalogEntry.permissionEditorLabel}`}
                  />
                </>
              ) : null}
              {entry.eventId !== undefined ? (
                <>
                  <Separator className="mx-4" />
                  <DetailRow label="Event ID" value={<CopyableEventId eventId={entry.eventId} />} />
                </>
              ) : null}
            </ListGroup>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
