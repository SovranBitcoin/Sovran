/**
 * @fileoverview Signer app detail — per-app permission editor
 *
 * Identity card → stats → strict-mode switch → grouped Permissions editor
 * (tri-state Ask / Allow / Block per action row) → Rename App → View
 * Activity (filtered) → Danger Zone (Disconnect App).
 *
 * Permission rows = union of the catalog's editor rows (one canonical grant
 * key per editor label) and the app's existing grant keys; presentation for
 * every row comes from `permissionEntryForGrantKey`. The Allow chip is gated
 * by `alwaysAllowEligible` — wallet-tier rows and critical grant keys (e.g.
 * deletions) can never select it, and the store would reject the write
 * anyway (defense in depth).
 *
 * App names/domains are untrusted display strings: bounded via
 * `appDisplayName`/hostname parsing and never logged.
 *
 * Route params: `clientPubkey` — the connected app's pubkey (64-hex).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import Icon from 'assets/icons';
import { shortPubkey } from '@/features/nostrSigner/components/display';
import { safeHostname } from '@/features/nostrSigner/lib/boundedDisplay';
import {
  alwaysAllowEligible,
  appDisplayName,
  permissionEntryForGrantKey,
  type PermissionEditorGroup,
} from '@/features/nostrSigner/components/permissionCatalog';
import { PermissionGestureDemo } from '@/features/nostrSigner/components/PermissionGestureDemo';
import {
  PermissionSwitchRow,
  triStateFor,
  type TriState,
} from '@/features/nostrSigner/components/PermissionKeyRows';
import {
  bundleSessionStatus,
  sessionStatusFor,
} from '@/features/nostrSigner/components/permissionRowModel';
import {
  bundleTriState,
  PERMISSION_BUNDLES,
  type PermissionBundle,
} from '@/features/nostrSigner/lib/permissionBundles';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { PAIRING_PRESET_GRANT_KEYS } from '@/features/nostrSigner/lib/pairingPreset';
import { parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';
import { useNostrPersonDisplay } from '@/shared/hooks/useNostrPersonDisplay';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { nostrLog } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { actionMenuPopup, popup } from '@/shared/lib/popup';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { ListRow } from '@/shared/ui/composed/ListRow';
import { Screen, useScreenOptions } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const IDENTITY_AVATAR_SIZE = 64;

// ── Scroll-linked header handoff ────────────────────────────────
// One FLIP POINT, not overlapping scroll bands: crossing it retargets a
// single timed progress value (content fades fully out over the first half,
// the header twin fades in over the second half — never both visible, and
// parking the scroll anywhere settles on exactly one). withTiming retargets
// from the current value on interruption, so spamming across the threshold
// just reverses mid-fade; the two thresholds add hysteresis so resting right
// on the boundary can't jitter.
// The content avatar sits at y 16 (pt-4) with height 64, so its bottom slides
// under the header bar at offset 80 — flip just before that, when the picture
// is almost gone, and flip back once most of it has re-emerged.
const FLIP_SHOW_HEADER_Y = 76; // scrolling down past this → header identity
const FLIP_SHOW_CONTENT_Y = 56; // scrolling back above this → content identity
const FLIP_FADE_MS = 200;
const CONTENT_FADE_PHASE = [0, 0.5];
const HEADER_FADE_PHASE = [0.5, 1];
const SCROLL_H_PADDING = { paddingHorizontal: 16 } as const;
const CONTENT_IDENTITY_STYLE = { alignItems: 'center' } as const;
const HEADER_IDENTITY_ROW_STYLE = { flexDirection: 'row', alignItems: 'center', gap: 8 } as const;
const HEADER_NAME_STYLE = { maxWidth: 190 } as const;

const CENTER_ROW_STYLE = { alignItems: 'center' } as const;
const FLEX_ONE_STYLE = { flex: 1 } as const;
const PEER_ROW_STYLE = { flex: 1, alignItems: 'center' } as const;
const CONFIRM_BODY_TEXT_STYLE = { lineHeight: 20 } as const;
const FINE_GRAINED_ROW_STYLE = { alignItems: 'center', alignSelf: 'flex-end' } as const;
// The adjacent permission rows (ListGroup.Item, p-4) inset 16 — match them
// so the groups align on this screen.
const MANAGE_ROW_INSET = 16;

const THROTTLED_BANNER = 'This app is sending unusual amounts of requests';
// Second banner line: the cooldown is the reason no approval prompts appear,
// so say so and show when asking resumes.
const THROTTLE_TICK_MS = 15_000;

/** "in about 4 minutes" / "in under a minute" — cooldowns are minute-scale. */
function throttleResumeLabel(msLeft: number): string {
  const minutes = Math.ceil(msLeft / 60_000);
  return minutes <= 1 ? 'in under a minute' : `in about ${minutes} minutes`;
}
const WALLET_GROUP_CAPTION = 'Wallet events always require your approval.';
const LOCKED_GROUP_CAPTION =
  'Some of these always require your approval and can never be set to Allow.';
