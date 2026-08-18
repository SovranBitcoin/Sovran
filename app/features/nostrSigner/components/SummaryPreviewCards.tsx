/**
 * @fileoverview Approval-sheet preview cards for summarized requests
 *
 * One small component per `SummaryDetail` variant: the referenced note a
 * reaction/repost/reply targets (fetched via useReferencedEventPreview, with
 * skeleton/unavailable states so the sheet stays answerable), the follow-list
 * diff, the decrypt conversation peer, app-data operations, and zap requests.
 * `ExpandableEventJson` keeps the expandable raw JSON available under every
 * sign_event card — human copy never replaces raw inspection.
 *
 * Every rendered string derived from request params or fetched content is
 * length-bounded before display and never logged.
 */

import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Button as HerouiButton } from 'heroui-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';

import Icon from 'assets/icons';
import { shortPubkey } from '@/features/nostrSigner/components/display';
import { encryptedPayloadLabel } from '@/features/nostrSigner/components/permissionCatalog';
import { useReferencedEventPreview } from '@/features/nostrSigner/hooks/useReferencedEventPreview';
import { boundDisplay } from '@/features/nostrSigner/lib/boundedDisplay';
import type { SummaryDetail } from '@/features/nostrSigner/lib/requestSummary';
import type { UnsignedEvent } from '@/features/nostrSigner/lib/nip46Types';
import { useNostrPersonDisplay } from '@/shared/hooks/useNostrPersonDisplay';
import { useNostrProfileMetadataMany } from '@/shared/hooks/useNostrProfileMetadata';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { popup } from '@/shared/lib/popup';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const CONTENT_PREVIEW_MAX_CHARS = 300;
const NAME_MAX_CHARS = 48;
const FULL_EVENT_DISPLAY_MAX_CHARS = 16_384;
const FULL_EVENT_MAX_HEIGHT = 240;
const MONOSPACE_FONT = Platform.select({ ios: 'Courier New', default: 'monospace' });

const SHOW_DETAILS_LABEL = 'Details';
const HIDE_DETAILS_LABEL = 'Hide details';

const CENTER_ROW_STYLE = { alignItems: 'center' } as const;
const BASELINE_ROW_STYLE = { alignItems: 'baseline' } as const;
const FLEX_ONE_STYLE = { flex: 1 } as const;
const PREVIEW_CARD_STYLE = { gap: 8 } as const;
const OWN_TEXT_CARD_STYLE = { gap: 4 } as const;
const FOLLOW_DIFF_CARD_STYLE = { gap: 10 } as const;
const PREFIX_BADGE_STYLE = { minWidth: 18 } as const;
const NAME_SHRINK_STYLE = { flexShrink: 1 } as const;
const PEER_NAME_BLOCK_STYLE = { flex: 1, gap: 2 } as const;
const SKELETON_AVATAR_STYLE = { width: 28, height: 28, borderRadius: 14 } as const;
const SKELETON_NAME_STYLE = { width: 120, height: 14 } as const;
const SKELETON_LINE_FULL_STYLE = { width: '100%', height: 12 } as const;
const SKELETON_LINE_SHORT_STYLE = { width: '70%', height: 12 } as const;

function boundedName(name: string | undefined, pubkey: string): string {
  const trimmed = name?.trim();
  return trimmed ? boundDisplay(trimmed, NAME_MAX_CHARS) : shortPubkey(pubkey);
}

/** Avatar + resolved display name for a pubkey (kind-0 cache + NDK). */
function PeerIdentityRow({
  pubkey,
  nameOverride,
  pictureOverride,
  prefix,
  prefixColor,
  size = 28,
}: {
  pubkey: string;
  nameOverride?: string;
  pictureOverride?: string;
  /** Leading badge text, e.g. "+ Follows" / "− Unfollows". */
  prefix?: string;
  prefixColor?: string;
  size?: number;
}) {
  const [foreground] = useThemeColor(['foreground'] as const);
  const person = useNostrPersonDisplay(
    nameOverride === undefined || pictureOverride === undefined ? pubkey : undefined
  );
  const name = boundedName(nameOverride ?? person.name, pubkey);
  const picture = pictureOverride ?? person.picture;

  return (
    <HStack spacing={8} style={CENTER_ROW_STYLE}>
      {prefix !== undefined ? (
        <Text size={13} bold color={prefixColor ?? foreground} style={PREFIX_BADGE_STYLE}>
          {prefix}
        </Text>
      ) : null}
      <Avatar
        state={picture ? 'image' : 'fallback'}
        picture={picture}
        seed={pubkey}
        size={size}
        alt={name}
      />
      <Text size={14} bold color={foreground} numberOfLines={1} style={NAME_SHRINK_STYLE}>
        {name}
      </Text>
    </HStack>
  );
}

/**
 * The note a reaction/repost/reply targets. `embedded` (kind-6 content JSON)
 * renders instantly; otherwise the note is fetched by id. Loading shows a
 * skeleton; a miss shows a bounded text fallback — buttons stay live.
 */
