/**
 * @fileoverview 'signer-approval' sheet body — the NIP-46 approval prompt
 *
 * Renders the head of the live pending queue and advances request-by-request
 * as verdicts land (SlideInRight, PopupHost's custom-page pattern). Verdicts
 * go straight to `nip46Engine.resolveRequest`; the engine removes the request
 * from the store, which is what advances the head here — no local queue copy.
 *
 * Tier → affordances (permissionCatalog is the single source):
 *   standard/protected/unknown → Allow Once / (Always Allow) / Deny
 *   wallet                     → SlideToConfirm + Deny, NEVER Always Allow
 * Decrypt requests never preview content — only "Encrypted payload · N
 * chars" — and peer≠self decrypts add the opt-in 1h session-grant checkbox.
 *
 * Display strings derived from request params are untrusted: previews are
 * length-bounded before render and never logged.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { BottomSheet, Button as HerouiButton } from 'heroui-native';
import { Result } from 'neverthrow';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Animated, { SlideInRight } from 'react-native-reanimated';

import Icon from 'assets/icons';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  useNip46RequestsStore,
  type Nip46PendingRequest,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import { nip46Engine, type Nip46DecisionAction } from '@/features/nostrSigner/lib/nip46Engine';
import type { UnsignedEvent } from '@/features/nostrSigner/lib/nip46Types';
import {
  allHandledToastCopy,
  alwaysAllowEligible,
  alwaysScopeFootnote,
  APPROVAL_BUTTON_LABELS,
  appDisplayName,
  boundDisplay,
  encryptedPayloadLabel,
  expiredNoticeCopy,
  HIDE_FULL_EVENT_LABEL,
  permissionEntryFor,
  queueStripLabel,
  SESSION_GRANT_CHECKBOX_LABEL,
  SHOW_FULL_EVENT_LABEL,
  SLIDE_TO_APPROVE_LABEL,
  tierBannerFor,
  VIEW_ALL_LABEL,
  type CopySegment,
} from '@/features/nostrSigner/components/permissionCatalog';
import { suppressSignerDeferToastOnce } from '@/features/nostrSigner/hooks/signerApprovalCoordination';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { nostrLog } from '@/shared/lib/logger';
import { popup, type ActionSheetPayloads } from '@/shared/lib/popup';
import type { CustomSheetSharedProps } from '@/shared/lib/popup/sheets/types';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { SlideToConfirm } from '@/shared/ui/composed/SlideToConfirm';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const CONTENT_PREVIEW_MAX_CHARS = 300;
const FULL_EVENT_DISPLAY_MAX_CHARS = 16_384;
const FULL_EVENT_MAX_HEIGHT = 240;
const EXPIRED_NOTICE_MS = 1500;
const ADVANCE_ANIMATION_MS = 220;
const MONOSPACE_FONT = Platform.select({ ios: 'Courier New', default: 'monospace' });

/** Stable fallback so memo deps don't churn while the sheet is closing. */
const NONE_PREVIEW = { type: 'none' } as const;

interface SignerApprovalContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['signer-approval'];
}

const safeHostname = Result.fromThrowable(
  (url: string) => new URL(url).hostname,
  () => 'invalid_url' as const
);

function shortPubkey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** Relay/url tag value for kind 22242/27235 login bodies. Bounded by catalog. */
function loginTargetFor(event: UnsignedEvent): string | undefined {
  for (const tag of event.tags) {
    if ((tag[0] === 'relay' || tag[0] === 'u') && typeof tag[1] === 'string' && tag[1].length > 0) {
      return tag[1];
    }
  }
  return undefined;
}

