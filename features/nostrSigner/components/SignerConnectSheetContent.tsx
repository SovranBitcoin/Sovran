/**
 * @fileoverview 'signer-connect' sheet body + 'signer-profile-picker' page
 *
 * Pairing review for a scanned/pasted/deep-linked `nostrconnect://` URI. The
 * raw URI is parsed HERE (every entry point shares one validation path) and
 * embeds the pairing secret — never log it or any derived string.
 *
 * Permission checklist semantics (permissionCatalog is the single source):
 *   standard tier            → pre-checked SelectableCheck
 *   protected/unknown tier   → unchecked, warning tint
 *   wallet tier / critical   → disabled-off + "Always asks" + static notice
 *     grant keys               (alwaysAllowEligible gates — never tier alone)
 * Already-connected clients get the "Update Permissions" review variant:
 * existing always-grants pre-check their rows and metadata updates apply only
 * after the user confirms (engine handles both on complete).
 *
 * Lifecycle subtlety: pushing the in-sheet profile-picker page unmounts this
 * body (PopupHost renders only the top custom page), so pairing registration,
 * the service-hot flag, and the checkbox cache are released only when the
 * SHEET itself is gone — both pages share `releaseIfSheetClosed`.
 *
 * The "Switch & Connect" path delegates to `switchProfileAndPair` (lib) —
 * pairing intent persisted (awaited) → sheet closed → restart-based profile
 * switch. On an abort (intent not saved / switch refused) the seam shows the
 * retry toast; the sheet only closes once the intent write is durable.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BottomSheet, Button as HerouiButton } from 'heroui-native';
import { Result } from 'neverthrow';
import { nip19 } from 'nostr-tools';

import Icon from 'assets/icons';
import {
  alwaysAllowEligible,
  appDisplayName,
  permissionEntryFor,
  type CopySegment,
  type PermissionCatalogEntry,
} from '@/features/nostrSigner/components/permissionCatalog';
import { useNip46ConnectionsStore } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import {
  nip46Engine,
  type Nip46EngineError,
  type CompleteNostrconnectPairingInput,
} from '@/features/nostrSigner/lib/nip46Engine';
import type { GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import {
  parseNostrconnectUri,
  type ParsedNostrConnectUri,
} from '@/features/nostrSigner/lib/nip46Uri';
import { grantKeyFor } from '@/features/nostrSigner/lib/permissionPolicy';
import { switchProfileAndPair } from '@/features/nostrSigner/lib/switchProfileAndPair';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { resolveIdentityName } from '@/shared/lib/identity';
import { nostrLog } from '@/shared/lib/logger';
import { popup, type ActionSheetPayloads } from '@/shared/lib/popup';
import type { CustomSheetSharedProps } from '@/shared/lib/popup/sheets/types';
import { truncateMiddle } from '@/shared/lib/strings';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { isCustomSheetPayload, usePopupStore } from '@/shared/stores/runtime/popupStore';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Button } from '@/shared/ui/primitives/Button';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';

// ── Copy (plan verbatim; templates interpolate bounded names) ───

const CONNECT_TITLE = 'Connect App';
const UPDATE_PERMISSIONS_LABEL = 'Update Permissions';
const SIGNING_IN_AS_LABEL = 'Signing in as';
const CHANGE_LABEL = 'Change';
const REQUESTING_LABEL = 'This app is requesting:';
const ALWAYS_ASKS_LABEL = 'Always asks';
const UNCHECKED_CAPTION = 'Unchecked permissions will ask you each time instead.';
const STRIPPED_PERMS_NOTICE =
  "These permissions can never be granted in advance — you'll be asked each time.";
const CONNECT_BUTTON_LABEL = 'Connect';
const CANCEL_BUTTON_LABEL = 'Cancel';
const TRY_AGAIN_BUTTON_LABEL = 'Try Again';
const CONNECTING_BUTTON_LABEL = 'Connecting…';
const INVALID_LINK_MESSAGE = "That doesn't look like a Nostr connection link.";
const RELAY_UNREACHABLE_MESSAGE =
  "Couldn't reach the app's relays. Check your connection and try again.";
const SAVE_FAILED_MESSAGE =
  "This connection couldn't be saved. You may have reached the connected-app limit.";

const PICKER_TITLE = 'Sign In As';
const RESTART_WARNING_TITLE = 'Switching profiles restarts Sovran.';
const SWITCH_AND_CONNECT_LABEL = 'Switch & Connect';

function cautionSegments(connectionOrigin: string): CopySegment[] {
  return [
    {
      text: 'App details are provided by the app itself. Make sure you started this connection at ',
    },
    { text: connectionOrigin, bold: true },
    { text: '.' },
  ];
}

function connectedToastCopy(appName: string): { label: string; description: string } {
  return {
    label: `Connected to ${appName}`,
    description: "You're signed in. Manage permissions in Connected Apps.",
  };
}

function restartWarningSegments(appName: string): CopySegment[] {
  return [
    { text: 'The connection to ' },
    { text: appName, bold: true },
    { text: ' will continue automatically after the restart.' },
  ];
}

// ── Shared helpers ──────────────────────────────────────────────

const safeHostname = Result.fromThrowable(
  (url: string) => new URL(url).hostname,
  () => 'invalid_url' as const
);

const safeNpubEncode = Result.fromThrowable(
  (pubkeyHex: string) => nip19.npubEncode(pubkeyHex),
  () => 'invalid_pubkey' as const
);

const NPUB_TRUNCATE_CHARS = 12;

function truncatedNpubFor(pubkeyHex: string): string {
  const npub = safeNpubEncode(pubkeyHex).unwrapOr(pubkeyHex);
  return truncateMiddle(npub, NPUB_TRUNCATE_CHARS);
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

/**
 * Sheet-scoped resource release. Both the root page and the pushed picker
 * page unmount on a page swap, so each unmount first checks whether the
 * signer-connect SHEET is still up — only a real close releases the hot flag,
 * cancels the awaited pairing (a no-op once pairing completed), and drops the
 * cached checkbox state.
 */
