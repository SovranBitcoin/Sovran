/**
 * @fileoverview `ContactRow` — the unified identity row.
 *
 * One row for every contact-shaped thing in the app (nostr profiles, mints,
 * bluetooth peers, geohash channels, self identities) rendered through
 * `ListRow`. Accepts the native shapes coming out of our stores and APIs so
 * callers don't adapt anything: use the `*Identity` factories below and the
 * component derives avatar, title, subtitle, stats pills, and the NIP-05 badge.
 *
 * Shape:  [avatar/iconCircle] [title (+CURRENT?) / subtitle / stats • NIP-05] [trailing]
 *
 * Multi-identity arrays handle composites — a mint that is also a nostr
 * profile (NUT-06 contact): pass `[mintIdentity(item), nostrIdentity(pubkey, profile)]`
 * and the row renders the mint's avatar/title/balance with the nostr identity
 * supplying reputation/followers pills + the NIP-05 pill at the end of the
 * accent line.
 *
 * Spec: see `docs/contact-row.md`.
 */

import { ReactNode, useEffect } from 'react';
import opacity from 'hex-color-opacity';
import type { MintListItem } from 'wallet';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { SelectableCheck } from '@/shared/ui/primitives/SelectableCheck';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { ListRow, type ListRowAvatar, type ListRowIconCircle } from '@/shared/ui/composed/ListRow';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import {
  RowStatsAccent,
  RowStatsAccentSkeleton,
  STAT_ICONS,
  STAT_COLOR_SOCIAL,
  STAT_COLOR_ERROR,
  type RowStat,
} from '@/shared/ui/composed/RowStatsAccent';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatCompact } from '@/shared/lib/number';
import { resolveIdentityName } from '@/shared/lib/identity';
import { formatRelative } from '@/shared/lib/date';
import { BLUETOOTH_ACCENT, CONNECTED_ACCENT } from '@/shared/lib/brandColors';
import { paymentLog } from '@/shared/lib/logger';

// ---------------------------------------------------------------------------
// Identity types
// ---------------------------------------------------------------------------

interface NostrProfileLike {
  name?: string;
  display_name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
  nip05?: string;
  nip05Valid?: boolean;
  about?: string;
  lud16?: string;
  /** Vertex reputation (0-100). Present on Nagg profile-search profiles; sparse elsewhere. */
  score?: number | null;
  followers?: number | null;
  follows?: number | null;
}

interface NostrIdentity {
  kind: 'nostr';
  pubkey: string;
  profile?: NostrProfileLike;
  score?: number;
  followerCount?: number;
  followingCount?: number;
  isLoadingProfile?: boolean;
  /** Membership in a trusted list (`PUBLIC_KEYS`). Renders `Avatar status="VERIFIED"`. */
  verified?: boolean;
}

/** Stats that a mint may carry — present on `MintListItem` and on lighter
 *  mint shapes (NUT-06 info, search results). Gated per-field so a mint
 *  known only by URL + name still works. */
interface MintStatFields {
  balance?: number;
  unit?: string;
  status?: 'available' | 'disabled';
  kymScore?: number;
  /** Count of reviews behind `kymScore`. Rendered as `(23)` next to the star. */
  reviewCount?: number;
  auditScore?: number;
  auditState?: string;
  /** Total auditor-observed mint+melt operations. Rendered as `(123)` next
   *  to the audit %. */
  auditTotalOps?: number;
  worksOffline?: boolean;
  contactFollowers?: number;
  contactReputation?: number;
  /** Units the mint can actually issue (keyset-backed). Badge renders only
   *  when the mint issues more than sat — an all-sat list stays clean. */
  supportedUnits?: string[];
}

interface MintIdentity {
  kind: 'mint';
  mintUrl: string;
  displayName: string;
  iconUrl?: string;
  stats?: MintStatFields;
}

interface BleIdentity {
  kind: 'ble';
  peerID: string;
  nickname?: string;
  picture?: string;
  /** Omit these fields when the caller supplies its own `subtitle` / `trailing`. */
  /** Cached announce-time reachability (true if announce arrived directly or
   *  we had a direct link at announce time). Use `hasDirectLink` for truthful
   *  real-time reachability — `isConnected` can stay true after the BLE link
   *  silently dies. */
  isConnected?: boolean;
  /** Real-time peripheral/central link check. When false but `isConnected`
   *  is true, the peer is mesh-reachable only — DMs will mesh-flood with a
   *  15s spool fallback and may not arrive. */
  hasDirectLink?: boolean;
  lastSeen?: number;
  /** Preferred identicon/word-pair seed (e.g. the peer's announced noise
   *  key — stable across nickname changes); falls back to `peerID`. */
  identitySeed?: string;
}

