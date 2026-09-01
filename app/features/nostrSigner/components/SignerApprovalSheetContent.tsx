/**
 * @fileoverview 'signer-approval' sheet body — the NIP-46 approval prompt
 *
 * Renders the head of the live pending queue and advances request-by-request
 * as verdicts land (SlideInRight, PopupHost's custom-page pattern). Verdicts
 * go straight to `nip46Engine.resolveRequest`; the engine removes the request
 * from the store, which is what advances the head here — no local queue copy.
 *
 * Affordances (permissionCatalog is the single copy source):
 *   standard/protected/unknown → Allow This Session / (Always Allow) / Deny
 *   wallet                     → Allow This Session / Deny (Always never —
 *                                session allows are runtime-only by design)
 *   peer≠self decrypt          → same buttons, PEER-scoped (session grant /
 *                                persistent per-person grant)
 *   self-decrypt               → Approve (once) / Deny — NIP-60 wallet
 *                                payloads keep maximum friction
 *   strict-mode app            → Approve (once) / Deny, mirroring the "Ask
 *                                Every Time" setting — evaluate() ignores
 *                                session/always/peer grants under strict,
 *                                so those affordances must not exist here
 * plus a "Block this app" link (confirmed) under every prompt. "Session" =
 * until the engine stops (profile switch / app restart). Decrypt requests
 * never preview content — only the conversation peer and an "Encrypted
 * payload · N chars" line.
 *
 * Display strings derived from request params are untrusted: previews are
 * length-bounded before render and never logged.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { BottomSheet, Button as HerouiButton } from 'heroui-native';
import Animated, { SlideInRight } from 'react-native-reanimated';

import Icon from 'assets/icons';
import { SegmentedText, shortPubkey } from '@/features/nostrSigner/components/display';
import { boundDisplay, safeHostname } from '@/features/nostrSigner/lib/boundedDisplay';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  useNip46RequestsStore,
  type Nip46PendingRequest,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import { connectionForClient } from '@/features/nostrSigner/lib/connectionMatch';
import {
  consolidatePending,
  groupDeparted,
  verdictIdsForGroup,
  type Nip46RequestGroup,
} from '@/features/nostrSigner/lib/requestGrouping';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import type { Nip46DecisionAction } from '@/features/nostrSigner/lib/verdictResolver';
import type { UnsignedEvent } from '@/features/nostrSigner/lib/nip46Types';
import {
  allHandledToastCopy,
  alwaysAllowEligible,
  APPROVAL_BUTTON_LABELS,
  appDisplayName,
  blockAppConfirmTitle,
  BLOCK_APP_LABEL,
  expiredNoticeCopy,
  HIDE_FULL_EVENT_LABEL,
  permissionEntryFor,
  queueStripLabel,
  SHOW_FULL_EVENT_LABEL,
  peerDecryptBanner,
  tierBannerFor,
  VIEW_ALL_LABEL,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  AppDataCard,
  DecryptPeerCard,
  FollowDiffCard,
  OwnTextBlock,
  ExpandableEventJson,
  ReferencedNoteCard,
  ZapRequestCard,
} from '@/features/nostrSigner/components/SummaryPreviewCards';
import {
  summarizeRequest,
  type RequestSummary,
  type SummaryRisk,
} from '@/features/nostrSigner/lib/requestSummary';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { suppressSignerDeferToastOnce } from '@/features/nostrSigner/hooks/signerApprovalCoordination';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { nostrLog } from '@/shared/lib/logger';
import { actionMenuPopup, popup, type ActionSheetPayloads } from '@/shared/lib/popup';
import type { CustomSheetSharedProps } from '@/shared/lib/popup/sheets/types';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const CONTENT_PREVIEW_MAX_CHARS = 300;
const EXPIRED_NOTICE_MS = 1500;
const ADVANCE_ANIMATION_MS = 220;

/** Stable fallback so memo deps don't churn while the sheet is closing. */
const NONE_PREVIEW = { type: 'none' } as const;

/** Summary detail variants that render a dedicated preview card. */
const SUMMARY_CARD_DETAIL_TYPES: ReadonlySet<string> = new Set([
  'react',
  'repost',
  'reply',
  'quote',
  'follow_diff',
  'app_data',
  'zap_request',
]);

