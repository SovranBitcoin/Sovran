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

import React, { useCallback, useMemo } from 'react';
import { ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Button as HerouiButton,
  ListGroup,
  PressableFeedback,
  Switch as HeroSwitch,
} from 'heroui-native';

import Icon from 'assets/icons';
import { safeHostname, shortPubkey } from '@/features/nostrSigner/components/display';
import {
  alwaysAllowEligible,
  appDisplayName,
  permissionEntryForGrantKey,
  type PermissionEditorGroup,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatDate, formatRelative } from '@/shared/lib/date';
import { nostrLog } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';
import { actionMenuPopup, popup } from '@/shared/lib/popup';
import { Screen } from '@/shared/ui/composed/Screen';
import { Section } from '@/shared/ui/composed/Section';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const IDENTITY_AVATAR_SIZE = 64;

const THROTTLED_BANNER = 'This app is sending unusual amounts of requests';
const WALLET_GROUP_CAPTION = 'Wallet events always require your approval.';
const LOCKED_GROUP_CAPTION =
  'Some of these always require your approval and can never be set to Allow.';
const PERMISSIONS_FOOTER =
  'Allow signs without asking. Block denies without asking. Everything is logged in Activity.';
const STRICT_MODE_TITLE = 'Ask Every Time';
const STRICT_MODE_DESCRIPTION = 'Ignore saved permissions and ask for every request.';

/**
 * Canonical editor rows: one representative grant key per catalog editor
 * label, grouped Basic / Content / Account / Wallet. The app's own grant
 * keys are unioned in so every stored grant materializes as a visible row.
 */
const BASE_EDITOR_GRANT_KEYS: readonly GrantKey[] = [
  // basic
  'nip44_encrypt',
  // content
  'sign_event:1',
  'sign_event:6',
  'sign_event:7',
  'sign_event:14',
  // account
  'sign_event:0',
  'sign_event:3',
  'sign_event:5',
  'sign_event:10002',
  'sign_event:22242',
  'sign_event:30078',
  // wallet
  'sign_event:17375',
  'nip44_decrypt',
];

const GROUP_ORDER: readonly { group: PermissionEditorGroup; label: string }[] = [
  { group: 'basic', label: 'Basic' },
  { group: 'content', label: 'Content' },
  { group: 'account', label: 'Account' },
  { group: 'wallet', label: 'Wallet' },
];

type TriState = 'ask' | 'allow' | 'block';

const TRI_STATE_OPTIONS: readonly { state: TriState; label: string }[] = [
  { state: 'ask', label: 'Ask' },
  { state: 'allow', label: 'Allow' },
  { state: 'block', label: 'Block' },
];

function triStateFor(app: Nip46Connection, grantKey: GrantKey): TriState {
  const verdict = app.grants[grantKey]?.verdict;
  if (verdict === 'always') return 'allow';
  if (verdict === 'deny') return 'block';
  return 'ask';
}

/** Append the kind/method so two rows sharing a catalog label stay distinguishable. */
function disambiguatedLabel(grantKey: GrantKey, baseLabel: string): string {
  const { method, kind } = parseGrantKey(grantKey);
  if (method === 'sign_event' && kind !== undefined) return `${baseLabel} (kind ${kind})`;
  return `${baseLabel} (${method})`;
}

function statsLine(app: Nip46Connection): string {
  const requests = app.requestCount === 1 ? '1 request' : `${app.requestCount} requests`;
  if (app.lastUsedAt === undefined) return requests;
  return `${requests} · Last used ${formatRelative(app.lastUsedAt, 'compact')}`;
}

// ── Row pieces ──────────────────────────────────────────────────

function TriStateChips({
  current,
  allowEligible,
  onSelect,
}: {
  current: TriState;
  allowEligible: boolean;
  onSelect: (state: TriState) => void;
}) {
  return (
    <HStack gap={6}>
      {TRI_STATE_OPTIONS.map(({ state, label }) => (
        <HerouiButton
          key={state}
          variant={current === state ? 'primary' : 'secondary'}
          size="sm"
          isDisabled={state === 'allow' && !allowEligible}
          onPress={() => onSelect(state)}
          accessibilityLabel={label}
          accessibilityState={{ selected: current === state }}>
          <HerouiButton.Label>{label}</HerouiButton.Label>
        </HerouiButton>
      ))}
    </HStack>
  );
}