interface GeohashIdentity {
  kind: 'geohash';
  geohash: string;
  label?: string;
  displayName?: string;
  /** Only `'ble'` triggers the "Nearby via Bluetooth mesh" subtitle; everything
   *  else is a geohash chat channel. */
  transport: 'ble' | 'nostr' | 'geohash';
  icon?: string;
}

interface SelfIdentity {
  kind: 'self';
  pubkey: string;
  nickname: string;
  avatarUrl?: string;
  isActive: boolean;
  subtitle?: string;
}

export type Identity = NostrIdentity | MintIdentity | BleIdentity | GeohashIdentity | SelfIdentity;

type StatKey =
  'balance' | 'units' | 'score' | 'audit' | 'reputation' | 'followers' | 'offline' | 'connection';

// ---------------------------------------------------------------------------
// Factories — keep call sites from re-typing `kind:` + field plumbing.
// ---------------------------------------------------------------------------

export function nostrIdentity(
  pubkey: string,
  profile?: NostrProfileLike,
  opts?: { isLoadingProfile?: boolean; verified?: boolean }
): NostrIdentity {
  const score = typeof profile?.score === 'number' ? profile.score : undefined;
  const followerCount = typeof profile?.followers === 'number' ? profile.followers : undefined;
  const followingCount = typeof profile?.follows === 'number' ? profile.follows : undefined;

  return {
    kind: 'nostr',
    pubkey,
    profile,
    score,
    followerCount,
    followingCount,
    isLoadingProfile: opts?.isLoadingProfile,
    verified: opts?.verified,
  };
}

/** Overload: accept either a full `MintListItem` or a minimal shape. */
export function mintIdentity(item: MintListItem): MintIdentity;
export function mintIdentity(input: {
  mintUrl: string;
  displayName: string;
  iconUrl?: string;
  stats?: MintStatFields;
}): MintIdentity;
export function mintIdentity(
  input:
    | MintListItem
    | { mintUrl: string; displayName: string; iconUrl?: string; stats?: MintStatFields }
): MintIdentity {
  if ('balance' in input) {
    const {
      mintUrl,
      displayName,
      iconUrl,
      balance,
      unit,
      status,
      kymScore,
      reviewCount,
      auditScore,
      auditState,
      auditTotalOps,
      worksOffline,
      contactFollowers,
      contactReputation,
      supportedUnits,
    } = input;
    return {
      kind: 'mint',
      mintUrl,
      displayName,
      iconUrl,
      stats: {
        balance,
        unit,
        status,
        kymScore,
        reviewCount,
        auditScore,
        auditState,
        auditTotalOps,
        worksOffline,
        contactFollowers,
        contactReputation,
        supportedUnits,
      },
    };
  }
  return { kind: 'mint', ...input };
}

export function bleIdentity(peer: {
  peerID: string;
  nickname?: string;
  picture?: string;
  isConnected?: boolean;
  hasDirectLink?: boolean;
  lastSeen?: number;
  /** Preferred identicon/word-pair seed (e.g. the announced noise key). */
  identitySeed?: string;
}): BleIdentity {
  return { kind: 'ble', ...peer };
}