/** Risk-flag banner copy (rendered in addition to the tier banner). */
const RISK_BANNERS: Partial<Record<SummaryRisk, { tone: 'danger' | 'warning'; text: string }>> = {
  never_sign_anomaly: {
    tone: 'danger',
    text: 'This event type should never be signed by your key. Deny unless you know exactly why.',
  },
  wallet_credential: {
    tone: 'danger',
    text: 'This data can include wallet connection secrets. Only approve if you set up a wallet in this app.',
  },
};

interface SignerApprovalContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['signer-approval'];
}

/** Relay/url tag value for kind 22242/27235 login bodies. Bounded by catalog. */
/**
 * Kind-3 diff baseline — only when the cached follow list belongs to the
 * signing identity (the store is active-profile-scoped; a kind 3 carrying a
 * foreign pubkey must fall back to the count-only presentation).
 */
function kind3CurrentFollows(
  head: { kind?: number } | null,
  signEvent: unknown,
  keys: { pubkey: string } | null,
  contactsUpdatedAt: number,
  followingPubkeys: Record<string, unknown>
): Set<string> | undefined {
  if (head?.kind !== 3 || contactsUpdatedAt <= 0 || keys === null) return undefined;
  const eventPubkey = (signEvent as { pubkey?: unknown } | null)?.pubkey;
  if (typeof eventPubkey === 'string' && eventPubkey.toLowerCase() !== keys.pubkey.toLowerCase())
    return undefined;
  return new Set(Object.keys(followingPubkeys));
}

function loginTargetFor(event: UnsignedEvent): string | undefined {
  for (const tag of event.tags) {
    if ((tag[0] === 'relay' || tag[0] === 'u') && typeof tag[1] === 'string' && tag[1].length > 0) {
      return tag[1];
    }
  }
  return undefined;
}

const PREVIEW_CARD_STYLE = { gap: 8 } as const;
const CENTER_ROW_STYLE = { alignItems: 'center' } as const;
const FLEX_ONE_STYLE = { flex: 1 } as const;
const QUEUE_STRIP_ROW_STYLE = { alignItems: 'center', justifyContent: 'space-between' } as const;
const VIEW_ALL_PRESSABLE_STYLE = { padding: 4 } as const;
const UNDERLINE_TEXT_STYLE = { textDecorationLine: 'underline' } as const;

/** Bounded content preview + the shared JSON inspector, in a card. */
function EventPreviewCard({ event }: { event: UnsignedEvent }) {
  const [foreground] = useThemeColor(['foreground'] as const);
  const contentPreview = boundDisplay(event.content.trim(), CONTENT_PREVIEW_MAX_CHARS);

  return (
    <View className="bg-surface rounded-2xl p-3" style={PREVIEW_CARD_STYLE}>
      {contentPreview.length > 0 ? (
        <Text size={14} numberOfLines={3} color={foreground}>
          {contentPreview}
        </Text>
      ) : null}
      <ExpandableEventJson
        event={event}
        showLabel={SHOW_FULL_EVENT_LABEL}
        hideLabel={HIDE_FULL_EVENT_LABEL}
      />
    </View>
  );
}