function releaseIfSheetClosed(parsed: ParsedNostrConnectUri): void {
  const popupState = usePopupStore.getState();
  const sheetStillUp =
    popupState.isOpen &&
    isCustomSheetPayload(popupState.current) &&
    popupState.current.sheetId === 'signer-connect';
  if (sheetStillUp) return;
  useNip46RequestsStore.getState().setServiceHotRequested(false);
  checkedStateCache.delete(checkedCacheKey(parsed));
  const cancelled = nip46Engine.cancelNostrconnectPairing(parsed.clientPubkey);
  if (cancelled.isErr()) {
    nostrLog.warn('nostr.signer.connect_sheet_cancel_failed', { error: cancelled.error.type });
  }
}

// ── Permission checklist model ──────────────────────────────────

interface PermRow {
  grantKey: GrantKey;
  entry: PermissionCatalogEntry;
  /** alwaysAllowEligible — also blocks critical GRANT KEYS, not tier alone. */
  eligible: boolean;
  /** Protected/unknown tiers render the warning tint. */
  warning: boolean;
}

function permRowsFor(parsed: ParsedNostrConnectUri): PermRow[] {
  const rows: PermRow[] = [];
  const seen = new Set<string>();
  for (const token of parsed.perms) {
    const grantKey = grantKeyFor(token.method, token.kind);
    if (grantKey === null) continue; // auto-class methods — nothing to grant
    if (seen.has(grantKey)) continue;
    seen.add(grantKey);
    const lookup = { method: token.method, ...(token.kind !== undefined && { kind: token.kind }) };
    const entry = permissionEntryFor(lookup);
    rows.push({
      grantKey,
      entry,
      eligible: alwaysAllowEligible(lookup),
      warning: entry.tier === 'protected' || entry.tier === 'unknown',
    });
  }
  return rows;
}

function defaultCheckedFor(
  rows: readonly PermRow[],
  existingGrants: Partial<Record<GrantKey, { verdict: string }>> | undefined
): Record<string, boolean> {
  const checked: Record<string, boolean> = {};
  for (const row of rows) {
    if (!row.eligible) {
      checked[row.grantKey] = false;
      continue;
    }
    if (existingGrants?.[row.grantKey]?.verdict === 'always') {
      checked[row.grantKey] = true;
      continue;
    }
    // Security design resolution: sensitive perms default UNCHECKED.
    checked[row.grantKey] = row.entry.tier === 'standard';
  }
  return checked;
}

