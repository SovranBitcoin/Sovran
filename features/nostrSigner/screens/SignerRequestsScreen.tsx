/**
 * @fileoverview Outstanding signing requests — queue grouped by app
 *
 * One `Section` per requesting app, in queue order. Each group gets batch
 * chips: "Allow All (N)" (disabled whenever the group contains anything above
 * the standard tier — sensitive requests are reviewed one at a time; an
 * enabled tap confirms via actionMenuPopup, then loops `approve_once`) and
 * "Deny All" (no confirm — denial is safe). Eligibility is re-derived from
 * live store state at execution so a wallet-tier request that lands between
 * confirm and run can never ride a batch approval.
 *
 * Rows read all presentation from the permission catalog (icon, headline,
 * tier) and show a live TTL countdown driven by a 1s ticker that only runs
 * while the screen is focused; the trailing label turns warning-colored under
 * 30s and the row animates out at zero (the engine's sweep responds + logs
 * `expired` within its own 10s cadence — UI removal is presentation-only).
 * Tapping a row promotes it to the queue head and opens the approval sheet,
 * which always renders the head — no second queue representation.
 *
 * Subtitles derive from request params (untrusted): sign/encrypt previews are
 * length-bounded, decrypt rows show only "Encrypted payload · N chars", and
 * none of it is ever logged.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Button as HerouiButton } from 'heroui-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import {
  appDisplayName,
  encryptedPayloadLabel,
  permissionEntryFor,
  permissionTierFor,
  type PermissionLookup,
  type PermissionTier,
} from '@/features/nostrSigner/components/permissionCatalog';
import { boundDisplay } from '@/features/nostrSigner/lib/boundedDisplay';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import {
  useNip46RequestsStore,
  type Nip46PendingRequest,
} from '@/features/nostrSigner/data/nip46RequestsStore';
import { connectionForClient } from '@/features/nostrSigner/lib/connectionMatch';
import { consolidatePending } from '@/features/nostrSigner/lib/requestGrouping';
import { nip46Engine } from '@/features/nostrSigner/lib/nip46Engine';
import { summarizeRequest } from '@/features/nostrSigner/lib/requestSummary';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { nostrLog, useLifecycleLogger } from '@/shared/lib/logger';
import { actionMenuPopup, showActionSheet } from '@/shared/lib/popup';
import { EmptyState } from '@/shared/ui/composed/EmptyState';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';

// ── Copy (plan verbatim; templates interpolated) ────────────────

const EMPTY_TITLE = 'All caught up';
const EMPTY_SUBTITLE =
  'New signing requests appear here, and as a prompt wherever you are in Sovran.';

const SENSITIVE_BATCH_CAPTION = 'Sensitive requests must be reviewed one at a time.';
const DENY_ALL_LABEL = 'Deny All';
const BATCH_CONFIRM_BODY = 'They will be signed immediately.';
const BATCH_CANCEL_LABEL = 'Cancel';

function allowAllLabel(count: number): string {
  return `Allow All (${count})`;
}

function batchConfirmTitle(count: number, appName: string): string {
  return `Allow ${count} request${count === 1 ? '' : 's'} from ${appName}?`;
}

// ── Constants ───────────────────────────────────────────────────

const TICK_MS = 1000;
const COUNTDOWN_WARNING_MS = 30_000;
const ROW_EXIT_MS = 250;
const SUBTITLE_PREVIEW_MAX_CHARS = 120;

// ── Pure helpers ────────────────────────────────────────────────

/** Catalog lookup; sign_event params ride along so kind-5 tiers by scope. */
function lookupFor(request: Nip46PendingRequest): PermissionLookup {
  return {
    method: request.method,
    ...(request.kind !== undefined && { kind: request.kind }),
    ...(request.paramsPreview.type === 'sign_event' && {
      params: [JSON.stringify(request.paramsPreview.event)],
    }),
  };
}