export function geohashIdentity(
  geohash: string,
  opts?: {
    label?: string;
    displayName?: string;
    transport?: 'ble' | 'nostr' | 'geohash';
    icon?: string;
  }
): GeohashIdentity {
  return {
    kind: 'geohash',
    geohash,
    label: opts?.label,
    displayName: opts?.displayName,
    transport: opts?.transport ?? 'geohash',
    icon: opts?.icon,
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContactRowProps {
  /** One identity, or an array for composites (e.g. mint + nostr). */
  identity: Identity | Identity[];

  title?: string;
  /** Rendered inline at the end of the title row, right-aligned next to the
   *  name (e.g. a relative last-message timestamp on the conversation list). */
  titleTrailing?: ReactNode;
  /** `null` suppresses the subtitle entirely (pairs with `hideMetadata` for
   *  replies-mode: show the last message, hide the stat pills). */
  subtitle?: string | ReactNode | null;
  hideMetadata?: boolean;
  /** Default `true`. Set `false` to omit the NIP-05 pill even when present. */
  showNip05?: boolean;

  /** Declarative stat picker. Omit to use the kind's default. Order preserved,
   *  stats with no data drop out silently. */
  stats?: readonly StatKey[];

  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  selectionVariant?: 'circle-check' | 'checkbox';

  /** Forwarded to ListRow. `'below'` moves the stats row beneath the
   *  main HStack, indented past the avatar — used by the Select Mint row. */
  accentPosition?: 'inline' | 'below';

  /** Full trailing override; beats every variant / kind default. */
  trailing?: ReactNode;
  /** Set when a `trailing` override is its own tappable control on a row
   *  that also has `onPress` — forwarded to ListRow so the row's ripple
   *  overlay doesn't swallow the button's taps. Auto-set for the built-in
   *  inspect button. */
  trailingInteractive?: boolean;
  trailingVariant?: 'chevron' | 'spinner' | 'none';

  onPress?: () => void;
  loading?: boolean;
  /** Animate the stat-accent values (cached→fresh roll-in). Mint rows only;
   *  the accent is keyed by mintUrl so a recycled cell never rolls a neighbour's
   *  value. Default off keeps every other row byte-identical. */
  animate?: boolean;
  disabled?: boolean;
  disabledReason?: string;

  padding?: 'default' | 'compact';
  testID?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AVATAR_SIZE = 44;

/**
 * Deterministic skeleton-width sets. Each entry is an invisible string
 * passed to `<Text loading placeholder>` to size the loading bar — its
 * actual characters never render, only the width matters. Real names and
 * NIP-05 handles vary in length, so picking from a few realistic widths
 * per row makes a list of skeletons feel like a real list rather than a
 * row of identical bars.
 */
const TITLE_PLACEHOLDER_WIDTHS = [
  'NameNm', // ~6 chars
  'Username', // ~8 chars
  'Casual Name', // ~11 chars
  'A longer display name', // ~21 chars
  'Twelve chars', // ~12 chars
  'Short ID', // ~8 chars
  'A medium length nm', // ~18 chars
] as const;

const SUBTITLE_PLACEHOLDER_WIDTHS = [
  'name@relay.example',
  'short note',
  'medium length subtitle text',
  'twentyfour char subtitle',
  'a longer last-message preview line',
  'short@nip05',
  'a NIP-05-ish handle@relay.example.com',
] as const;

/** Cheap, stable, non-cryptographic hash for picking deterministic skeleton
 *  widths from a seed (pubkey, mintUrl, etc.). Same seed → same widths
 *  across re-renders, so the skeletons don't flicker between sizes. */
function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickPlaceholder(seed: string | undefined, options: readonly string[]): string {
  if (!seed || options.length === 0) return options[0] ?? '';
  return options[hashSeed(seed) % options.length];
}

const DEFAULT_STATS_BY_KIND: Record<Identity['kind'], readonly StatKey[]> = {
  // `following` is intentionally absent: the count lands in a narrow accent
  // row where a second "people" number alongside followers doesn't earn its
  // space. UserProfileScreen still shows it on the full profile header.
  nostr: ['reputation', 'followers'],
  mint: ['units', 'score', 'audit', 'reputation', 'followers', 'offline'],
  ble: [],
  geohash: [],
  self: [],
};

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

function find<K extends Identity['kind']>(
  ids: Identity[],
  kind: K
): Extract<Identity, { kind: K }> | undefined {
  return ids.find((i): i is Extract<Identity, { kind: K }> => i.kind === kind);
}

function derivePicture(ids: Identity[]): string | undefined {
  return (
    find(ids, 'mint')?.iconUrl ??
    find(ids, 'nostr')?.profile?.picture ??
    find(ids, 'nostr')?.profile?.image ??
    find(ids, 'self')?.avatarUrl ??
    find(ids, 'ble')?.picture
  );
}

function deriveSeed(ids: Identity[]): string | undefined {
  const mint = find(ids, 'mint');
  if (mint) return mint.mintUrl;
  const nostr = find(ids, 'nostr');
  if (nostr) return nostr.pubkey;
  const self = find(ids, 'self');
  if (self) return self.pubkey;
  const ble = find(ids, 'ble');
  if (ble) return ble.identitySeed ?? ble.peerID;
  const geohash = find(ids, 'geohash');
  if (geohash) return geohash.geohash;
  return undefined;
}

function deriveName(ids: Identity[]): string | undefined {
  const mint = find(ids, 'mint');
  const nostr = find(ids, 'nostr');
  const self = find(ids, 'self');
  const ble = find(ids, 'ble');
  const geohash = find(ids, 'geohash');

  const resolved = resolveIdentityName({
    mintName: mint?.displayName,
    nostrProfile: nostr?.profile,
    bleNickname: self?.nickname ?? ble?.nickname,
    overrideName: geohash?.label ?? geohash?.displayName,
    pubkey: nostr?.pubkey ?? self?.pubkey ?? ble?.peerID,
  });

  // The helper always returns a string. When the row is a pure-geohash
  // row with no pubkey or label, return undefined so deriveTitleFallback
  // can produce the `#geohash` form.
  if (resolved === 'Unknown') return undefined;
  return resolved;
}

function deriveTitleFallback(ids: Identity[]): string | undefined {
  const nostr = find(ids, 'nostr');
  if (nostr?.pubkey) return nostr.pubkey.slice(0, 12) + '...';
  const self = find(ids, 'self');
  if (self?.pubkey) return self.pubkey.slice(0, 12) + '...';
  const ble = find(ids, 'ble');
  if (ble?.peerID) return ble.peerID.slice(0, 12);
  const geohash = find(ids, 'geohash');
  if (geohash?.geohash) return `#${geohash.geohash}`;
  return undefined;
}

/** Default subtitle per kind. Nostr identities leave it empty — their
 *  second line is the NIP-05 pill on the accent row. Mint identities
 *  render balance via AmountFormatter in the component body. */
function deriveSubtitle(ids: Identity[]): string | undefined {
  const ble = find(ids, 'ble');
  if (ble) {
    if (ble.isConnected === undefined) return undefined;
    // Three states the user actually cares about for DM reachability:
    //  - direct link → DM goes straight over BLE
    //  - mesh-only  → reachable but DMs may stall / drop in spool window
    //  - offline    → last-seen timestamp
    const suffix = !ble.isConnected
      ? `seen ${typeof ble.lastSeen === 'number' ? formatRelative(ble.lastSeen, 'verbose') : 'recently'}`
      : ble.hasDirectLink
        ? 'connected'
        : 'mesh-only';
    return `#${ble.peerID.slice(0, 8)} · ${suffix}`;
  }
  const geohash = find(ids, 'geohash');
  if (geohash) {
    if (geohash.transport === 'ble') return 'Nearby via Bluetooth mesh';
    return geohash.displayName
      ? `~${geohash.displayName} · #${geohash.geohash}`
      : `#${geohash.geohash}`;
  }
  const self = find(ids, 'self');
  return self?.subtitle;
}

/** Compose the accent pill list. Missing values drop out; in a mint+nostr
 *  composite, nostr fields take precedence over mint fallbacks (contactReputation,
 *  contactFollowers) for reputation / followers. */
function buildStats(
  ids: Identity[],
  keys: readonly StatKey[],
  tints: { warning: string; success: string }
): RowStat[] {
  const mintStats = find(ids, 'mint')?.stats;
  const nostr = find(ids, 'nostr');
  const ble = find(ids, 'ble');

  const out: RowStat[] = [];

  for (const key of keys) {
    switch (key) {
      case 'balance':
        if (typeof mintStats?.balance === 'number' && mintStats.balance > 0) {
          out.push({
            icon: 'solar:wallet-bold',
            value: formatCompact(mintStats.balance),
            color: STAT_COLOR_SOCIAL,
          });
        }
        break;
      case 'units': {
        // Only multi-currency mints get the badge — "BTC" on every row of an
        // all-sat list is noise. Keyset-backed, so an advertised-but-keyless
        // unit (chorus usd) never shows here.
        const units = mintStats?.supportedUnits;
        if (units && units.length > 1) {
          const label = units
            .map((unit) => (unit.toLowerCase() === 'sat' ? 'BTC' : unit.toUpperCase()))
            .join('·');
          out.push({
            icon: 'ph:coins',
            value: label,
            color: STAT_COLOR_SOCIAL,
            accessibilityLabel: `Issues ${label}`,
          });
        }
        break;
      }
      case 'score':
        if (typeof mintStats?.kymScore === 'number') {
          const v = mintStats.kymScore;
          const count = mintStats.reviewCount;
          out.push({
            icon: STAT_ICONS.score,
            value: v % 1 === 0 ? String(v) : v.toFixed(1),
            meta: typeof count === 'number' && count > 0 ? formatCompact(count) : undefined,
            color: tints.warning,
            accessibilityLabel:
              typeof count === 'number'
                ? `Rating ${v} out of 5 from ${count} reviews`
                : `Rating ${v} out of 5`,
          });
        }
        break;
      case 'audit':
        if (typeof mintStats?.auditScore === 'number') {
          const pct = Math.round((mintStats.auditScore / 5) * 100);
          const total = mintStats.auditTotalOps;
          out.push({
            icon: STAT_ICONS.audit,
            value: `${pct}%`,
            // Mirrors the score case: show the operation count in brackets so
            // the user knows whether the % comes from 12 ops or 12,000.
            meta: typeof total === 'number' && total > 0 ? formatCompact(total) : undefined,
            color: mintStats.auditState === 'ERROR' ? STAT_COLOR_ERROR : tints.success,
            accessibilityLabel:
              typeof total === 'number'
                ? `Audit success ${pct}% across ${total} operations`
                : `Audit success ${pct}%`,
          });
        }
        break;
      case 'reputation': {
        const r = nostr?.score ?? mintStats?.contactReputation;
        if (typeof r === 'number' && r > 0) {
          out.push({
            icon: STAT_ICONS.reputation,
            value: `${Math.round(r)}`,
            color: STAT_COLOR_SOCIAL,
            accessibilityLabel: `Reputation score ${Math.round(r)}`,
          });
        }
        break;
      }
      case 'followers': {
        const f = nostr?.followerCount ?? mintStats?.contactFollowers;
        if (typeof f === 'number' && f > 0) {
          out.push({
            icon: STAT_ICONS.followers,
            value: formatCompact(f),
            color: STAT_COLOR_SOCIAL,
            accessibilityLabel: `${f} followers`,
          });
        }
        break;
      }
      case 'offline':
        if (mintStats?.worksOffline === true) {
          out.push({ icon: STAT_ICONS.offline, value: 'Offline', color: tints.success });
        }
        break;
      case 'connection':
        if (ble && ble.isConnected !== undefined) {
          // Three-state badge: direct link (green), mesh-only (warning), offline.
          // The mesh-only state is the one users find confusing — peer shows
          // up but DMs are flaky. Calling it out by icon + word avoids that.
          const meshOnly = ble.isConnected && ble.hasDirectLink === false;
          out.push({
            icon: ble.isConnected
              ? meshOnly
                ? 'mdi:lan-disconnect'
                : 'mdi:broadcast'
              : 'mdi:clock-outline',
            value: !ble.isConnected
              ? typeof ble.lastSeen === 'number'
                ? formatRelative(ble.lastSeen, 'verbose')
                : 'Offline'
              : meshOnly
                ? 'Mesh-only'
                : 'Connected',
            color: ble.isConnected
              ? meshOnly
                ? tints.warning
                : CONNECTED_ACCENT
              : STAT_COLOR_SOCIAL,
          });
        }
        break;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------

export function ContactRow({
  identity,
  title: titleOverride,
  titleTrailing,
  subtitle: subtitleOverride,
  hideMetadata = false,
  showNip05 = true,
  stats: statsOverride,
  selectable = false,
  selected = false,
  onToggle,
  selectionVariant = 'circle-check',
  accentPosition,
  trailing: trailingOverride,
  trailingInteractive = false,
  trailingVariant,
  onPress,
  loading,
  animate = false,
  disabled = false,
  disabledReason,
  padding = 'default',
  testID,
}: ContactRowProps) {
  // Stat tints intentionally diverge from the theme `success` token: the
  // app-wide retint moved `--success` to blue (see themeEngine.ts), but the
  // audit-%/offline pills read more clearly as "good" in green. Other
  // success surfaces (StatusToast, Badge, etc.) still consume the blue tint.
  const [foreground, accent, success, warning] = useThemeColor([
    'foreground',
    'accent',
    'green-300',
    'yellow-300',
  ] as const);

  const identities = Array.isArray(identity) ? identity : [identity];
  const primary = identities[0];
  const nostr = find(identities, 'nostr');
  const mint = find(identities, 'mint');
  const self = find(identities, 'self');
  const ble = find(identities, 'ble');
  const geohash = find(identities, 'geohash');
  const identityKinds = identities.map((item) => item.kind);
  const identityKindList = identityKinds.join(',');
  const mintUrlLength = mint?.mintUrl.length ?? 0;
  const mintDisplayNameLength = mint?.displayName.length ?? 0;
  const mintStats = mint?.stats;
  const hasMintBalance = typeof mintStats?.balance === 'number';
  const mintBalance = hasMintBalance ? mintStats.balance : null;

  const resolvedLoading = loading ?? nostr?.isLoadingProfile ?? false;

  // ---- Leading ----------------------------------------------------------

  const picture = derivePicture(identities);
  const seed = deriveSeed(identities);
  const name = deriveName(identities);
  const avatarState = resolvedLoading ? 'loading' : picture ? 'image' : 'fallback';

  let leadingNode: ReactNode | undefined;
  let avatarProp: ListRowAvatar | undefined;
  let iconCircleProp: ListRowIconCircle | undefined;

  if (mint) {
    leadingNode = (
      <MintIcon iconUrl={mint.iconUrl} name={name} size={AVATAR_SIZE} isLoading={resolvedLoading} />
    );
  } else if (nostr?.verified) {
    // Routes through `leading` so Avatar's `status` prop survives — ListRow's
    // `avatar` slot doesn't expose it.
    leadingNode = (
      <Avatar
        state={avatarState}
        picture={picture}
        seed={seed}
        name={name}
        status="VERIFIED"
        size={AVATAR_SIZE}
      />
    );
  } else if (nostr || self || ble || picture) {
    avatarProp = { picture, seed, name, size: AVATAR_SIZE, state: avatarState };
  } else if (geohash) {
    const isBleTier = geohash.transport === 'ble';
    iconCircleProp = {
      icon: geohash.icon ?? 'mdi:pound',
      color: isBleTier ? BLUETOOTH_ACCENT : accent,
    };
  }

  // ---- Title ------------------------------------------------------------

  const titleBase = titleOverride ?? name;
  const titleFallback = deriveTitleFallback(identities);
  const isCurrentSelf = !!self?.isActive;

  // While loading, keep the title a plain string so ListRow renders the title
  // *skeleton* (a node title bypasses the placeholder, which would otherwise
  // leak the deterministic word-pair name as a fake "loaded" name). The CURRENT
  // badge / titleTrailing decorations only make sense once real data is in.
  let titleNode: string | ReactNode | undefined = titleBase;
  if (resolvedLoading) {
    titleNode = titleBase;
  } else if (isCurrentSelf && titleBase) {
    titleNode = (
      <HStack align="center" spacing={8}>
        <Text size={16} bold numberOfLines={1} color={foreground}>
          {titleBase}
        </Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 10,
            backgroundColor: opacity(accent, 0.15),
          }}>
          <Text size={11} bold style={{ color: accent }}>
            CURRENT
          </Text>
        </View>
      </HStack>
    );
  } else if (titleTrailing != null && titleBase) {
    // Name on the left (ellipsizes), titleTrailing (e.g. relative date) pinned
    // to the right edge of the title column.
    titleNode = (
      <HStack align="center" style={{ justifyContent: 'space-between', gap: 8 }}>
        <Text size={16} bold numberOfLines={1} color={foreground} style={{ flexShrink: 1 }}>
          {titleBase}
        </Text>
        {titleTrailing}
      </HStack>
    );
  }

  // ---- Subtitle ---------------------------------------------------------

  let subtitleNode: string | ReactNode | undefined;
  if (subtitleOverride === null) {
    subtitleNode = undefined;
  } else if (subtitleOverride !== undefined) {
    subtitleNode = subtitleOverride as string | ReactNode;
  } else if (mint && typeof mint.stats?.balance === 'number' && mint.stats.unit) {
    subtitleNode = (
      <AmountFormatter
        amount={mint.stats.balance}
        unit={mint.stats.unit}
        size={14}
        weight="heavy"
        color={foreground}
      />
    );
  } else {
    subtitleNode = deriveSubtitle(identities);
  }

  // ---- Accent (stats + NIP-05) -----------------------------------------

  const statKeys = statsOverride ?? DEFAULT_STATS_BY_KIND[primary.kind];
  const statKeyList = statKeys.join(',');
  const statList: RowStat[] =
    hideMetadata || resolvedLoading ? [] : buildStats(identities, statKeys, { warning, success });

  // While loading, a row that will show an inline stats accent once loaded must
  // reserve that line's height or the row grows when the pills arrive. Gate to
  // mint rows (which reliably show a score/audit pill) and callers that asked
  // for explicit stats — nostr rows often have no accent, so reserving theirs
  // would over-shoot and shift the other way. Plain contact/ble/geohash
  // skeletons are unaffected.
  const reserveAccent =
    resolvedLoading &&
    !hideMetadata &&
    (!!mint || (statsOverride != null && statsOverride.length > 0));

  const nip05 =
    showNip05 && !hideMetadata && !resolvedLoading && nostr?.profile?.nip05
      ? { handle: nostr.profile.nip05 }
      : undefined;
  const hasNip05 = !!nip05;

  const accentNode = reserveAccent ? (
    <RowStatsAccentSkeleton seed={seed} />
  ) : (
    // Key by mintUrl so a FlashList cell recycled from mint A→B remounts the
    // stat pills (fresh first-render → no spurious roll); a same-mint
    // cached→live value change keeps the key stable and animates.
    <RowStatsAccent
      key={mint?.mintUrl ?? seed}
      stats={statList}
      note={disabledReason}
      nip05={nip05}
      animate={animate && !!mint}
    />
  );

  // ---- Trailing ---------------------------------------------------------

  const chevronNode = <Icon name="mdi:chevron-right" size={24} color={opacity(foreground, 0.25)} />;

  const selectionNode = selectable ? (
    resolvedLoading ? (
      // Reserve the control's exact 24px slot while loading without flashing an
      // interactive checkbox (mirrors PostCardGutterHeader's empty-box approach).
      <View style={{ width: 24, height: 24 }} />
    ) : (
      <SelectableCheck
        style={selectionVariant === 'checkbox' ? 'square' : 'circle'}
        selected={selected ?? false}
        onChange={selectionVariant === 'checkbox' ? () => onToggle?.() : undefined}
        size={24}
        variant="success"
      />
    )
  ) : null;

  const logMintInteraction = (
    event: 'contact_row.mint.inspect_press' | 'contact_row.mint.press'
  ) => {
    if (!mint) return;
    paymentLog.info(event, {
      identityCount: identities.length,
      identityKinds: identityKindList,
      primaryKind: primary.kind,
      mintUrlLength,
      displayNameLength: mintDisplayNameLength,
      hasIconUrl: !!mint.iconUrl,
      hasBalance: hasMintBalance,
      balance: mintBalance,
      unit: mintStats?.unit ?? null,
      status: mintStats?.status ?? null,
      worksOffline: mintStats?.worksOffline ?? null,
      statCount: statList.length,
      statKeys: statKeyList,
      resolvedLoading,
      selectable,
      selected,
      disabled,
      hasOnPress: !!onPress,
      hasOnToggle: !!onToggle,
    });
  };

  const inspectNode = null;

  // Trailing badge mirrors the same three-state model the subtitle uses so
  // the row's right edge is honest about DM reachability:
  //  - direct  → green broadcast icon ("ready to DM")
  //  - mesh    → warning lan-disconnect icon ("DM may stall")
  //  - offline → faded clock ("last seen…")
  const bleConnectionNode =
    ble && ble.isConnected !== undefined ? (
      !ble.isConnected ? (
        <Icon name="mdi:clock-outline" size={20} color={opacity(foreground, 0.3)} />
      ) : ble.hasDirectLink === false ? (
        <Icon name="mdi:lan-disconnect" size={20} color={warning} />
      ) : (
        <Icon name="mdi:broadcast" size={20} color={CONNECTED_ACCENT} />
      )
    ) : null;

  let trailingNode: ReactNode;
  let trailingSource: string;
  let trailingIsInteractive = trailingInteractive;
  if (trailingOverride !== undefined) {
    trailingNode = trailingOverride;
    trailingSource = 'override';
  } else if (selectable) {
    trailingNode = selectionNode;
    trailingSource = 'selection';
  } else if (trailingVariant === 'spinner') {
    trailingNode = <Spinner size={20} />;
    trailingSource = 'spinner';
  } else if (trailingVariant === 'chevron') {
    trailingNode = chevronNode;
    trailingSource = 'chevron';
  } else if (trailingVariant === 'none') {
    trailingNode = null;
    trailingSource = 'none';
  } else if (inspectNode) {
    trailingNode = inspectNode;
    trailingSource = 'inspect';
    trailingIsInteractive = true;
  } else if (geohash) {
    trailingNode = chevronNode;
    trailingSource = 'geohash-chevron';
  } else if (bleConnectionNode) {
    trailingNode = bleConnectionNode;
    trailingSource = 'ble-connection';
  } else {
    trailingNode = null;
    trailingSource = 'empty';
  }

  // ---- Interaction ------------------------------------------------------

  const effectivePress = onPress ?? (selectable ? () => onToggle?.() : undefined);
  const trackedPress =
    mint && effectivePress
      ? () => {
          logMintInteraction('contact_row.mint.press');
          effectivePress();
        }
      : effectivePress;

  // ---- Skeleton width variation ----------------------------------------
  // When the row is in its loading state, pick deterministic title /
  // subtitle widths from the seed (pubkey / mintUrl / etc.) so a list of
  // pending rows reads as a list rather than a stamped grid. The chosen
  // string is invisible — only its rendered width matters.
  const titlePlaceholder = resolvedLoading
    ? pickPlaceholder(seed, TITLE_PLACEHOLDER_WIDTHS)
    : undefined;
  const subtitlePlaceholder = resolvedLoading
    ? pickPlaceholder(seed, SUBTITLE_PLACEHOLDER_WIDTHS)
    : undefined;

  const subtitleSource =
    subtitleOverride === null
      ? 'suppressed'
      : subtitleOverride !== undefined
        ? typeof subtitleOverride === 'string'
          ? 'override-string'
          : 'override-node'
        : mint && hasMintBalance && mintStats?.unit
          ? 'mint-balance'
          : 'derived';

  useEffect(() => {
    if (!mint) return;
    paymentLog.debug('contact_row.mint.render', {
      identityCount: identities.length,
      identityKinds: identityKindList,
      primaryKind: primary.kind,
      mintUrlLength,
      displayNameLength: mintDisplayNameLength,
      hasIconUrl: !!mint.iconUrl,
      hasBalance: hasMintBalance,
      balance: mintBalance,
      unit: mintStats?.unit ?? null,
      status: mintStats?.status ?? null,
      kymScore: mintStats?.kymScore ?? null,
      reviewCount: mintStats?.reviewCount ?? null,
      auditScore: mintStats?.auditScore ?? null,
      auditState: mintStats?.auditState ?? null,
      auditTotalOps: mintStats?.auditTotalOps ?? null,
      worksOffline: mintStats?.worksOffline ?? null,
      supportedUnits: mintStats?.supportedUnits?.join(',') ?? null,
      contactFollowers: mintStats?.contactFollowers ?? null,
      contactReputation: mintStats?.contactReputation ?? null,
      hasNostrCompanion: !!nostr,
      hasBleCompanion: !!ble,
      hasSelfCompanion: !!self,
      hasGeohashCompanion: !!geohash,
      resolvedLoading,
      hideMetadata,
      showNip05,
      statKeys: statKeyList,
      statCount: statList.length,
      hasNip05,
      subtitleSource,
      trailingSource,
      accentPosition: accentPosition ?? null,
      selectable,
      selected,
      disabled,
      disabledReasonLength: disabledReason?.length ?? 0,
      padding,
      hasOnPress: !!onPress,
      hasOnToggle: !!onToggle,
      hasTitleOverride: titleOverride !== undefined,
      titleOverrideLength: typeof titleOverride === 'string' ? titleOverride.length : null,
      testIDLength: testID?.length ?? 0,
    });
  }, [
    accentPosition,
    ble,
    disabled,
    disabledReason,
    geohash,
    hasMintBalance,
    hideMetadata,
    hasNip05,
    identities.length,
    identityKindList,
    mint,
    mintBalance,
    mintDisplayNameLength,
    mintStats?.auditScore,
    mintStats?.auditState,
    mintStats?.auditTotalOps,
    mintStats?.contactFollowers,
    mintStats?.contactReputation,
    mintStats?.kymScore,
    mintStats?.reviewCount,
    mintStats?.status,
    mintStats?.supportedUnits,
    mintStats?.unit,
    mintStats?.worksOffline,
    mintUrlLength,
    nostr,
    onPress,
    onToggle,
    padding,
    primary.kind,
    resolvedLoading,
    selectable,
    selected,
    self,
    showNip05,
    statKeyList,
    statList.length,
    subtitleSource,
    testID,
    titleOverride,
    trailingSource,
  ]);

  return (
    <ListRow
      leading={leadingNode}
      avatar={leadingNode ? undefined : avatarProp}
      iconCircle={leadingNode ? undefined : iconCircleProp}
      title={titleNode}
      titlePlaceholder={titlePlaceholder}
      titleFallback={titleFallback}
      subtitle={subtitleNode}
      subtitlePlaceholder={subtitlePlaceholder}
      accent={accentNode}
      accentPosition={accentPosition}
      trailing={trailingNode}
      trailingInteractive={trailingIsInteractive && trailingNode != null}
      onPress={trackedPress}
      loading={resolvedLoading}
      disabled={disabled}
      padding={padding}
      accessibilityLabel={typeof titleBase === 'string' ? titleBase : undefined}
      testID={testID}
    />
  );
}