function SegmentedText({
  segments,
  size,
  color,
}: {
  segments: CopySegment[];
  size: number;
  color?: string;
}) {
  return (
    <Text size={size} {...(color !== undefined && { color })} style={{ lineHeight: size * 1.45 }}>
      {segments.map((segment, index) => (
        <Text key={index} size={size} bold={segment.bold} {...(color !== undefined && { color })}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

function EventPreviewCard({ event }: { event: UnsignedEvent }) {
  const [expanded, setExpanded] = useState(false);
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const contentPreview = useMemo(
    () => boundDisplay(event.content.trim(), CONTENT_PREVIEW_MAX_CHARS),
    [event.content]
  );
  const fullJson = useMemo(() => JSON.stringify(event, null, 2), [event]);
  const displayJson = useMemo(
    () => boundDisplay(fullJson, FULL_EVENT_DISPLAY_MAX_CHARS),
    [fullJson]
  );

  const copyJson = useCallback(() => {
    void Clipboard.setStringAsync(fullJson);
    popup({ message: 'Copied', type: 'success', variant: 'toast', duration: 1500 });
  }, [fullJson]);

  return (
    <View className="bg-surface rounded-2xl p-3" style={{ gap: 8 }}>
      {contentPreview.length > 0 ? (
        <Text size={14} numberOfLines={3} color={foreground}>
          {contentPreview}
        </Text>
      ) : null}
      <Pressable
        haptics
        accessibilityRole="button"
        accessibilityLabel={expanded ? HIDE_FULL_EVENT_LABEL : SHOW_FULL_EVENT_LABEL}
        onPress={() => setExpanded((value) => !value)}>
        <HStack spacing={4} style={{ alignItems: 'center' }}>
          <Text size={13} bold color={muted}>
            {expanded ? HIDE_FULL_EVENT_LABEL : SHOW_FULL_EVENT_LABEL}
          </Text>
          <Icon name={expanded ? 'mdi:chevron-up' : 'mdi:chevron-down'} size={16} color={muted} />
        </HStack>
      </Pressable>
      {expanded ? (
        <View style={{ gap: 6 }}>
          <GestureScrollView
            nestedScrollEnabled
            style={{ maxHeight: FULL_EVENT_MAX_HEIGHT }}
            showsVerticalScrollIndicator>
            <Text size={12} color={foreground} style={{ fontFamily: MONOSPACE_FONT }}>
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

  const head: Nip46PendingRequest | null = pending.length > 0 ? pending[0] : null;
  const connection = useNip46ConnectionsStore((s) =>
    head ? s.apps[head.clientPubkey] : undefined
  );

  const [expiredNotice, setExpiredNotice] = useState<string | null>(null);
  const [sessionGrantChecked, setSessionGrantChecked] = useState(false);
  const [advanceCount, setAdvanceCount] = useState(0);

  const resolvedIdsRef = useRef<Set<string>>(new Set());
  const tallyRef = useRef({ allowed: 0, denied: 0 });
  const hasAdvancedRef = useRef(false);
  const closingRef = useRef(false);
  const prevHeadRef = useRef<Nip46PendingRequest | null>(head);

  // Session-grant opt-in is per-request; never carry a tick across requests.
  const headId = head?.id ?? null;
  useEffect(() => {
    setSessionGrantChecked(false);
  }, [headId]);

  // Head departures: a head we resolved just advances; a head that vanished
  // without our verdict expired under us (engine sweep) — show the 1.5s
  // notice before revealing the next request.
  useEffect(() => {
    const prev = prevHeadRef.current;
    prevHeadRef.current = head;
    if (prev === null || (head !== null && head.id === prev.id)) return undefined;
    hasAdvancedRef.current = true;
    setAdvanceCount((count) => count + 1);
    if (resolvedIdsRef.current.has(prev.id)) return undefined;
    const expiredAppName = appDisplayName(
      useNip46ConnectionsStore.getState().apps[prev.clientPubkey]
    );
    setExpiredNotice(expiredNoticeCopy(expiredAppName));
    const timer = setTimeout(() => setExpiredNotice(null), EXPIRED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [head]);

  const finish = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const { allowed, denied } = tallyRef.current;
    if (allowed + denied > 0) {
      const summary = allHandledToastCopy(allowed, denied);
      popup({ message: summary.label, text: summary.description, type: 'success' });
    }
    close();
  }, [close]);

  // Batch done (handled or expired out) and no notice on screen → wrap up.
  useEffect(() => {
    if (head === null && expiredNotice === null) finish();
  }, [head, expiredNotice, finish]);

  const submitVerdict = useSingleFlight(
    useCallback(
      async (action: Nip46DecisionAction, sessionGrant: boolean) => {
        if (head === null) return;
        resolvedIdsRef.current.add(head.id);
        if (action === 'deny_once') {
          tallyRef.current.denied += 1;
        } else {
          tallyRef.current.allowed += 1;
        }
        const resolved = await nip46Engine.resolveRequest(head.id, {
          action,
          ...(sessionGrant && { sessionGrant: true }),
        });
        if (resolved.isErr()) {
          nostrLog.warn('nostr.signer.approval_resolve_failed', { error: resolved.error.type });
        }
      },
      [head]
    )
  );

  const viewAll = useCallback(() => {
    // Navigating to the queue is not a dismissal — skip the deferred-batch
    // toast (the controller still parks the batch so it won't auto-reopen).
    suppressSignerDeferToastOnce();
    close();
    router.push('/(signer-flow)/requests' as never);
  }, [close]);

  // ── Derived presentation ──────────────────────────────────────
  const preview = head?.paramsPreview ?? NONE_PREVIEW;
  const signEvent = preview.type === 'sign_event' ? preview.event : null;
  const entry = useMemo(() => {
    if (head === null) return null;
    return permissionEntryFor({
      method: head.method,
      ...(head.kind !== undefined && { kind: head.kind }),
      ...(signEvent !== null && { params: [JSON.stringify(signEvent)] }),
    });
  }, [head, signEvent]);

  const appName = appDisplayName(connection);
  const appDomain =
    connection?.url !== undefined ? safeHostname(connection.url).unwrapOr(null) : null;
  const bodyContext = useMemo(() => {
    if (head === null) return { appName };
    return {
      appName,
      ...(preview.type === 'encrypt' && { peerLabel: shortPubkey(preview.peerPubkey) }),
      ...(signEvent !== null &&
        (head.kind === 22242 || head.kind === 27235) && {
          relayLabel: loginTargetFor(signEvent),
        }),
    };
  }, [appName, head, preview, signEvent]);

  const tier = entry?.tier ?? 'standard';
  const banner = entry !== null ? tierBannerFor(tier, appName) : null;
  const lookupForAlways =
    head !== null
      ? { method: head.method, ...(head.kind !== undefined && { kind: head.kind }) }
      : null;
  const offerAlways =
    lookupForAlways !== null && tier !== 'wallet' && alwaysAllowEligible(lookupForAlways);

  const isPeerDecrypt =
    preview.type === 'decrypt' &&
    keys !== null &&
    preview.peerPubkey.toLowerCase() !== keys.pubkey.toLowerCase();

  const totalInBatch = advanceCount + pending.length;
  const position = Math.min(advanceCount + 1, totalInBatch);

  // ── Render ────────────────────────────────────────────────────

  if (expiredNotice !== null) {
    return (
      <View className="px-1 pb-4 pt-1">
        <HStack spacing={10} style={{ alignItems: 'center' }}>
          <Icon name="mdi:clock-alert-outline" size={22} color={warning} />
          <View style={{ flex: 1 }}>
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
      key={head.id}
      entering={hasAdvancedRef.current ? SlideInRight.duration(ADVANCE_ANIMATION_MS) : undefined}>
      <VStack spacing={14} className="px-1 pb-2 pt-1">
        {totalInBatch > 1 ? (
          <HStack style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Text size={12} bold color={muted}>
              {queueStripLabel(position, totalInBatch)}
            </Text>
            <Pressable
              haptics
              accessibilityRole="button"
              accessibilityLabel={VIEW_ALL_LABEL}
              onPress={viewAll}
              style={{ padding: 4 }}>
              <Text size={12} bold color={muted} style={{ textDecorationLine: 'underline' }}>
                {VIEW_ALL_LABEL}
              </Text>
            </Pressable>
          </HStack>
        ) : null}

        {/* App identity */}
        <HStack spacing={12} style={{ alignItems: 'center' }}>
          <Avatar
            state={connection?.image ? 'image' : 'fallback'}
            picture={connection?.image}
            seed={head.clientPubkey}
            fallbackVariant="beam"
            size={44}
            alt={appName}
          />
          <VStack spacing={2} style={{ flex: 1 }}>
            <Text size={16} bold color={foreground} numberOfLines={1}>
              {appName}
            </Text>
            <Text size={12} color={muted} numberOfLines={1}>
              {appDomain ?? shortPubkey(head.clientPubkey)}
            </Text>
          </VStack>
          <Icon name={entry.icon} size={22} color={muted} />
        </HStack>

        {/* Headline + body */}
        <VStack spacing={6}>
          <BottomSheet.Title className="text-foreground text-lg font-bold">
            {entry.headline}
          </BottomSheet.Title>
          <SegmentedText segments={entry.body(bodyContext)} size={14} color={foreground} />
        </VStack>

        {/* Preview card — decrypt NEVER previews content */}
        {preview.type === 'sign_event' ? <EventPreviewCard event={preview.event} /> : null}
        {preview.type === 'encrypt' ? (
          <View className="bg-surface rounded-2xl p-3">
            <Text size={14} numberOfLines={3} color={foreground}>
              {boundDisplay(preview.plaintext, CONTENT_PREVIEW_MAX_CHARS)}
            </Text>
          </View>
        ) : null}
        {preview.type === 'decrypt' ? (
          <View className="bg-surface rounded-2xl p-3">
            <HStack spacing={8} style={{ alignItems: 'center' }}>
              <Icon name="mdi:shield" size={16} color={muted} />
              <Text size={13} color={muted}>
                {encryptedPayloadLabel(preview.ciphertextLength)}
              </Text>
            </HStack>
          </View>
        ) : null}

        {/* Tier banner */}
        {banner !== null ? (
          <View
            className={
              banner.tone === 'danger'
                ? 'bg-danger-soft rounded-2xl p-3'
                : 'bg-warning-soft rounded-2xl p-3'
            }>
            <HStack spacing={8} style={{ alignItems: 'center' }}>
              <Icon
                name={banner.tone === 'danger' ? 'mdi:alert-circle' : 'mdi:alert-circle-outline'}
                size={18}
                color={banner.tone === 'danger' ? danger : warning}
              />
              <View style={{ flex: 1 }}>
                <SegmentedText
                  segments={banner.segments}
                  size={13}
                  color={banner.tone === 'danger' ? dangerSoftFg : warningSoftFg}
                />
              </View>
            </HStack>
          </View>
        ) : null}

        {/* 1h session grant — peer≠self decrypt only */}
        {isPeerDecrypt ? (
          <Pressable
            haptics
            accessibilityRole="checkbox"
            accessibilityState={{ checked: sessionGrantChecked }}
            accessibilityLabel={SESSION_GRANT_CHECKBOX_LABEL}
            onPress={() => setSessionGrantChecked((value) => !value)}>
            <HStack spacing={10} style={{ alignItems: 'center' }}>
              <SelectableCheck selected={sessionGrantChecked} />
              <View style={{ flex: 1 }}>
                <Text size={13} color={foreground}>
                  {SESSION_GRANT_CHECKBOX_LABEL}
                </Text>
              </View>
            </HStack>
          </Pressable>
        ) : null}

        {/* Always-scope footnote */}
        {offerAlways ? (
          <SegmentedText
            segments={alwaysScopeFootnote(appName, entry.alwaysVerbPhrase)}
            size={12}
            color={muted}
          />
        ) : null}

        {/* Actions */}
        {tier === 'wallet' ? (
          <VStack spacing={10} style={{ alignItems: 'center' }}>
            <SlideToConfirm
              onConfirm={() => void submitVerdict('approve_once', sessionGrantChecked)}
              iconName="mdi:check"
              label={SLIDE_TO_APPROVE_LABEL}
              trackColor={danger}
              thumbColor={foreground}
              textColor={foreground}
              iconColor={danger}
            />
            <HerouiButton variant="ghost" onPress={() => void submitVerdict('deny_once', false)}>
              <HerouiButton.Label className="text-danger underline">
                {APPROVAL_BUTTON_LABELS.deny}
              </HerouiButton.Label>
            </HerouiButton>
          </VStack>
        ) : (
          <VStack spacing={10}>
            <HerouiButton
              variant="primary"
              className="bg-foreground"
              onPress={() => void submitVerdict('approve_once', sessionGrantChecked)}>
              <HerouiButton.Label className="text-background">
                {APPROVAL_BUTTON_LABELS.allowOnce}
              </HerouiButton.Label>
            </HerouiButton>
            {offerAlways ? (
              <HerouiButton
                variant="tertiary"
                onPress={() => void submitVerdict('always', sessionGrantChecked)}>
                <HerouiButton.Label>{APPROVAL_BUTTON_LABELS.alwaysAllow}</HerouiButton.Label>
              </HerouiButton>
            ) : null}
            <HerouiButton variant="ghost" onPress={() => void submitVerdict('deny_once', false)}>
              <HerouiButton.Label className="text-danger underline">
                {APPROVAL_BUTTON_LABELS.deny}
              </HerouiButton.Label>
            </HerouiButton>
          </VStack>
        )}
      </VStack>
    </Animated.View>
  );
}