export function ReferencedNoteCard({
  eventId,
  embedded,
}: {
  eventId?: string;
  embedded?: { id?: string; pubkey: string; text: string };
}) {
  const [foreground, muted, surface] = useThemeColor(['foreground', 'muted', 'surface'] as const);
  const fetched = useReferencedEventPreview(embedded === undefined ? eventId : undefined);

  if (embedded !== undefined) {
    return (
      <View className="bg-surface rounded-2xl p-3" style={PREVIEW_CARD_STYLE}>
        <PeerIdentityRow pubkey={embedded.pubkey} />
        <Text size={14} numberOfLines={3} color={foreground}>
          {embedded.text}
        </Text>
      </View>
    );
  }

  if (eventId === undefined) return null;

  const isPreviewLoading = fetched.status === 'loading' || fetched.status === 'idle';

  if (!isPreviewLoading && (fetched.status === 'unavailable' || fetched.event === undefined)) {
    return (
      <View className="bg-surface rounded-2xl p-3">
        <Text size={13} color={muted}>
          {`Couldn't load the referenced post · ${shortPubkey(eventId)}`}
        </Text>
      </View>
    );
  }

  return (
    <SkeletonContentCrossfade
      loading={isPreviewLoading}
      surfaceColor={surface}
      visualKey="referenced-post-preview"
      visualSurface="nostr-signer"
      renderSkeleton={() => (
        <View className="bg-surface rounded-2xl p-3" style={PREVIEW_CARD_STYLE}>
          <HStack spacing={8} style={CENTER_ROW_STYLE}>
            <Skeleton style={SKELETON_AVATAR_STYLE} />
            <Skeleton style={SKELETON_NAME_STYLE} />
          </HStack>
          <Skeleton style={SKELETON_LINE_FULL_STYLE} />
          <Skeleton style={SKELETON_LINE_SHORT_STYLE} />
        </View>
      )}
      renderContent={() => {
        if (fetched.event === undefined) return null;
        return (
          <View className="bg-surface rounded-2xl p-3" style={PREVIEW_CARD_STYLE}>
            <PeerIdentityRow
              pubkey={fetched.event.pubkey}
              nameOverride={fetched.author?.name}
              pictureOverride={fetched.author?.picture}
            />
            <Text size={14} numberOfLines={3} color={foreground}>
              {boundDisplay(fetched.event.content.trim(), CONTENT_PREVIEW_MAX_CHARS)}
            </Text>
          </View>
        );
      }}
    />
  );
}

/** "Your reply" / "Your message" block under a referenced-note card. */
export function OwnTextBlock({ label, text }: { label: string; text: string }) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  if (text.length === 0) return null;
  return (
    <View className="bg-surface rounded-2xl p-3" style={OWN_TEXT_CARD_STYLE}>
      <Text size={12} bold color={muted}>
        {label}
      </Text>
      <Text size={14} numberOfLines={4} color={foreground}>
        {text}
      </Text>
    </View>
  );
}

const FOLLOW_ROW_CAP = 10;

/** Who a kind-3 adds/removes vs the current follow list. */
export function FollowDiffCard({
  detail,
}: {
  detail: Extract<SummaryDetail, { type: 'follow_diff' }>;
}) {
  const [muted, success, danger, warning] = useThemeColor([
    'muted',
    'success',
    'danger',
    'warning',
  ] as const);
  const shown = useMemo(
    () => [...detail.added.slice(0, FOLLOW_ROW_CAP), ...detail.removed.slice(0, FOLLOW_ROW_CAP)],
    [detail.added, detail.removed]
  );
  // Warm the kind-0 cache for every shown row in one batched subscription.
  useNostrProfileMetadataMany(shown);

  if (detail.baseline === 'unavailable') {
    return (
      <View className="bg-surface rounded-2xl p-3">
        <HStack spacing={8} style={CENTER_ROW_STYLE}>
          <Icon name="mdi:alert-circle-outline" size={16} color={warning} />
          <View style={FLEX_ONE_STYLE}>
            <Text size={13} color={muted}>
              {`Replaces your entire follow list with ${detail.total} accounts.`}
            </Text>
          </View>
        </HStack>
      </View>
    );
  }

  const hiddenCount =
    Math.max(0, detail.addedCount - FOLLOW_ROW_CAP) +
    Math.max(0, detail.removedCount - FOLLOW_ROW_CAP);

  return (
    <View className="bg-surface rounded-2xl p-3" style={FOLLOW_DIFF_CARD_STYLE}>
      {detail.added.slice(0, FOLLOW_ROW_CAP).map((pubkey) => (
        <PeerIdentityRow key={`add-${pubkey}`} pubkey={pubkey} prefix="+" prefixColor={success} />
      ))}
      {detail.removed.slice(0, FOLLOW_ROW_CAP).map((pubkey) => (
        <PeerIdentityRow key={`remove-${pubkey}`} pubkey={pubkey} prefix="−" prefixColor={danger} />
      ))}
      {hiddenCount > 0 ? (
        <Text size={12} color={muted}>
          {`and ${hiddenCount} more`}
        </Text>
      ) : null}
      <Text size={12} color={muted}>
        {`${detail.total} accounts after this change`}
      </Text>
    </View>
  );
}

