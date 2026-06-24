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

import React, { useEffect, useMemo, useState } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  BottomSheet,
  Button as HerouiButton,
  ListGroup,
  PressableFeedback,
  Separator,
  Switch as HeroSwitch,
} from 'heroui-native';
import { Result } from 'neverthrow';
import { nip19 } from 'nostr-tools';

import Icon from 'assets/icons';
import { SegmentedText, shortPubkey } from '@/features/nostrSigner/components/display';
import { safeHostname } from '@/features/nostrSigner/lib/boundedDisplay';
import {
  alwaysAllowEligible,
  appDisplayName,
  permissionEntryFor,
  type CopySegment,
  type PermissionCatalogEntry,
} from '@/features/nostrSigner/components/permissionCatalog';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { findPreviousConnection } from '@/features/nostrSigner/lib/connectionMatch';
import {
  nip46Engine,
  type Nip46EngineError,
  type CompleteNostrconnectPairingInput,
} from '@/features/nostrSigner/lib/nip46Engine';
import { isGrantKey, type GrantKey } from '@/features/nostrSigner/lib/nip46Types';
import { PERMISSION_BUNDLES } from '@/features/nostrSigner/lib/permissionBundles';
import {
  parseNostrconnectUri,
  type ParsedNostrConnectUri,
} from '@/features/nostrSigner/lib/nip46Uri';
import { presetGrantKeysExcluding } from '@/features/nostrSigner/lib/pairingPreset';
import { grantKeyFor, parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';
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
const RECONNECT_TITLE = 'Reconnect App';
const RECONNECT_BUTTON_LABEL = 'Reconnect';
const RECONNECT_SUMMARY =
  "You've connected this app before — your saved permissions will be restored.";
const REVIEW_PERMISSIONS_LABEL = 'Review permissions';
const ADOPT_CHANGED_MESSAGE =
  'This connection changed while you were reviewing it. Please try again.';
const SIGNING_IN_AS_LABEL = 'Signing in as';
const CHANGE_LABEL = 'Change';
const REQUESTING_LABEL = 'This app is requesting:';
const PRESET_TITLE = 'Allow common social actions';
const PRESET_DESCRIPTION =
  'Posts, reactions, reposts, follows, settings — never wallet or decrypts.';
const ALWAYS_ASKS_LABEL = 'Always asks';
const UNCHECKED_CAPTION = 'Unchecked permissions will ask you each time instead.';
const MIXED_REVIEW_CAPTION = 'Custom · tap to allow all';
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

const CENTER_SELF_STYLE = { alignSelf: 'center' } as const;
const FLEX_ONE_STYLE = { flex: 1 } as const;
const SUMMARY_TEXT_STYLE = { lineHeight: 20 } as const;
const CAPTION_TEXT_STYLE = { lineHeight: 17 } as const;
const INELIGIBLE_ROW_STYLE = { opacity: 0.55 } as const;
const EXPAND_PRESSABLE_STYLE = { padding: 4 } as const;
const PRESET_ROW_STYLE = { paddingLeft: 12 } as const;
const PROFILE_ROW_STYLE = { paddingVertical: 8 } as const;

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

/** "5 saved permissions · 2 decrypt contacts" (decrypt segment omitted at 0). */
function reconnectCountsLine(grantCount: number, decryptContactCount: number): string {
  const grants = `${grantCount} saved permission${grantCount === 1 ? '' : 's'}`;
  if (decryptContactCount === 0) return grants;
  return `${grants} · ${decryptContactCount} decrypt contact${decryptContactCount === 1 ? '' : 's'}`;
}

function blockedNoticeSegments(appName: string): CopySegment[] {
  return [
    { text: 'You blocked ' },
    { text: appName, bold: true },
    { text: ' before. Connecting again starts fresh.' },
  ];
}

function restartWarningSegments(appName: string): CopySegment[] {
  return [
    { text: 'The connection to ' },
    { text: appName, bold: true },
    { text: ' will continue automatically after the restart.' },
  ];
}

// ── Shared helpers ──────────────────────────────────────────────

const safeNpubEncode = Result.fromThrowable(
  (pubkeyHex: string) => nip19.npubEncode(pubkeyHex),
  () => 'invalid_pubkey' as const
);

const NPUB_TRUNCATE_CHARS = 12;

function truncatedNpubFor(pubkeyHex: string): string {
  const npub = safeNpubEncode(pubkeyHex).unwrapOr(pubkeyHex);
  return truncateMiddle(npub, NPUB_TRUNCATE_CHARS);
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
  const current = popupState.current;
  if (popupState.isOpen && isCustomSheetPayload(current) && current.sheetId === 'signer-connect') {
    // Only a same-pairing page swap (root ⇄ profile-picker) keeps everything.
    // A second nostrconnect URI that REPLACED this sheet's payload is a
    // different pairing, so `parsed` must still be released even though a
    // signer-connect sheet is technically up.
    const currentUri = (current.payload as ActionSheetPayloads['signer-connect']).uri;
    const currentParsed = parseNostrconnectUri(currentUri);
    if (currentParsed.isOk() && checkedCacheKey(currentParsed.value) === checkedCacheKey(parsed)) {
      return;
    }
  }
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

/**
 * "Common social actions" rows: the curated bundle minus anything the URI
 * already requested (URI rows keep their own presentation and defaults).
 * Every bundle key is always-allow-eligible by construction; the filter is
 * defense in depth against future bundle edits.
 */
function presetRowsFor(uriRows: readonly PermRow[]): PermRow[] {
  const covered = new Set<string>(uriRows.map((row) => row.grantKey));
  return presetGrantKeysExcluding(covered)
    .map((grantKey) => {
      const lookup = parseGrantKey(grantKey);
      const entry = permissionEntryFor(lookup);
      return {
        grantKey,
        entry,
        eligible: alwaysAllowEligible(lookup),
        warning: entry.tier === 'protected' || entry.tier === 'unknown',
      };
    })
    .filter((row) => row.eligible);
}

/** Switch row for the Reconnect review list — editor look, sheet-local. */
function ReviewSwitchRow({
  label,
  description,
  selected,
  onToggle,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const switchA11yState = {
    checked: selected,
  };
  return (
    <PressableFeedback
      animation={false}
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityState={switchA11yState}
      accessibilityLabel={label}>
      <PressableFeedback.Scale>
        <ListGroup.Item disabled>
          <ListGroup.ItemContent>
            <ListGroup.ItemTitle>{label}</ListGroup.ItemTitle>
            {description !== undefined ? (
              <ListGroup.ItemDescription>{description}</ListGroup.ItemDescription>
            ) : null}
          </ListGroup.ItemContent>
          <ListGroup.ItemSuffix>
            {/* Visual only — the row owns the press (the switch's own
                Pressable would swallow it). */}
            <View pointerEvents="none">
              <HeroSwitch isSelected={selected} />
            </View>
          </ListGroup.ItemSuffix>
        </ListGroup.Item>
      </PressableFeedback.Scale>
      <PressableFeedback.Ripple />
    </PressableFeedback>
  );
}

/**
 * Reconnect-variant checklist: the URI's eligible rows plus rows synthesized
 * from the PREVIOUS record's always-grants — so everything being restored is
 * reviewable. Deny grants get no row (the sheet has no deny affordance; they
 * carry via adoption and stay editable in the per-app editor).
 */
function reconnectRowsFor(uriRows: readonly PermRow[], previous: Nip46Connection): PermRow[] {
  const eligibleUriRows = uriRows.filter((row) => row.eligible);
  const covered = new Set<string>(eligibleUriRows.map((row) => row.grantKey));
  const extra: PermRow[] = [];
  for (const [grantKey, grant] of Object.entries(previous.grants)) {
    if (grant?.verdict !== 'always') continue;
    if (covered.has(grantKey)) continue;
    if (!isGrantKey(grantKey)) continue;
    const lookup = parseGrantKey(grantKey);
    if (!alwaysAllowEligible(lookup)) continue;
    const entry = permissionEntryFor(lookup);
    extra.push({
      grantKey,
      entry,
      eligible: true,
      warning: entry.tier === 'protected' || entry.tier === 'unknown',
    });
  }
  return [...eligibleUriRows, ...extra];
}

function defaultCheckedFor(
  rows: readonly PermRow[],
  existingGrants: Partial<Record<GrantKey, { verdict: string }>> | undefined,
  presetRows: readonly PermRow[] = []
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
  // Preset rows default ON for a FIRST pairing — that is the bundle's whole
  // point; sensitive-tier items (0, 3, 9734, encrypt) are deliberately
  // pre-checked inside an explicitly labeled, individually-uncheckable
  // bundle. On a re-pair, defaults mirror the standing grants so "Update
  // Permissions" never silently re-grants something the user removed.
  for (const row of presetRows) {
    checked[row.grantKey] =
      existingGrants === undefined ? true : existingGrants[row.grantKey]?.verdict === 'always';
  }
  return checked;
}

/**
 * Survives the root-page unmount caused by pushing the profile-picker page
 * (PopupHost renders only the top custom page). Keyed per pairing attempt;
 * dropped by `releaseIfSheetClosed` when the sheet actually closes.
 * `reviewPresented` is STICKY: once the Reconnect variant's checklist has
 * been opened, the rows count as presented for the whole attempt — collapsing
 * again must not retract edits the user made while it was open.
 */
interface CachedSheetState {
  checked: Record<string, boolean>;
  reviewPresented: boolean;
}

const checkedStateCache = new Map<string, CachedSheetState>();

/**
 * Per-attempt key: clientPubkey alone can't tell two pairing attempts from
 * the same client apart, but the raw secret must not sit in observable map
 * keys — a one-way fingerprint keeps attempts distinct without retaining it.
 */
function checkedCacheKey(parsed: ParsedNostrConnectUri): string {
  const secretFingerprint = bytesToHex(sha256(utf8ToBytes(parsed.secret))).slice(0, 16);
  return `${parsed.clientPubkey}:${secretFingerprint}`;
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

type ConnectFailure = 'relays' | 'save' | 'changed';

function failureFor(error: Nip46EngineError): ConnectFailure {
  if (error.type === 'adopt-failed') {
    return error.cause === 'inherit_mismatch' ? 'changed' : 'save';
  }
  return error.type === 'upsert-failed' ? 'save' : 'relays';
}

function failureMessageFor(failure: ConnectFailure): string {
  switch (failure) {
    case 'relays':
      return RELAY_UNREACHABLE_MESSAGE;
    case 'save':
      return SAVE_FAILED_MESSAGE;
    case 'changed':
      return ADOPT_CHANGED_MESSAGE;
  }
}

// ── Root sheet body ─────────────────────────────────────────────

interface SignerConnectContentProps extends CustomSheetSharedProps {
  payload: ActionSheetPayloads['signer-connect'];
}

export function SignerConnectSheetContent(props: SignerConnectContentProps): React.ReactElement {
  const parsedResult = parseNostrconnectUri(props.payload.uri);
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
        <View style={FLEX_ONE_STYLE}>
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
        style={CENTER_SELF_STYLE}
      />
    </VStack>
  );
}

function ConnectReview({
  parsed,
  close,
  pushCustomPage,
  setFooterConfig,
}: SignerConnectContentProps & { parsed: ParsedNostrConnectUri }): React.ReactElement {
  const [foreground, muted, warning, danger, dangerSoftFg] = useThemeColor([
    'foreground',
    'muted',
    'warning',
    'danger',
    'danger-soft-foreground',
  ] as const);
  const { keys } = useNostrKeysContext();
  // Whole map: the reconnect matcher scans all connections, not one key.
  const apps = useNip46ConnectionsStore((s) => s.apps);
  const connection = apps[parsed.clientPubkey];
  const activeProfile = useProfileStore((s) =>
    s.profiles.find((profile) => profile.accountIndex === s.activeAccountIndex)
  );

  const isUpdate = connection !== undefined;
  // Same app, NEW ephemeral client key? (Exact-pubkey update takes precedence;
  // the matcher is only a UX offer — the engine re-validates it at completion.)
  const match = isUpdate ? ({ kind: 'none' } as const) : findPreviousConnection(apps, parsed);
  const variant: 'update' | 'reconnect' | 'blocked-fresh' | 'fresh' = isUpdate
    ? 'update'
    : match.kind === 'active'
      ? 'reconnect'
      : match.kind === 'blocked'
        ? 'blocked-fresh'
        : 'fresh';
  const previousConnection = match.kind === 'none' ? undefined : match.connection;

  const appName = appDisplayName({ ...(parsed.name !== undefined && { name: parsed.name }) });
  const appDomain = parsed.url !== undefined ? safeHostname(parsed.url).unwrapOr(null) : null;

  const permRows = permRowsFor(parsed);
  // Reconnect hides the preset (the previous config replaces preset defaults).
  const presetRows = variant === 'reconnect' ? [] : presetRowsFor(permRows);
  const reviewRows =
    variant === 'reconnect' && previousConnection !== undefined
      ? reconnectRowsFor(permRows, previousConnection)
      : permRows;
  const cacheKey = checkedCacheKey(parsed);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const cached = checkedStateCache.get(cacheKey);
    if (cached !== undefined) return cached.checked;
    if (variant === 'reconnect' && previousConnection !== undefined) {
      return defaultCheckedFor(reviewRows, previousConnection.grants);
    }
    // Blocked previous → deliberate fresh start: nothing pre-checked from it.
    return defaultCheckedFor(permRows, connection?.grants, presetRows);
  });
  const [presetExpanded, setPresetExpanded] = useState(false);
  // Sticky for the attempt: once true, the reconnect rows count as presented.
  const [reviewPresented, setReviewPresented] = useState<boolean>(
    () => checkedStateCache.get(cacheKey)?.reviewPresented ?? false
  );
  const [reviewExpanded, setReviewExpanded] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [failure, setFailure] = useState<ConnectFailure | null>(null);

  const reviewToggleA11yState = {
    expanded: reviewExpanded,
  };
  const togglePresetExpanded = () => setPresetExpanded((value) => !value);

  const toggleReview = () => {
    setReviewExpanded((value) => !value);
    setReviewPresented(true);
    setChecked((current) => {
      checkedStateCache.set(cacheKey, { checked: current, reviewPresented: true });
      return current;
    });
  };

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

  const cacheChecked = (next: Record<string, boolean>) => {
    const cached = checkedStateCache.get(cacheKey);
    checkedStateCache.set(cacheKey, {
      checked: next,
      reviewPresented: cached?.reviewPresented ?? false,
    });
  };

  const toggleRow = (row: PermRow) => {
    if (!row.eligible) return;
    setChecked((current) => {
      const next = { ...current, [row.grantKey]: !current[row.grantKey] };
      cacheChecked(next);
      return next;
    });
  };

  // Review list speaks the editor's bundle vocabulary: one switch per
  // capability bundle (toggling covers every member key in the review set),
  // plus individual rows for unbundled keys.
  const reviewGroups = useMemo(() => {
    const byKey = new Map(reviewRows.map((row) => [row.grantKey, row]));
    const bundles = PERMISSION_BUNDLES.map((bundle) => ({
      bundle,
      rows: bundle.grantKeys
        .map((grantKey) => byKey.get(grantKey))
        .filter((row): row is PermRow => row !== undefined),
    })).filter(({ rows }) => rows.length > 0);
    const bundled = new Set(bundles.flatMap(({ rows }) => rows.map((row) => row.grantKey)));
    const others = reviewRows.filter((row) => !bundled.has(row.grantKey));
    return { bundles, others };
  }, [reviewRows]);

  const toggleReviewBundle = (rows: readonly PermRow[]) => {
    setChecked((current) => {
      const allOn = rows.every((row) => current[row.grantKey] === true);
      const next = { ...current };
      for (const row of rows) next[row.grantKey] = !allOn;
      cacheChecked(next);
      return next;
    });
  };

  const presetAllChecked = presetRows.every((row) => checked[row.grantKey] === true);
  const presetA11yState = {
    checked: presetAllChecked,
  };
  const togglePresetAll = () => {
    setChecked((current) => {
      const allOn = presetRows.every((row) => current[row.grantKey] === true);
      const next = { ...current };
      for (const row of presetRows) next[row.grantKey] = !allOn;
      cacheChecked(next);
      return next;
    });
  };

  const connect = useSingleFlight(async () => {
    setFailure(null);
    setIsConnecting(true);
    // Reconnect: grants arrive via ADOPTION, so a never-opened checklist
    // presents/accepts nothing (nothing can downgrade). Once the user has
    // opened "Review permissions" (sticky), the reviewed rows are the
    // contract — unchecking an inherited grant downgrades it post-adoption.
    // Other variants: URI rows + preset rows, one accepted/presented union.
    const eligibleRows =
      variant === 'reconnect'
        ? reviewPresented
          ? reviewRows
          : []
        : [...permRows.filter((row) => row.eligible), ...presetRows];
    const acceptedGrantKeys = eligibleRows
      .filter((row) => checked[row.grantKey] === true)
      .map((row) => row.grantKey);
    const presentedGrantKeys = eligibleRows.map((row) => row.grantKey);
    const outcome = await completePairingWhenHot({
      parsed,
      acceptedGrantKeys,
      presentedGrantKeys,
      ...(previousConnection !== undefined && {
        replacesClientPubkey: previousConnection.clientPubkey,
      }),
    });
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
  });

  const openProfilePicker = () => {
    pushCustomPage('signer-profile-picker', { parsed });
  };

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
      : variant === 'update'
        ? UPDATE_PERMISSIONS_LABEL
        : variant === 'reconnect'
          ? RECONNECT_BUTTON_LABEL
          : CONNECT_BUTTON_LABEL;

  // Connect/Cancel live in PopupHost's pinned footer (the sheet body
  // scrolls; the actions must not scroll away with it). Cleared on unmount
  // so the pushed profile-picker page gets a footer-free sheet.
  useEffect(() => {
    setFooterConfig({
      buttons: [
        {
          label: primaryLabel,
          onPress: () => void connect(),
          variant: 'primary',
          isDisabled: isConnecting,
        },
        { label: CANCEL_BUTTON_LABEL, onPress: close, variant: 'tertiary' },
      ],
    });
    return () => setFooterConfig(null);
  }, [setFooterConfig, primaryLabel, isConnecting, connect, close]);

  return (
    <VStack spacing={14} className="px-1 pb-2 pt-1">
      <BottomSheet.Title className="text-foreground text-lg font-bold">
        {variant === 'update'
          ? UPDATE_PERMISSIONS_LABEL
          : variant === 'reconnect'
            ? RECONNECT_TITLE
            : CONNECT_TITLE}
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
        <VStack spacing={2} style={FLEX_ONE_STYLE}>
          <Text size={16} bold color={foreground} numberOfLines={1}>
            {appName}
          </Text>
          <Text size={12} color={muted} numberOfLines={1}>
            {appDomain ?? shortPubkey(parsed.clientPubkey)}
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
          <VStack spacing={2} style={FLEX_ONE_STYLE}>
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

      {/* Blocked-before notice (metadata match on a blocked record) */}
      {variant === 'blocked-fresh' ? (
        <View className="bg-danger-soft rounded-2xl p-3">
          <HStack spacing={8} align="center">
            <Icon name="mdi:alert-circle" size={18} color={danger} />
            <View style={FLEX_ONE_STYLE}>
              <SegmentedText
                segments={blockedNoticeSegments(appName)}
                size={13}
                color={dangerSoftFg}
              />
            </View>
          </HStack>
        </View>
      ) : null}

      {/* Reconnect: minimal restore summary + opt-in review checklist */}
      {variant === 'reconnect' && previousConnection !== undefined ? (
        <VStack spacing={10}>
          <Text size={14} color={foreground} style={SUMMARY_TEXT_STYLE}>
            {RECONNECT_SUMMARY}
          </Text>
          <Text size={12} color={muted}>
            {reconnectCountsLine(
              Object.keys(previousConnection.grants).length,
              Object.keys(previousConnection.peerDecryptGrants).length
            )}
          </Text>
          <Pressable
            haptics
            accessibilityRole="button"
            accessibilityState={reviewToggleA11yState}
            accessibilityLabel={REVIEW_PERMISSIONS_LABEL}
            onPress={toggleReview}>
            <HStack spacing={4} align="center">
              <Text size={13} bold color={muted}>
                {REVIEW_PERMISSIONS_LABEL}
              </Text>
              <Icon
                name={reviewExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                size={16}
                color={muted}
              />
            </HStack>
          </Pressable>
          {reviewExpanded ? (
            <ListGroup variant="secondary">
              {reviewGroups.bundles.map(({ bundle, rows }, index) => {
                const allOn = rows.every((row) => checked[row.grantKey] === true);
                const anyOn = rows.some((row) => checked[row.grantKey] === true);
                return (
                  <React.Fragment key={bundle.id}>
                    {index > 0 ? <Separator className="mx-4" /> : null}
                    <ReviewSwitchRow
                      label={bundle.label}
                      description={anyOn && !allOn ? MIXED_REVIEW_CAPTION : undefined}
                      selected={allOn}
                      onToggle={() => toggleReviewBundle(rows)}
                    />
                  </React.Fragment>
                );
              })}
              {reviewGroups.others.map((row, index) => (
                <React.Fragment key={row.grantKey}>
                  {reviewGroups.bundles.length > 0 || index > 0 ? (
                    <Separator className="mx-4" />
                  ) : null}
                  <ReviewSwitchRow
                    label={row.entry.permissionEditorLabel}
                    selected={checked[row.grantKey] === true}
                    onToggle={() => toggleRow(row)}
                  />
                </React.Fragment>
              ))}
            </ListGroup>
          ) : null}
          {reviewExpanded ? (
            <Text size={12} color={muted} style={CAPTION_TEXT_STYLE}>
              {UNCHECKED_CAPTION}
            </Text>
          ) : null}
        </VStack>
      ) : null}

      {/* Requested permissions (hidden on Reconnect — the review list owns it) */}
      {variant !== 'reconnect' && permRows.length > 0 ? (
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
                style={!row.eligible ? INELIGIBLE_ROW_STYLE : undefined}>
                <SelectableCheck
                  selected={checked[row.grantKey] === true}
                  disabled={!row.eligible}
                  style="square"
                  variant={row.warning ? 'warning' : 'default'}
                />
                <Icon name={row.entry.icon} size={18} color={row.warning ? warning : muted} />
                <View style={FLEX_ONE_STYLE}>
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
            <Text size={12} color={muted} style={CAPTION_TEXT_STYLE}>
              {STRIPPED_PERMS_NOTICE}
            </Text>
          ) : null}
        </VStack>
      ) : null}

      {/* Common social actions preset (bundle minus URI-covered keys) */}
      {presetRows.length > 0 ? (
        <VStack spacing={10}>
          <Pressable
            haptics
            accessibilityRole="checkbox"
            accessibilityState={presetA11yState}
            accessibilityLabel={PRESET_TITLE}
            onPress={togglePresetAll}>
            <HStack spacing={10} align="center">
              <SelectableCheck selected={presetAllChecked} style="square" />
              <View style={FLEX_ONE_STYLE}>
                <Text size={14} bold color={foreground}>
                  {PRESET_TITLE}
                </Text>
                <Text size={12} color={muted}>
                  {PRESET_DESCRIPTION}
                </Text>
              </View>
              <Pressable
                haptics
                accessibilityRole="button"
                accessibilityLabel={presetExpanded ? 'Collapse list' : 'Expand list'}
                onPress={togglePresetExpanded}
                style={EXPAND_PRESSABLE_STYLE}>
                <Icon
                  name={presetExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                  size={20}
                  color={muted}
                />
              </Pressable>
            </HStack>
          </Pressable>
          {presetExpanded
            ? presetRows.map((row) => (
                <Pressable
                  key={row.grantKey}
                  haptics
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: checked[row.grantKey] === true }}
                  accessibilityLabel={row.entry.permissionEditorLabel}
                  onPress={() => toggleRow(row)}
                  style={PRESET_ROW_STYLE}>
                  <HStack spacing={10} align="center">
                    <SelectableCheck
                      selected={checked[row.grantKey] === true}
                      style="square"
                      variant={row.warning ? 'warning' : 'default'}
                    />
                    <Icon name={row.entry.icon} size={18} color={row.warning ? warning : muted} />
                    <View style={FLEX_ONE_STYLE}>
                      <Text size={14} color={foreground} numberOfLines={1}>
                        {row.entry.permissionEditorLabel}
                      </Text>
                    </View>
                  </HStack>
                </Pressable>
              ))
            : null}
        </VStack>
      ) : null}

      {variant !== 'reconnect' && (permRows.length > 0 || presetRows.length > 0) ? (
        <Text size={12} color={muted} style={CAPTION_TEXT_STYLE}>
          {UNCHECKED_CAPTION}
        </Text>
      ) : null}

      {/* Inline failure state (relay unreachable / save failed / changed) */}
      {failure !== null ? (
        <View className="bg-danger-soft rounded-2xl p-3">
          <HStack spacing={8} align="center">
            <Icon name="mdi:alert-circle" size={18} color={danger} />
            <View style={FLEX_ONE_STYLE}>
              <Text size={13} color={dangerSoftFg}>
                {failureMessageFor(failure)}
              </Text>
            </View>
          </HStack>
        </View>
      ) : null}
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

  const selectProfile = (profile: ProfileEntry) => {
    if (profile.accountIndex === activeIndex) {
      // Picking the current profile is "never mind" — back to the review.
      setSelectedIndex(activeIndex);
      popCustomPage();
      return;
    }
    setSelectedIndex(profile.accountIndex);
  };

  const switchAndConnect = useSingleFlight(async () => {
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
  });

  const onSwitchAndConnect = () => {
    void switchAndConnect();
  };

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
              <HStack spacing={12} align="center" style={PROFILE_ROW_STYLE}>
                <Avatar
                  state={profile.cachedPicture ? 'image' : 'fallback'}
                  picture={profile.cachedPicture}
                  seed={profile.pubkey}
                  fallbackVariant="beam"
                  size={40}
                  alt={displayName}
                />
                <VStack spacing={2} style={FLEX_ONE_STYLE}>
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
          <HerouiButton variant="primary" className="bg-foreground" onPress={onSwitchAndConnect}>
            <HerouiButton.Label className="text-background">
              {SWITCH_AND_CONNECT_LABEL}
            </HerouiButton.Label>
          </HerouiButton>
        </VStack>
      ) : null}
    </VStack>
  );
}