/**
 * Survives the root-page unmount caused by pushing the profile-picker page
 * (PopupHost renders only the top custom page). Keyed per pairing attempt;
 * dropped by `releaseIfSheetClosed` when the sheet actually closes.
 */
const checkedStateCache = new Map<string, Record<string, boolean>>();

function checkedCacheKey(parsed: ParsedNostrConnectUri): string {
  return `${parsed.clientPubkey}:${parsed.secret}`;
}

// ── Engine completion (waits out the service-hook cold start) ───

const ENGINE_START_RETRY_MS = 400;
const ENGINE_START_MAX_TRIES = 5;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The hot flag is set on mount, but the service hook starts the engine in an
 * effect — a fast Connect tap can race it. 'not-started' is retried briefly;
 * every other error surfaces to the inline error state.
 */
async function completePairingWhenHot(
  input: CompleteNostrconnectPairingInput
): Promise<Result<void, Nip46EngineError>> {
  let outcome = await nip46Engine.completeNostrconnectPairing(input);
  for (let attempt = 1; attempt < ENGINE_START_MAX_TRIES; attempt += 1) {
    if (outcome.isOk() || outcome.error.type !== 'not-started') return outcome;
    await delay(ENGINE_START_RETRY_MS);
    outcome = await nip46Engine.completeNostrconnectPairing(input);
  }
  return outcome;
}

type ConnectFailure = 'relays' | 'save';

function failureFor(error: Nip46EngineError): ConnectFailure {
  return error.type === 'upsert-failed' ? 'save' : 'relays';
}

// ── Root sheet body ─────────────────────────────────────────────

interface SignerConnectContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['signer-connect'];
}

export function SignerConnectSheetContent(props: SignerConnectContentProps): React.ReactElement {
  const parsedResult = useMemo(() => parseNostrconnectUri(props.payload.uri), [props.payload.uri]);
  if (parsedResult.isErr()) {
    return <InvalidLinkBody close={props.close} />;
  }
  return <ConnectReview {...props} parsed={parsedResult.value} />;
}

function InvalidLinkBody({ close }: { close: () => void }): React.ReactElement {
  const [foreground, danger] = useThemeColor(['foreground', 'danger'] as const);
  return (
    <VStack spacing={14} className="px-1 pb-2 pt-1">
      <BottomSheet.Title className="text-foreground text-lg font-bold">
        {CONNECT_TITLE}
      </BottomSheet.Title>
      <HStack spacing={10} align="center">
        <Icon name="mdi:alert-circle-outline" size={22} color={danger} />
        <View style={{ flex: 1 }}>
          <Text size={14} color={foreground}>
            {INVALID_LINK_MESSAGE}
          </Text>
        </View>
      </HStack>
      <Button
        text={CANCEL_BUTTON_LABEL}
        variant="underline"
        size="compact"
        haptics
        accessibilityLabel={CANCEL_BUTTON_LABEL}
        onPress={close}
        style={{ alignSelf: 'center' }}
      />
    </VStack>
  );
}