function LinkRow({
  title,
  isDanger,
  onPress,
}: {
  title: string;
  isDanger?: boolean;
  onPress: () => void;
}) {
  const [danger, muted] = useThemeColor(['danger', 'muted'] as const);
  return (
    <PressableFeedback animation={false} onPress={onPress}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>
              {isDanger ? <Text style={{ color: danger }}>{title}</Text> : title}
            </ListGroup.ItemTitle>
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            <Icon name="mdi:chevron-right" size={18} color={muted} />
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
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
  const revokeSessionGrant = useNip46RequestsStore((s) => s.revokeSessionGrant);
  // Derive from cooldownUntil so the banner lapses with the cooldown even if
  // the app went quiet (the engine only writes the flag on inbound traffic).
  const throttled = useNip46RequestsStore((s) =>
    clientPubkey === undefined ? false : (s.throttledApps[clientPubkey] ?? 0) > Date.now()
  );

  const [foreground, muted, warning, warningSoftFg] = useThemeColor([
    'foreground',
    'muted',
    'warning',
    'warning-soft-foreground',
  ] as const);

  const appName = appDisplayName(app);
  const appDomain = app?.url !== undefined ? safeHostname(app.url).unwrapOr(null) : null;

  const groupedRows = useMemo(() => {
    const keys: GrantKey[] = [...BASE_EDITOR_GRANT_KEYS];
    const extras = (Object.keys(app?.grants ?? {}) as GrantKey[])
      .filter((key) => !keys.includes(key))
      .sort();
    keys.push(...extras);

    const base = keys.map((grantKey) => ({
      grantKey,
      entry: permissionEntryForGrantKey(grantKey),
      allowEligible: alwaysAllowEligible(parseGrantKey(grantKey)),
    }));
    // The catalog maps sibling kinds to one editor label (e.g. kinds 1 and 1111
    // both → "Publish posts"), so a unioned grant key can collide with a base
    // row. Qualify the label with its kind/method whenever it is shared, so no
    // two rows render identically.
    const labelCounts = new Map<string, number>();
    for (const row of base) {
      labelCounts.set(
        row.entry.permissionEditorLabel,
        (labelCounts.get(row.entry.permissionEditorLabel) ?? 0) + 1
      );
    }
    const rows = base.map((row) => ({
      ...row,
      displayLabel:
        (labelCounts.get(row.entry.permissionEditorLabel) ?? 0) > 1
          ? disambiguatedLabel(row.grantKey, row.entry.permissionEditorLabel)
          : row.entry.permissionEditorLabel,
    }));
    return GROUP_ORDER.map(({ group, label }) => {
      const groupRows = rows.filter((row) => row.entry.permissionEditorGroup === group);
      return {
        group,
        label,
        rows: groupRows,
        // Any locked (Allow-disabled) row needs an explanation, not just Wallet.
        hasLockedRow: groupRows.some((row) => !row.allowEligible),
      };
    }).filter(({ rows: groupRows }) => groupRows.length > 0);
  }, [app?.grants]);

  const onSelectTriState = useCallback(
    (grantKey: GrantKey, state: TriState) => {
      if (clientPubkey === undefined) return;
      const verdict = state === 'ask' ? null : state === 'allow' ? 'always' : 'deny';
      const result = setGrant(clientPubkey, grantKey, verdict);
      if (result.isErr()) {
        nostrLog.warn('nostr.signer.app_detail.set_grant_failed', { error: result.error });
      }
    },
    [clientPubkey, setGrant]
  );

  const openRename = useCallback(() => {
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
  }, [app?.name, appName, clientPubkey, renameApp]);

  const openActivity = useCallback(() => {
    if (clientPubkey === undefined) return;
    router.push(`/(signer-flow)/activity?clientPubkey=${clientPubkey}` as never);
  }, [clientPubkey]);

  const confirmDisconnect = useCallback(() => {
    if (clientPubkey === undefined) return;
    const nameAtConfirm = appName;
    actionMenuPopup({
      title: 'Disconnect App',
      header: (
        <View className="px-2 pb-2">
          <Text size={14} style={{ lineHeight: 20 }}>
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
            disconnectApp(clientPubkey);
            popup({ message: `${nameAtConfirm} disconnected`, type: 'success' });
            router.back();
          },
        },
        { text: 'Cancel', variant: 'secondary', onPress: (close) => close() },
      ],
    });
  }, [appName, clientPubkey, disconnectApp, revokeSessionGrant]);

  // Unknown pubkey, or the app was just disconnected — transient empty frame.
  if (clientPubkey === undefined || app === undefined) {
    return (
      <Screen name="SignerAppDetailScreen">
        <View />
      </Screen>
    );
  }

  return (
    <Screen name="SignerAppDetailScreen" scroll="custom" safeArea>
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 32 }}>
        {/* Identity card */}
        <VStack align="center" spacing={4} className="pb-2 pt-4">
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
            <HStack spacing={8} style={{ alignItems: 'center' }}>
              <Icon name="mdi:alert-circle-outline" size={18} color={warning} />
              <View style={{ flex: 1 }}>
                <Text size={13} color={warningSoftFg}>
                  {THROTTLED_BANNER}
                </Text>
              </View>
            </HStack>
          </View>
        ) : null}

        {/* Strict mode */}
        <View className="pt-4">
          <ListGroup variant="secondary">
            <ListGroup.Item>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle>{STRICT_MODE_TITLE}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription>{STRICT_MODE_DESCRIPTION}</ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              <ListGroup.ItemSuffix>
                <HeroSwitch
                  isSelected={app.mode === 'strict'}
                  onSelectedChange={(selected) =>
                    setMode(clientPubkey, selected ? 'strict' : 'standard')
                  }
                />
              </ListGroup.ItemSuffix>
            </ListGroup.Item>
          </ListGroup>
        </View>

        {/* Permissions */}
        <Section title="Permissions">
          <VStack spacing={8}>
            {groupedRows.map(({ group, label, rows, hasLockedRow }) => (
              <View key={group}>
                <Text
                  className="text-foreground/50 mb-1 ml-3 mt-1 uppercase tracking-wide"
                  size={12}
                  medium>
                  {label}
                </Text>
                <View className="bg-surface-secondary rounded-lg px-3 py-1">
                  {rows.map(({ grantKey, displayLabel, allowEligible }) => (
                    <HStack key={grantKey} gap={12} style={{ paddingVertical: 8 }}>
                      <View style={{ flex: 1 }}>
                        <Text size={14} color={foreground} numberOfLines={2}>
                          {displayLabel}
                        </Text>
                      </View>
                      <TriStateChips
                        current={triStateFor(app, grantKey)}
                        allowEligible={allowEligible}
                        onSelect={(state) => onSelectTriState(grantKey, state)}
                      />
                    </HStack>
                  ))}
                </View>
                {hasLockedRow ? (
                  <Text className="ml-3 mt-1" size={12} color={muted}>
                    {group === 'wallet' ? WALLET_GROUP_CAPTION : LOCKED_GROUP_CAPTION}
                  </Text>
                ) : null}
              </View>
            ))}
            <Text className="ml-3" size={12} color={muted} style={{ lineHeight: 17 }}>
              {PERMISSIONS_FOOTER}
            </Text>
          </VStack>
        </Section>

        {/* Manage rows */}
        <ListGroup variant="secondary">
          <LinkRow title="Rename App" onPress={openRename} />
          <LinkRow title="View Activity" onPress={openActivity} />
        </ListGroup>

        {/* Danger zone */}
        <Section title="Danger Zone" isDanger>
          <ListGroup variant="secondary">
            <LinkRow title="Disconnect App" isDanger onPress={confirmDisconnect} />
          </ListGroup>
        </Section>
      </ScrollView>
    </Screen>
  );
}