const STRICT_MODE_TITLE = 'Ask Every Time';
const STRICT_MODE_DESCRIPTION = 'Ignore saved permissions and ask for every request.';
// Long-press menu (mirrors the permission rows' gesture) — only two modes.
const STANDARD_MODE_MENU_LABEL = 'Use Saved Permissions';
const STANDARD_MODE_MENU_DESCRIPTION = 'Apply your saved Allow, Ask, and Block choices';
const STRICT_ROW_HINT = 'Double tap to toggle. Long press for more options.';
const FINE_GRAINED_LABEL = 'Advanced';
const RENAME_APP_SUBTITLE = 'Change the name shown for this app';
const VIEW_ACTIVITY_SUBTITLE = 'See every request this app has made';
const RESTORE_DEFAULTS_LABEL = 'Restore Defaults';
const RESTORE_DEFAULTS_SUBTITLE = 'Allow common social actions again — everything else asks';
const DISCONNECT_SUBTITLE = 'Sign this app out and revoke its permissions';
const RESTORE_DEFAULTS_BODY =
  'Common social actions are allowed again — the same defaults as when you first connect. Everything else asks. Decrypt access for people is not affected.';
const EVERYONE_TITLE = 'Everyone';
const EVERYONE_DESCRIPTION = 'Decrypt with all people below, without asking';
const SESSION_ACCESS_LABEL = 'This session';
const DECRYPT_ACCESS_CAPTION =
  'People this app may decrypt your conversations with, without asking. Revoking prompts again on the next message.';

// Risk-based grouping: what the app can do TO you, not protocol taxonomy.
const GROUP_ORDER: readonly { group: PermissionEditorGroup; label: string }[] = [
  { group: 'public', label: 'Public Posting' },
  { group: 'account', label: 'Account & Profile' },
  { group: 'signin', label: 'Sign-ins' },
  { group: 'private', label: 'Private Data' },
  { group: 'wallet', label: 'Wallet' },
];

/**
 * Locked concepts stay individual rows (never bundled): deletions, decrypt,
 * and wallet events keep per-key precision and their Allow gating.
 */
const LOCKED_KEYS_BY_GROUP: Partial<Record<PermissionEditorGroup, readonly GrantKey[]>> = {
  account: ['sign_event:5'],
  private: ['nip44_decrypt'],
  wallet: ['sign_event:17375'],
};

/**
 * Avatar + resolved name for a decrypt-access peer — kind-0 cache first,
 * one-shot nagg fallback (useNostrPersonDisplay), shortPubkey last.
 */
function PeerAccessIdentity({ pubkey, sublabel }: { pubkey: string; sublabel: string }) {
  const [foreground, muted] = useThemeColor(['foreground', 'muted'] as const);
  const person = useNostrPersonDisplay(pubkey);
  const name = person.name ?? shortPubkey(pubkey);
  return (
    <HStack gap={12} style={PEER_ROW_STYLE}>
      <Avatar
        state={person.picture ? 'image' : 'fallback'}
        picture={person.picture}
        seed={pubkey}
        fallbackVariant="beam"
        size={32}
        alt={name}
      />
      <View style={FLEX_ONE_STYLE}>
        <Text size={14} color={foreground} numberOfLines={1}>
          {name}
        </Text>
        <Text size={12} color={muted}>
          {sublabel}
        </Text>
      </View>
    </HStack>
  );
}

/**
 * Header twin of the content identity — fades/rises in as the content
 * version scrolls under the transparent header, then stays for the rest of
 * the scroll. Lives in the navigation header's React tree, but reanimated
 * drives the style from the screen's scroll position on the UI thread.
 */
