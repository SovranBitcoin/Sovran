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
import { ListGroup, PressableFeedback, Separator, Switch as HeroSwitch } from 'heroui-native';

import Icon from 'assets/icons';
import { safeHostname, shortPubkey } from '@/features/nostrSigner/components/display';
import {
  alwaysAllowEligible,
  appDisplayName,
  permissionEntryForGrantKey,
  type PermissionEditorGroup,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  PermissionSwitchRow,
  triStateFor,
  type TriState,
} from '@/features/nostrSigner/components/PermissionKeyRows';
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
  'Tap a permission to toggle Allow. Long-press for Ask / Allow / Block. Everything is logged in Activity.';
const STRICT_MODE_TITLE = 'Ask Every Time';
const STRICT_MODE_DESCRIPTION = 'Ignore saved permissions and ask for every request.';
const FINE_GRAINED_LABEL = 'Advanced';
const RESTORE_DEFAULTS_LABEL = 'Restore Defaults';
const RESTORE_DEFAULTS_BODY =
  'Common social actions are allowed again — the same defaults as when you first connect. Everything else asks. Decrypt access for people is not affected.';
const EVERYONE_TITLE = 'Everyone';
const EVERYONE_DESCRIPTION = 'Master setting · applies to all people below';
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
    <HStack gap={12} style={{ flex: 1, alignItems: 'center' }}>
      <Avatar
        state={person.picture ? 'image' : 'fallback'}
        picture={person.picture}
        seed={pubkey}
        fallbackVariant="beam"
        size={32}
        alt={name}
      />
      <View style={{ flex: 1 }}>
        <Text size={14} color={foreground} numberOfLines={1}>
          {name}
        </Text>
        <Text size={12} color={muted} numberOfLines={1}>
          {sublabel}
        </Text>
      </View>
    </HStack>
  );
}

function statsLine(app: Nip46Connection): string {
  const requests = app.requestCount === 1 ? '1 request' : `${app.requestCount} requests`;
  if (app.lastUsedAt === undefined) return requests;
  return `${requests} · Last used ${formatRelative(app.lastUsedAt, 'compact')}`;
}

// ── Row pieces ──────────────────────────────────────────────────

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
  const revokePeerDecryptGrant = useNip46ConnectionsStore((s) => s.revokePeerDecryptGrant);
  const setPeerDecryptGrant = useNip46ConnectionsStore((s) => s.setPeerDecryptGrant);
  const revokeSessionGrant = useNip46RequestsStore((s) => s.revokeSessionGrant);
  const revokeSessionAllows = useNip46RequestsStore((s) => s.revokeSessionAllows);
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

  const openPerson = useCallback(
    (peer: string) => {
      if (clientPubkey === undefined) return;
      router.push(`/(signer-flow)/app-person?clientPubkey=${clientPubkey}&peer=${peer}` as never);
    },
    [clientPubkey]
  );

  // Master switch over the whole people list — confirmed before applying,
  // because the change cascades to everyone below.
  const everyoneAllowed =
    decryptAccessRows.length > 0 &&
    decryptAccessRows.every((row) => app?.peerDecryptGrants[row.peer] !== undefined);

  const onToggleEveryone = useCallback(() => {
    if (clientPubkey === undefined) return;
    const peers = decryptAccessRows.map((row) => row.peer);
    const count = peers.length;
    if (everyoneAllowed) {
      actionMenuPopup({
        title: `Revoke for all ${count} people?`,
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
    actionMenuPopup({
      title: `Allow for all ${count} people?`,
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
  }, [
    clientPubkey,
    decryptAccessRows,
    everyoneAllowed,
    setPeerDecryptGrant,
    revokePeerDecryptGrant,
    revokeSessionGrant,
  ]);

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

  const openFineGrained = useCallback(
    (group: PermissionEditorGroup) => {
      if (clientPubkey === undefined) return;
      router.push(
        `/(signer-flow)/app-permissions?clientPubkey=${clientPubkey}&group=${group}` as never
      );
    },
    [clientPubkey]
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
            revokeSessionAllows(clientPubkey);
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
                        accessibilityValue={{ text: everyoneAllowed ? 'Always' : 'Ask' }}>
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
                  <HStack
                    gap={4}
                    className="mr-1 mt-1"
                    style={{ alignItems: 'center', alignSelf: 'flex-end' }}>
                    <Text size={12} bold color={muted}>
                      {FINE_GRAINED_LABEL}
                    </Text>
                    <Icon name="mdi:chevron-right" size={14} color={muted} />
                  </HStack>
                </Pressable>
              </View>
            ))}
            <Text className="ml-3" size={12} color={muted} style={{ lineHeight: 17 }}>
              {PERMISSIONS_FOOTER}
            </Text>
          </VStack>
        </View>

        {/* Manage rows */}
        <ListGroup variant="secondary">
          <LinkRow title="Rename App" onPress={openRename} />
          <LinkRow title="View Activity" onPress={openActivity} />
          <LinkRow title={RESTORE_DEFAULTS_LABEL} onPress={confirmRestoreDefaults} />
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