function ConnectReview({
  parsed,
  close,
  pushCustomPage,
}: SignerConnectContentProps & { parsed: ParsedNostrConnectUri }): React.ReactElement {
  const [foreground, muted, warning, danger, dangerSoftFg] = useThemeColor([
    'foreground',
    'muted',
    'warning',
    'danger',
    'danger-soft-foreground',
  ] as const);
  const { keys } = useNostrKeysContext();
  const connection = useNip46ConnectionsStore((s) => s.apps[parsed.clientPubkey]);
  const activeProfile = useProfileStore((s) =>
    s.profiles.find((profile) => profile.accountIndex === s.activeAccountIndex)
  );

  const isUpdate = connection !== undefined;
  const appName = appDisplayName({ ...(parsed.name !== undefined && { name: parsed.name }) });
  const appDomain = parsed.url !== undefined ? safeHostname(parsed.url).unwrapOr(null) : null;

  const permRows = useMemo(() => permRowsFor(parsed), [parsed]);
  const cacheKey = checkedCacheKey(parsed);
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => checkedStateCache.get(cacheKey) ?? defaultCheckedFor(permRows, connection?.grants)
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);

  // Hot + awaited pairing for the life of the SHEET. Registration is
  // idempotent, so the resumed-pairing path (already registered at boot) and
  // a picker pop→remount both re-register harmlessly.
  useEffect(() => {
    useNip46RequestsStore.getState().setServiceHotRequested(true);
    const registered = nip46Engine.startNostrconnectPairing(parsed);
    if (registered.isErr()) {
      nostrLog.warn('nostr.signer.connect_sheet_register_failed', {
        error: registered.error.type,
      });
    }
    return () => releaseIfSheetClosed(parsed);
  }, [parsed]);

  const toggleRow = useCallback(
    (row: PermRow) => {
      if (!row.eligible) return;
      setChecked((current) => {
        const next = { ...current, [row.grantKey]: !current[row.grantKey] };
        checkedStateCache.set(cacheKey, next);
        return next;
      });
    },
    [cacheKey]
  );

  const connect = useSingleFlight(
    useCallback(async () => {
      setFailure(null);
      setIsConnecting(true);
      const acceptedGrantKeys = permRows
        .filter((row) => row.eligible && checked[row.grantKey] === true)
        .map((row) => row.grantKey);
      const outcome = await completePairingWhenHot({ parsed, acceptedGrantKeys });
      setIsConnecting(false);
      if (outcome.isErr()) {
        nostrLog.warn('nostr.signer.connect_sheet_pairing_failed', {
          error: outcome.error.type,
        });
        setFailure(failureFor(outcome.error));
        return;
      }
      checkedStateCache.delete(cacheKey);
      const toast = connectedToastCopy(appName);
      popup({ message: toast.label, text: toast.description, type: 'success' });
      close();
    }, [appName, cacheKey, checked, close, parsed, permRows])
  );

  const openProfilePicker = useCallback(() => {
    pushCustomPage('signer-profile-picker', { parsed });
  }, [parsed, pushCustomPage]);

  const profileDisplayName = resolveIdentityName({
    pubkey: activeProfile?.pubkey ?? keys?.pubkey ?? null,
    overrideName: activeProfile?.cachedDisplayName,
  });
  const profileNpub =
    keys !== null
      ? truncateMiddle(keys.npub, NPUB_TRUNCATE_CHARS)
      : activeProfile !== undefined
        ? truncatedNpubFor(activeProfile.pubkey)
        : '';

  const hasStrippedRows = permRows.some((row) => !row.eligible);
  const primaryLabel = isConnecting
    ? CONNECTING_BUTTON_LABEL
    : failure !== null
      ? TRY_AGAIN_BUTTON_LABEL
      : isUpdate
        ? UPDATE_PERMISSIONS_LABEL
        : CONNECT_BUTTON_LABEL;

  return (
    <VStack spacing={14} className="px-1 pb-2 pt-1">
      <BottomSheet.Title className="text-foreground text-lg font-bold">
        {isUpdate ? UPDATE_PERMISSIONS_LABEL : CONNECT_TITLE}
      </BottomSheet.Title>

      {/* App identity (app-supplied metadata — bounded, untrusted) */}
      <HStack spacing={12} align="center">
        <Avatar
          state={parsed.image !== undefined ? 'image' : 'fallback'}
          picture={parsed.image}
          seed={parsed.clientPubkey}
          fallbackVariant="beam"
          size={44}
          alt={appName}
        />
        <VStack spacing={2} style={{ flex: 1 }}>
          <Text size={16} bold color={foreground} numberOfLines={1}>
            {appName}
          </Text>
          <Text size={12} color={muted} numberOfLines={1}>
            {appDomain ?? truncateMiddle(parsed.clientPubkey, 8)}
          </Text>
        </VStack>
      </HStack>
      <SegmentedText segments={cautionSegments(appDomain ?? appName)} size={12} color={muted} />

      {/* Signing in as */}
      <VStack spacing={6}>
        <Text size={12} bold color={muted}>
          {SIGNING_IN_AS_LABEL}
        </Text>
        <HStack spacing={12} align="center">
          <Avatar
            state={activeProfile?.cachedPicture ? 'image' : 'fallback'}
            picture={activeProfile?.cachedPicture}
            seed={activeProfile?.pubkey ?? keys?.pubkey ?? 'sovran-profile'}
            fallbackVariant="beam"
            size={40}
            alt={profileDisplayName}
          />
          <VStack spacing={2} style={{ flex: 1 }}>
            <Text size={15} bold color={foreground} numberOfLines={1}>
              {profileDisplayName}
            </Text>
            {profileNpub.length > 0 ? (
              <Text size={12} color={muted} numberOfLines={1}>
                {profileNpub}
              </Text>
            ) : null}
          </VStack>
          <HerouiButton
            variant="secondary"
            size="sm"
            onPress={openProfilePicker}
            accessibilityLabel={CHANGE_LABEL}>
            <HerouiButton.Label>{CHANGE_LABEL}</HerouiButton.Label>
          </HerouiButton>
        </HStack>
      </VStack>

      {/* Requested permissions */}
      {permRows.length > 0 ? (
        <VStack spacing={10}>
          <Text size={12} bold color={muted}>
            {REQUESTING_LABEL}
          </Text>
          {permRows.map((row) => (
            <Pressable
              key={row.grantKey}
              haptics
              disabled={!row.eligible}
              accessibilityRole="checkbox"
              accessibilityState={{
                checked: checked[row.grantKey] === true,
                disabled: !row.eligible,
              }}
              accessibilityLabel={row.entry.permissionEditorLabel}
              onPress={() => toggleRow(row)}>
              <HStack
                spacing={10}
                align="center"
                style={!row.eligible ? { opacity: 0.55 } : undefined}>
                <SelectableCheck
                  selected={checked[row.grantKey] === true}
                  disabled={!row.eligible}
                  style="square"
                  variant={row.warning ? 'warning' : 'default'}
                />
                <Icon name={row.entry.icon} size={18} color={row.warning ? warning : muted} />
                <View style={{ flex: 1 }}>
                  <Text size={14} color={foreground} numberOfLines={1}>
                    {row.entry.permissionEditorLabel}
                  </Text>
                </View>
                {!row.eligible ? (
                  <Text size={12} bold color={muted}>
                    {ALWAYS_ASKS_LABEL}
                  </Text>
                ) : null}
              </HStack>
            </Pressable>
          ))}
          {hasStrippedRows ? (
            <Text size={12} color={muted} style={{ lineHeight: 17 }}>
              {STRIPPED_PERMS_NOTICE}
            </Text>
          ) : null}
          <Text size={12} color={muted} style={{ lineHeight: 17 }}>
            {UNCHECKED_CAPTION}
          </Text>
        </VStack>
      ) : null}

      {/* Inline failure state (relay unreachable / save failed) */}
      {failure !== null ? (
        <View className="bg-danger-soft rounded-2xl p-3">
          <HStack spacing={8} align="center">
            <Icon name="mdi:alert-circle" size={18} color={danger} />
            <View style={{ flex: 1 }}>
              <Text size={13} color={dangerSoftFg}>
                {failure === 'relays' ? RELAY_UNREACHABLE_MESSAGE : SAVE_FAILED_MESSAGE}
              </Text>
            </View>
          </HStack>
        </View>
      ) : null}

      {/* Footer */}
      <VStack spacing={10}>
        <HerouiButton
          variant="primary"
          className="bg-foreground"
          isDisabled={isConnecting}
          onPress={() => void connect()}>
          <HerouiButton.Label className="text-background">{primaryLabel}</HerouiButton.Label>
        </HerouiButton>
        <Button
          text={CANCEL_BUTTON_LABEL}
          variant="underline"
          size="compact"
          haptics
          accessibilityLabel={CANCEL_BUTTON_LABEL}
          onPress={close}
          style={{ alignSelf: 'center' }}
        />
      </VStack>
    </VStack>
  );
}