export function SignerApprovalSheetContent({
  close,
}: SignerApprovalContentProps): React.ReactElement {
  const pending = useNip46RequestsStore((s) => s.pending);
  const { keys } = useNostrKeysContext();
  const [foreground, muted, danger, warning, warningSoftFg, dangerSoftFg] = useThemeColor([
    'foreground',
    'muted',
    'danger',
    'warning',
    'warning-soft-foreground',
    'danger-soft-foreground',
  ] as const);

  // Consolidated view: one DECISION per group of identical spam requests.
  // KEPT as an explicit useMemo — identity contract, not an optimization.
  // `headGroup` is the sole dep of the group-departure effect below. The
  // compiler declines to cache this (the scope would span the useThemeColor
  // call), so a render-scoped identity re-fires that effect on every render,
  // and the re-fire clears the expired-notice timeout without re-arming it.
  // ast-grep-ignore: no-manual-memo-tsx
  const groups = useMemo(() => consolidatePending(pending), [pending]);
  const headGroup: Nip46RequestGroup | null = groups.length > 0 ? groups[0] : null;
  const head: Nip46PendingRequest | null = headGroup?.requests[0] ?? null;
  const headGroupKey = headGroup?.key ?? null;
  const connection = useNip46ConnectionsStore((s) =>
    head ? connectionForClient(s.apps, head.clientPubkey) : undefined
  );

  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);
  const [advanceCount, setAdvanceCount] = useState(0);

  const resolvedIdsRef = useRef<Set<string>>(new Set());
  const tallyRef = useRef({ allowed: 0, denied: 0 });
  const closingRef = useRef(false);
  const prevGroupRef = useRef<{ key: string; ids: string[]; clientPubkey: string } | null>(
    headGroup === null
      ? null
      : {
          key: headGroup.key,
          ids: headGroup.requests.map((request) => request.id),
          clientPubkey: headGroup.requests[0].clientPubkey,
        }
  );

  // Group departures: a group we resolved just advances; a group that
  // vanished with NONE of its ids resolved expired under us (engine sweep) —
  // show the 1.5s notice. A head request expiring while identical siblings
  // remain keeps the same group key: no advance, no flash.
  useEffect(() => {
    const prev = prevGroupRef.current;
    prevGroupRef.current =
      headGroup === null
        ? null
        : {
            key: headGroup.key,
            ids: headGroup.requests.map((request) => request.id),
            clientPubkey: headGroup.requests[0].clientPubkey,
          };
    if (prev === null || (headGroup !== null && headGroup.key === prev.key)) return undefined;
    setAdvanceCount((count) => count + 1);
    if (groupDeparted(prev.ids, resolvedIdsRef.current) === 'resolved') return undefined;
    const expiredAppName = appDisplayName(
      connectionForClient(useNip46ConnectionsStore.getState().apps, prev.clientPubkey)
    );
    setExpiredNotice(expiredNoticeCopy(expiredAppName));
    const timer = setTimeout(() => setExpiredNotice(null), EXPIRED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [headGroup]);

  // Batch done (handled or expired out) and no notice on screen → wrap up.
  // `finish` lives inside the effect: as a plain function it was rebuilt on
  // every render, so listing it as a dependency re-ran this effect on every
  // render of the approval sheet.
  useEffect(() => {
    if (head !== null || expiredNotice !== null) return;
    if (closingRef.current) return;
    closingRef.current = true;
    const { allowed, denied } = tallyRef.current;
    if (allowed + denied > 0) {
      const summary = allHandledToastCopy(allowed, denied);
      popup({ message: summary.label, text: summary.description, type: 'success' });
    }
    close();
  }, [head, expiredNotice, close]);

  const submitVerdict = useSingleFlight(async (action: Nip46DecisionAction) => {
    if (headGroup === null) return;
    // Snapshot ids + mark resolved + tally BEFORE the first await, so the
    // departure effect (which fires as the store updates mid-loop) reads
    // a fully-resolved group and never flashes the expired notice.
    const ids = verdictIdsForGroup(action, headGroup);
    if (action === 'block') {
      // The engine flushes EVERY pending request from this app — mark
      // them all resolved so no sibling group flashes "expired".
      const appPubkey = headGroup.requests[0]!.clientPubkey;
      const flushed = useNip46RequestsStore
        .getState()
        .pending.filter((request) => request.clientPubkey === appPubkey);
      for (const request of flushed) resolvedIdsRef.current.add(request.id);
      tallyRef.current.denied += flushed.length;
    } else {
      for (const request of headGroup.requests) resolvedIdsRef.current.add(request.id);
      if (action === 'deny_once') {
        tallyRef.current.denied += headGroup.requests.length;
      } else {
        tallyRef.current.allowed += headGroup.requests.length;
      }
    }
    for (const id of ids) {
      const resolved = await nip46Engine.resolveRequest(id, { action });
      if (resolved.isErr()) {
        if (resolved.error.type === 'unknown-request') {
          // A member expired (sweep) or was flushed (block) mid-loop.
          nostrLog.debug('nostr.signer.approval_resolve_raced');
        } else {
          nostrLog.warn('nostr.signer.approval_resolve_failed', {
            error: resolved.error.type,
          });
        }
      }
    }
  });

  const viewAll = () => {
    // Navigating to the queue is not a dismissal — skip the deferred-batch
    // toast (the controller still parks the batch so it won't auto-reopen).
    suppressSignerDeferToastOnce();
    close();
    router.push('/(signer-flow)/requests' as never);
  };

  // ── Derived presentation ──────────────────────────────────────
  const preview = head?.paramsPreview ?? NONE_PREVIEW;
  const signEvent = preview.type === 'sign_event' ? preview.event : null;
  const entry =
    head === null
      ? null
      : permissionEntryFor({
          method: head.method,
          ...(head.kind !== undefined && { kind: head.kind }),
          ...(signEvent !== null && { params: [JSON.stringify(signEvent)] }),
        });

  const followingPubkeys = useNostrSocialStore((s) => s.followingPubkeys);
  const contactsUpdatedAt = useNostrSocialStore((s) => s.contactsUpdatedAt);
  const currentFollows = kind3CurrentFollows(
    head,
    signEvent,
    keys,
    contactsUpdatedAt,
    followingPubkeys
  );

  const summary: RequestSummary | null =
    head === null
      ? null
      : summarizeRequest(
          {
            method: head.method,
            ...(head.kind !== undefined && { kind: head.kind }),
            preview,
          },
          {
            ...(currentFollows !== undefined && { currentFollows }),
            ...(keys !== null && { selfPubkey: keys.pubkey }),
          }
        );

  const detail = summary?.detail;
  // Detail variants with a dedicated card; everything else keeps the classic
  // content-preview card (which embeds its own expandable JSON).
  const usesSummaryCard = detail !== undefined && SUMMARY_CARD_DETAIL_TYPES.has(detail.type);

  const appName = appDisplayName(connection);
  const appDomain =
    connection?.url !== undefined ? safeHostname(connection.url).unwrapOr(null) : null;

  // Decrypt/encrypt peer label: resolved display name, shortPubkey fallback.
  const peerPubkey =
    preview.type === 'decrypt' || preview.type === 'encrypt' ? preview.peerPubkey : undefined;
  const { metadata: peerMetadata } = useNostrProfileMetadata(peerPubkey);
  const peerLabel =
    peerPubkey !== undefined
      ? peerMetadata?.displayName?.trim() || peerMetadata?.name?.trim() || shortPubkey(peerPubkey)
      : undefined;

  const bodyContext =
    head === null
      ? { appName }
      : {
          appName,
          ...(peerLabel !== undefined && { peerLabel: boundDisplay(peerLabel, 48) }),
          ...(signEvent !== null &&
            (head.kind === 22242 || head.kind === 27235) && {
              relayLabel: loginTargetFor(signEvent),
            }),
        };

  const isPeerDecrypt =
    preview.type === 'decrypt' &&
    keys !== null &&
    preview.peerPubkey.toLowerCase() !== keys.pubkey.toLowerCase();
  const isSelfDecrypt = preview.type === 'decrypt' && !isPeerDecrypt;

  const tier = entry?.tier ?? 'standard';
  // Peer decrypts get accurate conversation-privacy copy — the wallet-tier
  // banner ("touches your wallet") is for self-decrypts (NIP-60 payloads).
  const banner =
    entry === null
      ? null
      : isPeerDecrypt
        ? peerDecryptBanner(appName)
        : tierBannerFor(tier, appName);
  const lookupForAlways =
    head !== null
      ? { method: head.method, ...(head.kind !== undefined && { kind: head.kind }) }
      : null;
  // "Ask Every Time" mode: evaluate() prompts everything before grant checks,
  // so persistent/session affordances would mint grants that can't apply —
  // the sheet must mirror what the settings say is possible.
  const strictMode = connection?.mode === 'strict';
  // Peer decrypts offer a PEER-scoped Always (setPeerDecryptGrant); blanket
  // wallet/critical keys and self-decrypt never offer Always
  // (alwaysAllowEligible covers the wallet tier).
  const offerAlways =
    !strictMode &&
    (isPeerDecrypt
      ? peerLabel !== undefined
      : lookupForAlways !== null && alwaysAllowEligible(lookupForAlways));

  const confirmBlock = () => {
    actionMenuPopup({
      title: blockAppConfirmTitle(appName),
      buttons: [
        {
          text: 'Block',
          variant: 'dangerous',
          onPress: (menuClose) => {
            menuClose();
            void submitVerdict('block');
          },
        },
        { text: 'Cancel', variant: 'secondary', onPress: (menuClose) => menuClose() },
      ],
    });
  };

  // Strict mode approves once, like self-decrypt — a session grant would be
  // inert under strict and the label would overpromise.
  const approveOnceOnly = isSelfDecrypt || strictMode;
  const approvePrimary = () => {
    void submitVerdict(approveOnceOnly ? 'approve_once' : 'approve_session');
  };
  const approveAlways = () => {
    void submitVerdict('always');
  };
  const denyOnce = () => {
    void submitVerdict('deny_once');
  };

  // Counts DECISIONS (consolidated groups), not raw spam requests.
  const totalInBatch = advanceCount + groups.length;
  const position = Math.min(advanceCount + 1, totalInBatch);

  // ── Render ────────────────────────────────────────────────────

  if (expiredNotice !== null) {
    return (
      <View className="px-1 pb-4 pt-1">
        <HStack gap={10} style={CENTER_ROW_STYLE}>
          <Icon name="mdi:clock-alert-outline" size={22} color={warning} />
          <View style={FLEX_ONE_STYLE}>
            <Text size={14} color={foreground}>
              {expiredNotice}
            </Text>
          </View>
        </HStack>
      </View>
    );
  }

  if (head === null || entry === null) {
    // Transient frame while `finish()` closes the sheet.
    return <View className="pb-2" />;
  }

  return (
    <Animated.View
      key={headGroupKey ?? head.id}
      // `advanceCount` already counts exactly the advances the ref tracked, and
      // it is state — so the slide-in is render input rather than a ref read.
      entering={advanceCount > 0 ? SlideInRight.duration(ADVANCE_ANIMATION_MS) : undefined}>
      <VStack gap={14} className="px-1 pb-2 pt-1">
        {totalInBatch > 1 ? (
          <HStack style={QUEUE_STRIP_ROW_STYLE}>
            <Text size={12} bold color={muted}>
              {queueStripLabel(position, totalInBatch)}
            </Text>
            <Pressable
              haptics
              accessibilityRole="button"
              accessibilityLabel={VIEW_ALL_LABEL}
              onPress={viewAll}
              style={VIEW_ALL_PRESSABLE_STYLE}>
              <Text size={12} bold color={muted} style={UNDERLINE_TEXT_STYLE}>
                {VIEW_ALL_LABEL}
              </Text>
            </Pressable>
          </HStack>
        ) : null}

        {/* App identity */}
        <HStack gap={12} style={CENTER_ROW_STYLE}>
          <Avatar
            state={connection?.image ? 'image' : 'fallback'}
            picture={connection?.image}
            seed={head.clientPubkey}
            size={44}
            alt={appName}
          />
          <VStack gap={2} style={FLEX_ONE_STYLE}>
            <Text size={16} bold color={foreground} numberOfLines={1}>
              {appName}
            </Text>
            <Text size={12} color={muted} numberOfLines={1}>
              {appDomain ?? shortPubkey(head.clientPubkey)}
            </Text>
          </VStack>
        </HStack>

        {/* Headline + body — summary overrides; catalog is the total fallback */}
        <VStack gap={6}>
          <BottomSheet.Title className="text-foreground text-lg font-bold">
            {summary?.headline ?? entry.headline}
          </BottomSheet.Title>
          <SegmentedText
            segments={(summary?.body ?? entry.body)(bodyContext)}
            size={14}
            color={foreground}
          />
        </VStack>

        {/* Preview card per summary detail — decrypt NEVER previews content.
            sign_event details keep the raw JSON reachable via Details. */}
        {detail?.type === 'react' ? <ReferencedNoteCard eventId={detail.targetEventId} /> : null}
        {detail?.type === 'repost' ? (
          <ReferencedNoteCard eventId={detail.targetEventId} embedded={detail.embedded} />
        ) : null}
        {detail?.type === 'reply' ? (
          <>
            <ReferencedNoteCard eventId={detail.parentEventId} />
            <OwnTextBlock label="Your reply" text={detail.text} />
          </>
        ) : null}
        {detail?.type === 'quote' ? (
          <>
            <ReferencedNoteCard eventId={detail.quotedEventId} />
            <OwnTextBlock label="Your post" text={detail.text} />
          </>
        ) : null}
        {detail?.type === 'follow_diff' ? <FollowDiffCard detail={detail} /> : null}
        {detail?.type === 'app_data' ? <AppDataCard operationLine={detail.operationLine} /> : null}
        {detail?.type === 'zap_request' ? (
          <ZapRequestCard amountSats={detail.amountSats} recipientPubkey={detail.recipientPubkey} />
        ) : null}
        {signEvent !== null && usesSummaryCard ? <ExpandableEventJson event={signEvent} /> : null}
        {signEvent !== null && !usesSummaryCard ? <EventPreviewCard event={signEvent} /> : null}
        {preview.type === 'encrypt' ? (
          <View className="bg-surface rounded-2xl p-3">
            <Text size={14} numberOfLines={3} color={foreground}>
              {boundDisplay(preview.plaintext, CONTENT_PREVIEW_MAX_CHARS)}
            </Text>
          </View>
        ) : null}
        {preview.type === 'decrypt' ? (
          <DecryptPeerCard
            peerPubkey={preview.peerPubkey}
            ciphertextLength={preview.ciphertextLength}
          />
        ) : null}

        {/* Tier banner */}
        {banner !== null ? (
          <View
            className={
              banner.tone === 'danger'
                ? 'bg-danger-soft rounded-2xl p-3'
                : 'bg-warning-soft rounded-2xl p-3'
            }>
            <HStack gap={8} style={CENTER_ROW_STYLE}>
              <Icon
                name={banner.tone === 'danger' ? 'mdi:alert-circle' : 'mdi:alert-circle-outline'}
                size={18}
                color={banner.tone === 'danger' ? danger : warning}
              />
              <View style={FLEX_ONE_STYLE}>
                <SegmentedText
                  segments={banner.segments}
                  size={13}
                  color={banner.tone === 'danger' ? dangerSoftFg : warningSoftFg}
                />
              </View>
            </HStack>
          </View>
        ) : null}

        {/* Risk-flag banners (summary-derived, on top of the tier banner) */}
        {(summary?.riskFlags ?? []).map((flag) => {
          const riskBanner = RISK_BANNERS[flag];
          if (riskBanner === undefined) return null;
          return (
            <View
              key={flag}
              className={
                riskBanner.tone === 'danger'
                  ? 'bg-danger-soft rounded-2xl p-3'
                  : 'bg-warning-soft rounded-2xl p-3'
              }>
              <HStack gap={8} style={CENTER_ROW_STYLE}>
                <Icon
                  name="mdi:alert-circle"
                  size={18}
                  color={riskBanner.tone === 'danger' ? danger : warning}
                />
                <View style={FLEX_ONE_STYLE}>
                  <Text
                    size={13}
                    color={riskBanner.tone === 'danger' ? dangerSoftFg : warningSoftFg}>
                    {riskBanner.text}
                  </Text>
                </View>
              </HStack>
            </View>
          );
        })}

        {/* Actions: Session / (Always) / Deny / Block — one button stack with
            escalating severity. Self-decrypt keeps maximum friction:
            Approve (once) / Deny / Block only. */}
        <VStack gap={10}>
          <HerouiButton variant="primary" className="bg-foreground" onPress={approvePrimary}>
            <HerouiButton.Label className="text-background">
              {approveOnceOnly
                ? APPROVAL_BUTTON_LABELS.approveOnce
                : APPROVAL_BUTTON_LABELS.allowSession}
            </HerouiButton.Label>
          </HerouiButton>
          {offerAlways ? (
            <HerouiButton variant="tertiary" onPress={approveAlways}>
              <HerouiButton.Label>{APPROVAL_BUTTON_LABELS.alwaysAllow}</HerouiButton.Label>
            </HerouiButton>
          ) : null}
          <HerouiButton variant="danger-soft" onPress={denyOnce}>
            <HerouiButton.Label>{APPROVAL_BUTTON_LABELS.deny}</HerouiButton.Label>
          </HerouiButton>
          <HerouiButton
            variant="danger"
            accessibilityLabel={BLOCK_APP_LABEL}
            onPress={confirmBlock}>
            <HerouiButton.Label>{BLOCK_APP_LABEL}</HerouiButton.Label>
          </HerouiButton>
        </VStack>
      </VStack>
    </Animated.View>
  );
}