function AppHeaderIdentity({
  progress,
  name,
  image,
  seed,
}: {
  /** Flip progress 0→1 (content shown → header shown). */
  progress: SharedValue<number>;
  name: string;
  image?: string;
  seed: string;
}) {
  const [foreground] = useThemeColor(['foreground'] as const);
  const fadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, HEADER_FADE_PHASE, [0, 1], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(progress.value, HEADER_FADE_PHASE, [6, 0], Extrapolation.CLAMP) },
    ],
  }));
  const composed = [HEADER_IDENTITY_ROW_STYLE, fadeStyle];
  return (
    <Animated.View style={composed}>
      <Avatar
        state={image ? 'image' : 'fallback'}
        picture={image}
        seed={seed}
        fallbackVariant="beam"
        size={28}
        alt={name}
      />
      <Text size={16} bold color={foreground} numberOfLines={1} style={HEADER_NAME_STYLE}>
        {name}
      </Text>
    </Animated.View>
  );
}

function statsLine(app: Nip46Connection): string {
  const requests = app.requestCount === 1 ? '1 request' : `${app.requestCount} requests`;
  if (app.lastUsedAt === undefined) return requests;
  return `${requests} · Last used ${formatRelative(app.lastUsedAt, 'compact')}`;
}

// ── Screen ──────────────────────────────────────────────────────