// ── 'signer-profile-picker' page ("Sign In As") ─────────────────

interface SignerProfilePickerContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['signer-profile-picker'];
}

export function SignerProfilePickerContent({
  payload,
  close,
  popCustomPage,
}: SignerProfilePickerContentProps): React.ReactElement {
  const { parsed } = payload;
  const [foreground, muted, warningSoftFg] = useThemeColor([
    'foreground',
    'muted',
    'warning-soft-foreground',
  ] as const);
  const profiles = useProfileStore((s) => s.profiles);
  const activeIndex = useProfileStore((s) => s.activeAccountIndex);
  const [selectedIndex, setSelectedIndex] = useState(activeIndex);

  const appName = appDisplayName({ ...(parsed.name !== undefined && { name: parsed.name }) });

  // Same sheet-scoped release as the root page: a pop back keeps everything,
  // a real close (including after Switch & Connect) releases it.
  useEffect(() => () => releaseIfSheetClosed(parsed), [parsed]);

  const selectProfile = useCallback(
    (profile: ProfileEntry) => {
      if (profile.accountIndex === activeIndex) {
        // Picking the current profile is "never mind" — back to the review.
        setSelectedIndex(activeIndex);
        popCustomPage();
        return;
      }
      setSelectedIndex(profile.accountIndex);
    },
    [activeIndex, popCustomPage]
  );

  const switchAndConnect = useSingleFlight(
    useCallback(async () => {
      const target = profiles.find((profile) => profile.accountIndex === selectedIndex);
      if (target === undefined || target.accountIndex === activeIndex) return;
      // The seam orders the teardown: intent persisted (awaited) → sheet
      // closed → restart-based switch. On an abort it shows the retry toast
      // and the sheet stays open for another attempt.
      await switchProfileAndPair(
        parsed,
        { accountIndex: target.accountIndex, pubkey: target.pubkey },
        close
      );
    }, [activeIndex, close, parsed, profiles, selectedIndex])
  );

  const showRestartWarning = selectedIndex !== activeIndex;

  return (
    <VStack spacing={14} className="px-1 pb-2 pt-1">
      <BottomSheet.Title className="text-foreground text-lg font-bold">
        {PICKER_TITLE}
      </BottomSheet.Title>

      <VStack spacing={4}>
        {profiles.map((profile) => {
          const displayName = resolveIdentityName({
            pubkey: profile.pubkey,
            overrideName: profile.cachedDisplayName,
          });
          const isSelected = profile.accountIndex === selectedIndex;
          return (
            <Pressable
              key={profile.accountIndex}
              haptics
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={displayName}
              onPress={() => selectProfile(profile)}>
              <HStack spacing={12} align="center" style={{ paddingVertical: 8 }}>
                <Avatar
                  state={profile.cachedPicture ? 'image' : 'fallback'}
                  picture={profile.cachedPicture}
                  seed={profile.pubkey}
                  fallbackVariant="beam"
                  size={40}
                  alt={displayName}
                />
                <VStack spacing={2} style={{ flex: 1 }}>
                  <Text size={15} bold color={foreground} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text size={12} color={muted} numberOfLines={1}>
                    {truncatedNpubFor(profile.pubkey)}
                  </Text>
                </VStack>
                {isSelected ? <Icon name="mdi:check-circle" size={20} color={foreground} /> : null}
              </HStack>
            </Pressable>
          );
        })}
      </VStack>

      {showRestartWarning ? (
        <VStack spacing={10}>
          <View className="bg-warning-soft rounded-2xl p-3">
            <VStack spacing={4}>
              <Text size={13} bold color={warningSoftFg}>
                {RESTART_WARNING_TITLE}
              </Text>
              <SegmentedText
                segments={restartWarningSegments(appName)}
                size={13}
                color={warningSoftFg}
              />
            </VStack>
          </View>
          <HerouiButton
            variant="primary"
            className="bg-foreground"
            onPress={() => void switchAndConnect()}>
            <HerouiButton.Label className="text-background">
              {SWITCH_AND_CONNECT_LABEL}
            </HerouiButton.Label>
          </HerouiButton>
        </VStack>
      ) : null}
    </VStack>
  );
}