/** Bounded one-line preview; decrypt NEVER previews content. */
function previewSubtitleFor(request: Nip46PendingRequest): string | undefined {
  // Human-readable summary line first ("Liked a post", "Load its app
  // settings from your account"); raw-ish previews where no summary exists.
  const summary = summarizeRequest({
    method: request.method,
    ...(request.kind !== undefined && { kind: request.kind }),
    preview: request.paramsPreview,
  });
  if (summary.activityLine.length > 0) {
    return boundDisplay(summary.activityLine, SUBTITLE_PREVIEW_MAX_CHARS);
  }
  const preview = request.paramsPreview;
  switch (preview.type) {
    case 'sign_event': {
      const content = preview.event.content.trim();
      return content.length > 0 ? boundDisplay(content, SUBTITLE_PREVIEW_MAX_CHARS) : undefined;
    }
    case 'encrypt':
      return boundDisplay(preview.plaintext, SUBTITLE_PREVIEW_MAX_CHARS);
    case 'decrypt':
      return encryptedPayloadLabel(preview.ciphertextLength);
    case 'none':
      return undefined;
  }
}

/** Mirrors the existing expiry-countdown convention ("14m 32s" / "45s"). */
function countdownLabel(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

interface RequestGroup {
  clientPubkey: string;
  requests: Nip46PendingRequest[];
}

/** Group by app, preserving queue order of first appearance and within group. */
function groupByApp(requests: readonly Nip46PendingRequest[]): RequestGroup[] {
  const byApp = new Map<string, Nip46PendingRequest[]>();
  for (const request of requests) {
    const list = byApp.get(request.clientPubkey);
    if (list === undefined) {
      byApp.set(request.clientPubkey, [request]);
    } else {
      list.push(request);
    }
  }
  return [...byApp.entries()].map(([clientPubkey, grouped]) => ({
    clientPubkey,
    requests: grouped,
  }));
}

function tierIconColor(
  tier: PermissionTier,
  colors: { foreground: string; warning: string; danger: string }
): string {
  switch (tier) {
    case 'standard':
      return colors.foreground;
    case 'protected':
    case 'unknown':
      return colors.warning;
    case 'wallet':
      return colors.danger;
  }
}

// ── Screen ──────────────────────────────────────────────────────

export function SignerRequestsScreen(): React.ReactElement {
  useLifecycleLogger('SignerRequestsScreen');
  const pending = useNip46RequestsStore((s) => s.pending);
  const apps = useNip46ConnectionsStore((s) => s.apps);
  const [foreground, muted, warning, danger] = useThemeColor([
    'foreground',
    'muted',
    'warning',
    'danger',
  ] as const);

  // 1s ticker, focused-only: drives the countdowns and the local "hide at
  // expiry" filter (the engine sweep deletes for real within 10s).
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(
    useCallback(() => {
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), TICK_MS);
      return () => clearInterval(timer);
    }, [])
  );

  const groups = useMemo(
    () => groupByApp(pending.filter((request) => request.expiresAt > now)),
    [pending, now]
  );

  // ── Verdict plumbing ──────────────────────────────────────────

  const reviewRequest = useCallback((id: string) => {
    useNip46RequestsStore.getState().promote(id);
    showActionSheet('signer-approval', {});
  }, []);

  const resolveBatch = useSingleFlight(
    useCallback(async (clientPubkey: string, action: 'approve_once' | 'deny_once') => {
      // Re-derive from live state: requests may have resolved/expired since
      // the chip was tapped, and approvals stay fail-closed to the standard
      // tier even if a sensitive request slipped in after the confirm.
      const live = useNip46RequestsStore
        .getState()
        .pending.filter((request) => request.clientPubkey === clientPubkey);
      const eligible =
        action === 'approve_once'
          ? live.filter((request) => permissionTierFor(lookupFor(request)) === 'standard')
          : live;
      for (const request of eligible) {
        const resolved = await nip46Engine.resolveRequest(request.id, { action });
        if (resolved.isErr()) {
          nostrLog.warn('nostr.signer.requests_batch_resolve_failed', {
            error: resolved.error.type,
          });
        }
      }
    }, [])
  );

  const confirmAllowAll = useCallback(
    (clientPubkey: string, appName: string, count: number) => {
      actionMenuPopup({
        title: batchConfirmTitle(count, appName),
        header: (
          <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            <Text size={14} color={muted}>
              {BATCH_CONFIRM_BODY}
            </Text>
          </View>
        ),
        buttons: [
          {
            text: allowAllLabel(count),
            onPress: (close) => {
              close();
              void resolveBatch(clientPubkey, 'approve_once');
            },
          },
          { text: BATCH_CANCEL_LABEL, variant: 'secondary' },
        ],
      });
    },
    [muted, resolveBatch]
  );

  // ── Render ────────────────────────────────────────────────────

  if (groups.length === 0) {
    return (
      <Screen name="SignerRequestsScreen">
        <EmptyState icon="mdi:check-circle-outline" title={EMPTY_TITLE} subtitle={EMPTY_SUBTITLE} />
      </Screen>
    );
  }

  return (
    <Screen name="SignerRequestsScreen">
      {groups.map((group) => {
        const appName = appDisplayName(connectionForClient(apps, group.clientPubkey));
        const count = group.requests.length;
        const allowAllEnabled = group.requests.every(
          (request) => permissionTierFor(lookupFor(request)) === 'standard'
        );

        return (
          <Animated.View
            key={group.clientPubkey}
            exiting={FadeOut.duration(ROW_EXIT_MS)}
            layout={LinearTransition.duration(ROW_EXIT_MS)}>
            <Section title={appName}>
              <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
                <HStack gap={8}>
                  <View style={{ flex: 1 }}>
                    <HerouiButton
                      variant="secondary"
                      size="sm"
                      isDisabled={!allowAllEnabled}
                      onPress={() => confirmAllowAll(group.clientPubkey, appName, count)}
                      accessibilityLabel={allowAllLabel(count)}>
                      <HerouiButton.Label>{allowAllLabel(count)}</HerouiButton.Label>
                    </HerouiButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <HerouiButton
                      variant="secondary"
                      size="sm"
                      onPress={() => void resolveBatch(group.clientPubkey, 'deny_once')}
                      accessibilityLabel={DENY_ALL_LABEL}>
                      <HerouiButton.Label>{DENY_ALL_LABEL}</HerouiButton.Label>
                    </HerouiButton>
                  </View>
                </HStack>
                {!allowAllEnabled ? (
                  <Text size={12} color={muted} style={{ marginTop: 6 }}>
                    {SENSITIVE_BATCH_CAPTION}
                  </Text>
                ) : null}
              </View>

              {consolidatePending(group.requests).map((rowGroup) => {
                const request = rowGroup.requests[0]!;
                const entry = permissionEntryFor(lookupFor(request));
                // Earliest member drives the countdown; the label can jump UP
                // when that member expires out (pre-filtered above) — fine.
                const remainingMs =
                  Math.min(...rowGroup.requests.map((member) => member.expiresAt)) - now;
                const urgent = remainingMs < COUNTDOWN_WARNING_MS;
                return (
                  <Animated.View
                    key={rowGroup.key}
                    exiting={FadeOut.duration(ROW_EXIT_MS)}
                    layout={LinearTransition.duration(ROW_EXIT_MS)}>
                    <ListRow
                      iconCircle={{
                        icon: entry.icon,
                        color: tierIconColor(entry.tier, { foreground, warning, danger }),
                      }}
                      title={entry.headline}
                      subtitle={previewSubtitleFor(request)}
                      wrapSubtitle
                      trailing={
                        <Text size={13} bold color={urgent ? warning : muted}>
                          {countdownLabel(remainingMs)}
                        </Text>
                      }
                      onPress={() => reviewRequest(request.id)}
                      accessibilityHint="Opens the approval prompt for this request"
                    />
                  </Animated.View>
                );
              })}
            </Section>
          </Animated.View>
        );
      })}
    </Screen>
  );
}