export function SignerAppDetailScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ clientPubkey?: string }>();
  const clientPubkey =
    typeof params.clientPubkey === 'string' && isNostrPubkeyHex(params.clientPubkey)
      ? params.clientPubkey
      : undefined;

  const app = useNip46ConnectionsStore((s) =>
    clientPubkey === undefined ? undefined : s.apps[clientPubkey]
  );
  const setGrant = useNip46ConnectionsStore((s) => s.setGrant);
  const setMode = useNip46ConnectionsStore((s) => s.setMode);
  const renameApp = useNip46ConnectionsStore((s) => s.renameApp);
  const disconnectApp = useNip46ConnectionsStore((s) => s.disconnectApp);
  const revokePeerDecryptGrant = useNip46ConnectionsStore((s) => s.revokePeerDecryptGrant);
  const setPeerDecryptGrant = useNip46ConnectionsStore((s) => s.setPeerDecryptGrant);
  const revokeSessionGrant = useNip46RequestsStore((s) => s.revokeSessionGrant);
  const revokeSessionAllows = useNip46RequestsStore((s) => s.revokeSessionAllows);
  // Cooldown end (epoch ms). The engine only writes the flag during an
  // active rate-limit cooldown, so `> now` is the banner condition.
  const throttledUntil = useNip46RequestsStore((s) =>
    clientPubkey === undefined ? 0 : (s.throttledApps[clientPubkey] ?? 0)
  );
  // Ticking clock while the cooldown runs: keeps the countdown fresh and
  // lapses the banner on time even if the app went quiet (the engine writes
  // the flag only on inbound traffic).
  const [throttleNow, setThrottleNow] = useState(() => Date.now());
  useEffect(() => {
    if (throttledUntil <= Date.now()) return undefined;
    setThrottleNow(Date.now());
    const id = setInterval(() => {
      setThrottleNow(Date.now());
      if (throttledUntil <= Date.now()) clearInterval(id);
    }, THROTTLE_TICK_MS);
    return () => clearInterval(id);
  }, [throttledUntil]);
  const throttled = throttledUntil > throttleNow;

  const [foreground, muted, warning, warningSoftFg, danger] = useThemeColor([
    'foreground',
    'muted',
    'warning',
    'warning-soft-foreground',
    'danger',
  ] as const);

  const appName = appDisplayName(app);
  const appDomain = app?.url !== undefined ? safeHostname(app.url).unwrapOr(null) : null;

  // Content scrolls UNDER the transparent blur header (thread-page style):
  // the scroll view spans the full screen and the CONTENT is padded by the
  // header height instead of framing the whole screen below it.
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const scrollContentStyle = { paddingTop: headerHeight, paddingBottom: 32 + insets.bottom };
  const indicatorInsets = { top: headerHeight };

  // ── Scroll-linked identity handoff (content ↔ header) ────────
  const flipProgress = useSharedValue(0);
  const flipped = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    const y = event.contentOffset.y;
    // One retarget per crossing (not per frame); hysteresis between the two
    // thresholds keeps boundary noise from re-triggering.
    if (flipped.value === 0 && y > FLIP_SHOW_HEADER_Y) {
      flipped.value = 1;
      flipProgress.value = withTiming(1, { duration: FLIP_FADE_MS });
    } else if (flipped.value === 1 && y < FLIP_SHOW_CONTENT_Y) {
      flipped.value = 0;
      flipProgress.value = withTiming(0, { duration: FLIP_FADE_MS });
    }
  });
  const contentIdentityFade = useAnimatedStyle(() => ({
    opacity: interpolate(flipProgress.value, CONTENT_FADE_PHASE, [1, 0], Extrapolation.CLAMP),
  }));
  const contentIdentityComposed = [CONTENT_IDENTITY_STYLE, contentIdentityFade];
  const appImage = app?.image;
  useScreenOptions(
    () =>
      clientPubkey === undefined || app === undefined
        ? { headerTitle: undefined, title: '' }
        : {
            headerTitle: () => (
              <AppHeaderIdentity
                progress={flipProgress}
                name={appName}
                {...(appImage !== undefined && { image: appImage })}
                seed={clientPubkey}
              />
            ),
          },
    // flipProgress is a stable shared-value ref; app presence tracked via appImage/appName.
    [appName, appImage, clientPubkey, app === undefined]
  );
  const dangerTextStyle = { color: danger };

  // Top-level groups: capability bundles (one human concept per row) plus
  // the locked per-key rows (deletion / decrypt / wallet). Per-action
  // precision lives on the fine-grained page behind each group's link.
  const permissionGroups = useMemo(
    () =>
      GROUP_ORDER.map(({ group, label }) => {
        const bundles = PERMISSION_BUNDLES.filter((bundle) => bundle.group === group);
        const lockedRows = (LOCKED_KEYS_BY_GROUP[group] ?? []).map((grantKey) => ({
          grantKey,
          label: permissionEntryForGrantKey(grantKey).permissionEditorLabel,
          allowEligible: alwaysAllowEligible(parseGrantKey(grantKey)),
        }));
        return { group, label, bundles, lockedRows };
      }).filter(({ bundles, lockedRows }) => bundles.length > 0 || lockedRows.length > 0),
    []
  );

  // ── Per-person decrypt access (persistent + this-session grants) ──
  const sessionGrants = useNip46RequestsStore((s) => s.sessionGrants);
  const appSessionGrants = useMemo(
    () =>
      clientPubkey === undefined
        ? []
        : sessionGrants.filter((g) => g.clientPubkey === clientPubkey),
    [sessionGrants, clientPubkey]
  );
  // Session labels are suppressed in strict mode: evaluate() returns 'ask'
  // BEFORE consulting session state there (same reason the approval sheet
  // hides session affordances on strict apps), so the persisted labels are
  // the truthful ones.
  const sessionAllows = useNip46RequestsStore((s) => s.sessionAllows);
  const appSessionAllows =
    clientPubkey === undefined
      ? []
      : sessionAllows.filter((allow) => allow.clientPubkey === clientPubkey);

  const decryptAccessRows = useMemo(() => {
    const rows = new Map<string, { peer: string; sublabel: string; session: boolean }>();
    for (const [peer, grant] of Object.entries(app?.peerDecryptGrants ?? {})) {
      rows.set(peer, {
        peer,
        sublabel:
          grant.lastUsedAt !== undefined
            ? `Always · last used ${formatRelative(grant.lastUsedAt, 'chat-bubble')}`
            : `Always · granted ${formatRelative(grant.createdAt, 'chat-bubble')}`,
        session: false,
      });
    }
    // Session grants live until the engine stops. Persistent rows keep their
    // "Always" label when a peer holds both.
    for (const grant of appSessionGrants) {
      const existing = rows.get(grant.peerPubkey);
      if (existing !== undefined) {
        existing.session = true; // persistent dominates the label; revoke covers both
        continue;
      }
      rows.set(grant.peerPubkey, {
        peer: grant.peerPubkey,
        sublabel: SESSION_ACCESS_LABEL,
        session: true,
      });
    }
    return [...rows.values()].sort((a, b) => a.peer.localeCompare(b.peer));
  }, [app?.peerDecryptGrants, appSessionGrants]);

  const openPerson = (peer: string) => {
    if (clientPubkey === undefined) return;
    router.push(`/(signer-flow)/app-person?clientPubkey=${clientPubkey}&peer=${peer}` as never);
  };

  // Master switch over the whole people list — confirmed before applying,
  // because the change cascades to everyone below.
  const everyoneAllowed =
    decryptAccessRows.length > 0 &&
    decryptAccessRows.every((row) => app?.peerDecryptGrants[row.peer] !== undefined);
  const everyoneA11yValue = { text: everyoneAllowed ? 'Always' : 'Ask' };

  const onToggleEveryone = () => {
    if (clientPubkey === undefined) return;
    const peers = decryptAccessRows.map((row) => row.peer);
    const count = peers.length;
    const peopleLabel = count === 1 ? 'this person' : `all ${count} people`;
    if (everyoneAllowed) {
      actionMenuPopup({
        title: `Revoke for ${peopleLabel}?`,
        header: (
          <View className="px-2 pb-2">
            <Text size={14} style={CONFIRM_BODY_TEXT_STYLE}>
              <Text size={14} bold>
                {appName}
              </Text>
              {` will ask before decrypting with ${
                count === 1 ? 'this person' : 'any of these people'
              }. Access granted for this session ends too. No other permissions change.`}
            </Text>
          </View>
        ),
        buttons: [
          {
            text: 'Revoke for everyone',
            variant: 'dangerous',
            onPress: (close) => {
              close();
              for (const peer of peers) {
                revokePeerDecryptGrant(clientPubkey, peer);
                revokeSessionGrant(clientPubkey, undefined, peer);
              }
            },
          },
          { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
        ],
      });
      return;
    }
    // Escalation is the part worth spelling out: turning Everyone on makes
    // session-only people permanent.
    const sessionOnly = decryptAccessRows.filter(
      (row) => row.session && app?.peerDecryptGrants[row.peer] === undefined
    ).length;
    const escalationNote =
      sessionOnly === 0
        ? ''
        : sessionOnly === 1
          ? ' 1 person with access for this session becomes permanent.'
          : ` ${sessionOnly} people with access for this session become permanent.`;
    actionMenuPopup({
      title: `Allow for ${peopleLabel}?`,
      header: (
        <View className="px-2 pb-2">
          <Text size={14} style={CONFIRM_BODY_TEXT_STYLE}>
            <Text size={14} bold>
              {appName}
            </Text>
            {` will decrypt messages with ${peopleLabel} without asking — permanently, until you revoke it.${escalationNote} No other permissions change.`}
          </Text>
        </View>
      ),
      buttons: [
        {
          text: 'Allow for everyone',
          onPress: (close) => {
            close();
            let failed = 0;
            for (const peer of peers) {
              for (const method of ['nip04_decrypt', 'nip44_decrypt'] as const) {
                const result = setPeerDecryptGrant(clientPubkey, peer, method, {
                  peerIsSelf: false,
                });
                if (result.isErr()) failed += 1;
              }
            }
            if (failed > 0) {
              nostrLog.warn('nostr.signer.app_detail.apply_all_grant_failed', { failed });
            }
          },
        },
        { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
      ],
    });
  };

  // Back to the SAME defaults the connect sheet applies: clear everything,
  // then re-grant the common-social-actions preset.
  const confirmRestoreDefaults = useCallback(() => {
    if (clientPubkey === undefined || app === undefined) return;
    actionMenuPopup({
      title: 'Restore default permissions?',
      buttons: [
        {
          text: RESTORE_DEFAULTS_LABEL,
          description: RESTORE_DEFAULTS_BODY,
          onPress: (close) => {
            close();
            for (const grantKey of Object.keys(app.grants) as GrantKey[]) {
              setGrant(clientPubkey, grantKey, null);
            }
            let failed = 0;
            for (const grantKey of PAIRING_PRESET_GRANT_KEYS) {
              const result = setGrant(clientPubkey, grantKey, 'always');
              if (result.isErr()) failed += 1;
            }
            if (failed > 0) {
              nostrLog.warn('nostr.signer.app_detail.restore_defaults_failed', { failed });
            }
          },
        },
        { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
      ],
    });
  }, [clientPubkey, app, setGrant]);

  const strictModeOn = app?.mode === 'strict';
  // The whole row toggles (same affordance as the permission rows below) —
  // the switch itself is a pure visual inside a pointerEvents="none" wrapper.
  const onPressStrictRow = useCallback(() => {
    if (clientPubkey === undefined) return;
    setMode(clientPubkey, strictModeOn ? 'standard' : 'strict');
  }, [clientPubkey, setMode, strictModeOn]);
  const strictA11yState = { checked: strictModeOn };
  const openStrictMenu = () => {
    if (clientPubkey === undefined) return;
    const checkSuffix = <Icon name="mdi:check" size={18} color={muted} />;
    actionMenuPopup({
      title: STRICT_MODE_TITLE,
      buttons: [
        {
          text: STANDARD_MODE_MENU_LABEL,
          icon: 'mdi:check-circle',
          description: STANDARD_MODE_MENU_DESCRIPTION,
          ...(!strictModeOn && { suffix: checkSuffix }),
          onPress: (close) => {
            close();
            setMode(clientPubkey, 'standard');
          },
        },
        {
          text: STRICT_MODE_TITLE,
          icon: 'mdi:help-circle',
          description: STRICT_MODE_DESCRIPTION,
          ...(strictModeOn && { suffix: checkSuffix }),
          variant: 'secondary',
          onPress: (close) => {
            close();
            setMode(clientPubkey, 'strict');
          },
        },
      ],
    });
  };

  const onSelectTriState = (grantKey: GrantKey, state: TriState) => {
    if (clientPubkey === undefined) return;
    const verdict = state === 'ask' ? null : state === 'allow' ? 'always' : 'deny';
    const result = setGrant(clientPubkey, grantKey, verdict);
    if (result.isErr()) {
      nostrLog.warn('nostr.signer.app_detail.set_grant_failed', { error: result.error });
    }
  };

  // One tap covers the whole bundle; a mixed bundle self-heals to the choice.
  const onSelectBundleState = useCallback(
    (bundle: PermissionBundle, state: TriState) => {
      if (clientPubkey === undefined) return;
      const verdict = state === 'ask' ? null : state === 'allow' ? 'always' : 'deny';
      let failed = 0;
      for (const grantKey of bundle.grantKeys) {
        const result = setGrant(clientPubkey, grantKey, verdict);
        if (result.isErr()) failed += 1;
      }
      if (failed > 0) {
        nostrLog.warn('nostr.signer.app_detail.bundle_set_grant_failed', {
          bundleId: bundle.id,
          failed,
        });
      }
    },
    [clientPubkey, setGrant]
  );

  const openFineGrained = (group: PermissionEditorGroup) => {
    if (clientPubkey === undefined) return;
    router.push(
      `/(signer-flow)/app-permissions?clientPubkey=${clientPubkey}&group=${group}` as never
    );
  };

  const openRename = () => {
    if (clientPubkey === undefined) return;
    actionMenuPopup({
      title: 'Rename App',
      inputs: [
        {
          id: 'name',
          label: 'Name',
          placeholder: appName,
          initialValue: app?.name ?? '',
          autoCapitalize: 'words',
          autoCorrect: false,
        },
      ],
      primaryAction: {
        text: 'Save',
        onPress: (values, { close }) => {
          renameApp(clientPubkey, values.name ?? '');
          close();
        },
      },
    });
  };

  const openActivity = () => {
    if (clientPubkey === undefined) return;
    router.push(`/(signer-flow)/activity?clientPubkey=${clientPubkey}` as never);
  };

  const confirmDisconnect = () => {
    if (clientPubkey === undefined) return;
    const nameAtConfirm = appName;
    actionMenuPopup({
      title: 'Disconnect App',
      header: (
        <View className="px-2 pb-2">
          <Text size={14} style={CONFIRM_BODY_TEXT_STYLE}>
            <Text size={14} bold>
              {nameAtConfirm}
            </Text>
            {
              ' will no longer be able to request signatures. Its permissions and secret will be revoked. You can reconnect anytime.'
            }
          </Text>
        </View>
      ),
      buttons: [
        {
          text: 'Disconnect',
          variant: 'dangerous',
          onPress: (close) => {
            close();
            revokeSessionGrant(clientPubkey);
            revokeSessionAllows(clientPubkey);
            disconnectApp(clientPubkey);
            popup({ message: `${nameAtConfirm} disconnected`, type: 'success' });
            router.back();
          },
        },
        { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
      ],
    });
  };

  // Unknown pubkey, or the app was just disconnected — transient empty frame.
  if (clientPubkey === undefined || app === undefined) {
    return (
      <Screen name="SignerAppDetailScreen">
        <View />
      </Screen>
    );
  }

  return (
    <Screen name="SignerAppDetailScreen" scroll="custom">
      <Animated.ScrollView
        style={SCROLL_H_PADDING}
        contentContainerStyle={scrollContentStyle}
        scrollIndicatorInsets={indicatorInsets}
        onScroll={onScroll}
        scrollEventThrottle={16}>
        {/* Identity card — logo + name fade out as their header twins fade in */}
        <VStack align="center" spacing={4} className="pb-2 pt-4">
          <Animated.View style={contentIdentityComposed}>
            <Avatar
              state={app.image ? 'image' : 'fallback'}
              picture={app.image}
              seed={app.clientPubkey}
              fallbackVariant="beam"
              size={IDENTITY_AVATAR_SIZE}
              alt={appName}
            />
            <View className="pt-2">
              <Text size={20} bold color={foreground} numberOfLines={1}>
                {appName}
              </Text>
            </View>
          </Animated.View>
          <Text size={13} color={muted} numberOfLines={1}>
            {appDomain ?? shortPubkey(app.clientPubkey)}
          </Text>
          <Text size={12} color={muted}>
            {`Connected ${formatDate(app.pairedAt, 'short-date')}`}
          </Text>
          {/* Stats row */}
          <View className="pt-1">
            <Text size={13} color={muted}>
              {statsLine(app)}
            </Text>
          </View>
        </VStack>

        {/* Throttle flag */}
        {throttled ? (
          <View className="bg-warning-soft mt-2 rounded-2xl p-3">
            <HStack spacing={8} style={CENTER_ROW_STYLE}>
              <Icon name="mdi:alert-circle-outline" size={18} color={warning} />
              <View style={FLEX_ONE_STYLE}>
                <Text size={13} bold color={warningSoftFg}>
                  {THROTTLED_BANNER}
                </Text>
                <Text size={12} color={warningSoftFg}>
                  {`Requests are being declined automatically — asking resumes ${throttleResumeLabel(
                    throttledUntil - throttleNow
                  )}.`}
                </Text>
              </View>
            </HStack>
          </View>
        ) : null}

        {/* Gesture demo — teaches tap / long-press on the permission rows below */}
        <View className="pt-4">
          <PermissionGestureDemo />
        </View>

        {/* Strict mode — the whole row toggles, like the permission rows */}
        <View className="pt-4">
          <ListGroup variant="secondary">
            <PressableFeedback
              animation={false}
              onPress={onPressStrictRow}
              onLongPress={openStrictMenu}
              accessibilityRole="switch"
              accessibilityLabel={STRICT_MODE_TITLE}
              accessibilityState={strictA11yState}
              accessibilityHint={STRICT_ROW_HINT}>
              <PressableFeedback.Scale>
                <ListGroup.Item disabled>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle>{STRICT_MODE_TITLE}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription>{STRICT_MODE_DESCRIPTION}</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  <ListGroup.ItemSuffix>
                    <View pointerEvents="none">
                      <HeroSwitch isSelected={strictModeOn} />
                    </View>
                  </ListGroup.ItemSuffix>
                </ListGroup.Item>
              </PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
          </ListGroup>
        </View>

        {/* Permissions — group headers carry the structure, no extra title */}
        <View className="pt-2">
          <VStack spacing={8}>
            {permissionGroups.map(({ group, label, bundles, lockedRows }) => (
              <View key={group}>
                <Text
                  className="text-foreground/50 mb-1 ml-3 mt-1 uppercase tracking-wide"
                  size={12}
                  medium>
                  {label}
                </Text>
                <ListGroup variant="secondary">
                  {bundles.map((bundle, index) => (
                    <React.Fragment key={bundle.id}>
                      {index > 0 ? <Separator className="mx-4" /> : null}
                      <PermissionSwitchRow
                        label={bundle.label}
                        state={bundleTriState((grantKey) => app.grants[grantKey]?.verdict, bundle)}
                        allowEligible
                        sessionStatus={
                          strictModeOn
                            ? undefined
                            : bundleSessionStatus(bundle.grantKeys, appSessionAllows)
                        }
                        onChange={(next) => onSelectBundleState(bundle, next)}
                      />
                    </React.Fragment>
                  ))}
                  {lockedRows.map(({ grantKey, label: rowLabel, allowEligible }, index) => (
                    <React.Fragment key={grantKey}>
                      {bundles.length > 0 || index > 0 ? <Separator className="mx-4" /> : null}
                      <PermissionSwitchRow
                        label={rowLabel}
                        state={triStateFor(app, grantKey)}
                        allowEligible={allowEligible}
                        sessionStatus={
                          strictModeOn
                            ? undefined
                            : sessionStatusFor(grantKey, appSessionGrants, appSessionAllows)
                        }
                        onChange={(state) => onSelectTriState(grantKey, state)}
                      />
                    </React.Fragment>
                  ))}
                  {/* Master switch over the people list — cascades, so it
                      always confirms first. */}
                  {group === 'private' && decryptAccessRows.length > 0 ? (
                    <>
                      <Separator className="mx-4" />
                      <PressableFeedback
                        animation={false}
                        onPress={onToggleEveryone}
                        accessibilityRole="button"
                        accessibilityLabel={EVERYONE_TITLE}
                        accessibilityValue={everyoneA11yValue}>
                        <PressableFeedback.Scale>
                          <ListGroup.Item disabled>
                            <ListGroup.ItemContent>
                              <ListGroup.ItemTitle>{EVERYONE_TITLE}</ListGroup.ItemTitle>
                              <ListGroup.ItemDescription>
                                {EVERYONE_DESCRIPTION}
                              </ListGroup.ItemDescription>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix>
                              <View pointerEvents="none">
                                <HeroSwitch isSelected={everyoneAllowed} />
                              </View>
                            </ListGroup.ItemSuffix>
                          </ListGroup.Item>
                        </PressableFeedback.Scale>
                        <PressableFeedback.Ripple />
                      </PressableFeedback>
                    </>
                  ) : null}
                  {/* People this app may decrypt with — continuation of the
                      decrypt row above (Private Data group only). */}
                  {group === 'private'
                    ? decryptAccessRows.map((row) => (
                        <React.Fragment key={row.peer}>
                          <Separator className="mx-4" />
                          <PressableFeedback
                            animation={false}
                            onPress={() => openPerson(row.peer)}
                            accessibilityRole="button"
                            accessibilityLabel="Edit decrypt access"
                            accessibilityHint="Opens this person's access settings">
                            <PressableFeedback.Scale>
                              <ListGroup.Item disabled>
                                <ListGroup.ItemContent>
                                  <PeerAccessIdentity pubkey={row.peer} sublabel={row.sublabel} />
                                </ListGroup.ItemContent>
                                <ListGroup.ItemSuffix>
                                  <Icon name="mdi:chevron-right" size={18} color={muted} />
                                </ListGroup.ItemSuffix>
                              </ListGroup.Item>
                            </PressableFeedback.Scale>
                            <PressableFeedback.Ripple />
                          </PressableFeedback>
                        </React.Fragment>
                      ))
                    : null}
                </ListGroup>
                {group === 'private' && decryptAccessRows.length > 0 ? (
                  <Text className="ml-3 mt-1" size={12} color={muted}>
                    {DECRYPT_ACCESS_CAPTION}
                  </Text>
                ) : null}
                {lockedRows.some(({ allowEligible }) => !allowEligible) ? (
                  <Text className="ml-3 mt-1" size={12} color={muted}>
                    {group === 'wallet' ? WALLET_GROUP_CAPTION : LOCKED_GROUP_CAPTION}
                  </Text>
                ) : null}
                <Pressable
                  haptics
                  accessibilityRole="button"
                  accessibilityLabel={FINE_GRAINED_LABEL}
                  onPress={() => openFineGrained(group)}>
                  <HStack gap={4} className="mr-1 mt-1" style={FINE_GRAINED_ROW_STYLE}>
                    <Text size={12} bold color={muted}>
                      {FINE_GRAINED_LABEL}
                    </Text>
                    <Icon name="mdi:chevron-right" size={14} color={muted} />
                  </HStack>
                </Pressable>
              </View>
            ))}
          </VStack>
        </View>

        {/* Manage rows */}
        <View className="pt-4">
          <ListGroup variant="secondary">
            <ListRow
              paddingHorizontal={MANAGE_ROW_INSET}
              title="Rename App"
              subtitle={RENAME_APP_SUBTITLE}
              wrapSubtitle
              trailing={<Icon name="mdi:chevron-right" size={18} color={muted} />}
              onPress={openRename}
            />
            <ListRow
              paddingHorizontal={MANAGE_ROW_INSET}
              title="View Activity"
              subtitle={VIEW_ACTIVITY_SUBTITLE}
              wrapSubtitle
              trailing={<Icon name="mdi:chevron-right" size={18} color={muted} />}
              onPress={openActivity}
            />
            <ListRow
              paddingHorizontal={MANAGE_ROW_INSET}
              title={RESTORE_DEFAULTS_LABEL}
              subtitle={RESTORE_DEFAULTS_SUBTITLE}
              wrapSubtitle
              trailing={<Icon name="mdi:chevron-right" size={18} color={muted} />}
              onPress={confirmRestoreDefaults}
            />
          </ListGroup>
        </View>

        {/* Danger zone */}
        <Section title="Danger Zone" isDanger>
          <ListGroup variant="secondary">
            <ListRow
              paddingHorizontal={MANAGE_ROW_INSET}
              title={
                <Text size={16} bold style={dangerTextStyle}>
                  Disconnect App
                </Text>
              }
              subtitle={DISCONNECT_SUBTITLE}
              wrapSubtitle
              accessibilityLabel="Disconnect App"
              trailing={<Icon name="mdi:chevron-right" size={18} color={muted} />}
              onPress={confirmDisconnect}
            />
          </ListGroup>
        </Section>
      </Animated.ScrollView>
    </Screen>
  );
}