/** WHO the encrypted conversation involves — content itself never previews. */
export function DecryptPeerCard({
  peerPubkey,
  ciphertextLength,
}: {
  peerPubkey: string;
  /** Omitted on surfaces (activity detail) where the payload is long gone. */
  ciphertextLength?: number;
}) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const person = useNostrPersonDisplay(peerPubkey);
  const name = boundedName(person.name, peerPubkey);
  return (
    <View className="bg-surface rounded-2xl p-3">
      <HStack spacing={10} style={CENTER_ROW_STYLE}>
        <Avatar
          state={person.picture ? 'image' : 'fallback'}
          picture={person.picture}
          seed={peerPubkey}
          size={36}
          alt={name}
        />
        <View style={PEER_NAME_BLOCK_STYLE}>
          <Text size={15} bold color={foreground} numberOfLines={1}>
            {name}
          </Text>
          {ciphertextLength !== undefined ? (
            <HStack spacing={4} style={CENTER_ROW_STYLE}>
              <Icon name="mdi:shield" size={12} color={muted} />
              <Text size={12} color={muted}>
                {encryptedPayloadLabel(ciphertextLength)}
              </Text>
            </HStack>
          ) : (
            <Text size={12} color={muted} numberOfLines={1}>
              {shortPubkey(peerPubkey)}
            </Text>
          )}
        </View>
      </HStack>
    </View>
  );
}

/** The NIP-78 operation line ("Load its app settings from your account"). */
export function AppDataCard({ operationLine }: { operationLine: string }) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  return (
    <View className="bg-surface rounded-2xl p-3">
      <HStack spacing={8} style={CENTER_ROW_STYLE}>
        <Icon name="fluent:apps-16-filled" size={16} color={muted} />
        <View style={FLEX_ONE_STYLE}>
          <Text size={14} color={foreground}>
            {operationLine}
          </Text>
        </View>
      </HStack>
    </View>
  );
}

/** Zap amount + recipient. Signing a 9734 fetches an invoice; it cannot pay. */
export function ZapRequestCard({
  amountSats,
  recipientPubkey,
}: {
  amountSats?: number;
  recipientPubkey?: string;
}) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  return (
    <View className="bg-surface rounded-2xl p-3" style={PREVIEW_CARD_STYLE}>
      <HStack spacing={8} style={BASELINE_ROW_STYLE}>
        <Text size={20} bold color={foreground}>
          {amountSats !== undefined ? `${amountSats} sats` : 'Unspecified amount'}
        </Text>
        <Text size={12} color={muted}>
          zap request
        </Text>
      </HStack>
      {recipientPubkey !== undefined ? <PeerIdentityRow pubkey={recipientPubkey} /> : null}
    </View>
  );
}

const EXPANDED_BLOCK_STYLE = { gap: 6 } as const;
const JSON_SCROLL_STYLE = { maxHeight: FULL_EVENT_MAX_HEIGHT } as const;
const JSON_TEXT_STYLE = { fontFamily: MONOSPACE_FONT } as const;

/**
 * Expandable raw event JSON + copy button — the one JSON inspector for every
 * sign_event surface, so the human summary never hides what is actually
 * being signed. Labels are configurable per surface ("Details" under summary
 * cards, "Show full event" on the bare preview card).
 */
export function ExpandableEventJson({
  event,
  showLabel = SHOW_DETAILS_LABEL,
  hideLabel = HIDE_DETAILS_LABEL,
}: {
  event: UnsignedEvent;
  showLabel?: string;
  hideLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const fullJson = useMemo(() => JSON.stringify(event, null, 2), [event]);
  const displayJson = useMemo(
    () => boundDisplay(fullJson, FULL_EVENT_DISPLAY_MAX_CHARS),
    [fullJson]
  );

  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const copyJson = useCallback(() => {
    void Clipboard.setStringAsync(fullJson);
    popup({ message: 'Copied', type: 'success', variant: 'toast', duration: 1500 });
  }, [fullJson]);

  return (
    <VStack spacing={8}>
      <Pressable
        haptics
        accessibilityRole="button"
        accessibilityLabel={expanded ? hideLabel : showLabel}
        onPress={toggle}>
        <HStack spacing={4} style={CENTER_ROW_STYLE}>
          <Text size={13} bold color={muted}>
            {expanded ? hideLabel : showLabel}
          </Text>
          <Icon name={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} size={16} color={muted} />
        </HStack>
      </Pressable>
      {expanded ? (
        <View style={EXPANDED_BLOCK_STYLE}>
          <GestureScrollView
            nestedScrollEnabled
            style={JSON_SCROLL_STYLE}
            showsVerticalScrollIndicator>
            <Text size={12} color={foreground} style={JSON_TEXT_STYLE}>
              {displayJson}
            </Text>
          </GestureScrollView>
          <HerouiButton
            variant="ghost"
            size="sm"
            isIconOnly
            onPress={copyJson}
            accessibilityLabel="Copy full event">
            <Icon name="lets-icons:copy" size={18} color={muted} />
          </HerouiButton>
        </View>
      ) : null}
    </VStack>
  );
}
