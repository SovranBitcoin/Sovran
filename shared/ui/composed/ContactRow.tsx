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

import React, { ReactNode } from 'react';
import opacity from 'hex-color-opacity';
import type { MintListItem } from 'coco-payment-ux';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Checkbox } from '@/shared/ui/primitives/Checkbox';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { Text } from '@/shared/ui/primitives/Text';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import {
  ListRow,
  type ListRowAvatar,
  type ListRowIconCircle,
} from '@/shared/ui/composed/ListRow';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import {
  RowStatsAccent,
  STAT_ICONS,
  STAT_COLOR_SOCIAL,
  STAT_COLOR_ERROR,
  type RowStat,
} from '@/shared/ui/composed/RowStatsAccent';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { formatCompact } from '@/shared/lib/number';
import { resolveDisplayName } from '@/shared/lib/profile';
import { relativeTime } from '@/shared/lib/time';

// ---------------------------------------------------------------------------
// Identity types
// ---------------------------------------------------------------------------

export interface NostrProfileLike {
  name?: string;
  display_name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  nip05Valid?: boolean;
  about?: string;
  lud16?: string;
  /** Pagerank reputation (0–100). Present on REST-search profiles; sparse elsewhere. */
  score?: number;
  followers?: number;
  follows?: number;
}

export interface NostrIdentity {
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
export interface MintStatFields {
  balance?: number;
  unit?: string;
  status?: 'available' | 'disabled';
  kymScore?: number;
  /** Count of reviews behind `kymScore`. Rendered as `(23)` next to the star. */
  reviewCount?: number;
  auditScore?: number;
  auditState?: string;
  worksOffline?: boolean;
  contactFollowers?: number;
  contactReputation?: number;
}

export interface MintIdentity {
  kind: 'mint';
  mintUrl: string;
  displayName: string;
  iconUrl?: string;
  stats?: MintStatFields;
}

export interface BleIdentity {
  kind: 'ble';
  peerID: string;
  nickname?: string;
  /** Omit both fields when the caller supplies its own `subtitle` / `trailing`. */
  isConnected?: boolean;
  lastSeen?: number;
}

export interface GeohashIdentity {
  kind: 'geohash';
  geohash: string;
  label?: string;
  displayName?: string;
  /** Only `'ble'` triggers the "Nearby via Bluetooth mesh" subtitle; everything
   *  else is a geohash chat channel. */
  transport: 'ble' | 'nostr' | 'geohash';
  icon?: string;
}

export interface SelfIdentity {
  kind: 'self';
  pubkey: string;
  nickname: string;
  avatarUrl?: string;
  isActive: boolean;
  subtitle?: string;
}

export type Identity =
  | NostrIdentity
  | MintIdentity
  | BleIdentity
  | GeohashIdentity
  | SelfIdentity;

export type StatKey =
  | 'balance'
  | 'score'
  | 'audit'
  | 'reputation'
  | 'followers'
  | 'offline'
  | 'connection';

// ---------------------------------------------------------------------------
// Factories — keep call sites from re-typing `kind:` + field plumbing.
// ---------------------------------------------------------------------------

export function nostrIdentity(
  pubkey: string,
  profile?: NostrProfileLike,
  opts?: { isLoadingProfile?: boolean; verified?: boolean },
): NostrIdentity {
  return {
    kind: 'nostr',
    pubkey,
    profile,
    score: profile?.score,
    followerCount: profile?.followers,
    followingCount: profile?.follows,
    isLoadingProfile: opts?.isLoadingProfile,
    verified: opts?.verified,
  };
}

/** Overload: accept either a full `MintListItem` or a minimal shape. */
export function mintIdentity(item: MintListItem): MintIdentity;
export function mintIdentity(
  input: { mintUrl: string; displayName: string; iconUrl?: string; stats?: MintStatFields },
): MintIdentity;
export function mintIdentity(
  input:
    | MintListItem
    | { mintUrl: string; displayName: string; iconUrl?: string; stats?: MintStatFields },
): MintIdentity {
  if ('balance' in input) {
    const { mintUrl, displayName, iconUrl, balance, unit, status, kymScore, auditScore, auditState, worksOffline, contactFollowers, contactReputation } = input;
    return {
      kind: 'mint',
      mintUrl,
      displayName,
      iconUrl,
      stats: { balance, unit, status, kymScore, auditScore, auditState, worksOffline, contactFollowers, contactReputation },
    };
  }
  return { kind: 'mint', ...input };
}

export function bleIdentity(peer: {
  peerID: string;
  nickname?: string;
  isConnected?: boolean;
  lastSeen?: number;
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
  },
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

export function selfIdentity(
  pubkey: string,
  nickname: string,
  opts?: { avatarUrl?: string; isActive?: boolean; subtitle?: string },
): SelfIdentity {
  return {
    kind: 'self',
    pubkey,
    nickname,
    avatarUrl: opts?.avatarUrl,
    isActive: !!opts?.isActive,
    subtitle: opts?.subtitle,
  };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ContactRowProps {
  /** One identity, or an array for composites (e.g. mint + nostr). */
  identity: Identity | Identity[];

  title?: string;
  /** `null` suppresses the subtitle entirely (pairs with `hideMetadata` for
   *  replies-mode: show the last message, hide the stat pills). */
  subtitle?: string | ReactNode | null;
  hideMetadata?: boolean;
  /** Default `true`. Set `false` to omit the NIP-05 pill even when present. */
  showNip05?: boolean;

  /** Declarative stat picker. Omit to use the kind's default. Order preserved,
   *  stats with no data drop out silently. */
  stats?: ReadonlyArray<StatKey>;

  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  selectionVariant?: 'circle-check' | 'checkbox';

  /** Full trailing override; beats every variant / kind default. */
  trailing?: ReactNode;
  trailingVariant?: 'chevron' | 'spinner' | 'none';
  /** When set, a 3-dot button appears in the trailing slot if nothing else
   *  higher-priority takes it. */
  onInspectPress?: () => void;

  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;

  padding?: 'default' | 'compact';
  testID?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLUETOOTH_ACCENT = '#0A84FF';
const CONNECTED_ACCENT = '#34C759';
const AVATAR_SIZE = 44;

const DEFAULT_STATS_BY_KIND: Record<Identity['kind'], ReadonlyArray<StatKey>> = {
  // `following` is intentionally absent: the count lands in a narrow accent
  // row where a second "people" number alongside followers doesn't earn its
  // space. UserProfileScreen still shows it on the full profile header.
  nostr: ['reputation', 'followers'],
  mint: ['score', 'audit', 'reputation', 'followers', 'offline'],
  ble: [],
  geohash: [],
  self: [],
};

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

function find<K extends Identity['kind']>(
  ids: Identity[],
  kind: K,
): Extract<Identity, { kind: K }> | undefined {
  return ids.find((i): i is Extract<Identity, { kind: K }> => i.kind === kind);
}

function derivePicture(ids: Identity[]): string | undefined {
  return (
    find(ids, 'mint')?.iconUrl ??
    find(ids, 'nostr')?.profile?.picture ??
    find(ids, 'self')?.avatarUrl
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
  if (ble) return ble.peerID;
  const geohash = find(ids, 'geohash');
  if (geohash) return geohash.geohash;
  return undefined;
}

function deriveName(ids: Identity[]): string | undefined {
  const mint = find(ids, 'mint');
  if (mint?.displayName) return mint.displayName;
  const nostrName = resolveDisplayName(find(ids, 'nostr')?.profile);
  if (nostrName) return nostrName;
  const self = find(ids, 'self');
  if (self?.nickname) return self.nickname;
  const ble = find(ids, 'ble');
  if (ble?.nickname) return ble.nickname;
  const geohash = find(ids, 'geohash');
  return geohash?.label ?? geohash?.displayName;
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
    const suffix = ble.isConnected
      ? 'connected'
      : `seen ${typeof ble.lastSeen === 'number' ? relativeTime(ble.lastSeen) : 'recently'}`;
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
  keys: ReadonlyArray<StatKey>,
  tints: { warning: string; success: string },
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
            icon: 'mdi:wallet-outline',
            value: formatCompact(mintStats.balance),
            color: STAT_COLOR_SOCIAL,
          });
        }
        break;
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
          out.push({
            icon: STAT_ICONS.audit,
            value: `${pct}%`,
            color: mintStats.auditState === 'ERROR' ? STAT_COLOR_ERROR : tints.success,
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
          out.push({
            icon: ble.isConnected ? 'mdi:broadcast' : 'mdi:clock-outline',
            value: ble.isConnected
              ? 'Connected'
              : typeof ble.lastSeen === 'number'
                ? relativeTime(ble.lastSeen)
                : 'Offline',
            color: ble.isConnected ? CONNECTED_ACCENT : STAT_COLOR_SOCIAL,
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
  subtitle: subtitleOverride,
  hideMetadata = false,
  showNip05 = true,
  stats: statsOverride,
  selectable = false,
  selected = false,
  onToggle,
  selectionVariant = 'circle-check',
  trailing: trailingOverride,
  trailingVariant,
  onInspectPress,
  onPress,
  loading,
  disabled = false,
  disabledReason,
  padding = 'default',
  testID,
}: ContactRowProps) {
  const [foreground, accent, success, warning] = useThemeColor([
    'foreground',
    'accent',
    'success',
    'yellow-300',
  ] as const);

  const identities = Array.isArray(identity) ? identity : [identity];
  const primary = identities[0];
  const nostr = find(identities, 'nostr');
  const mint = find(identities, 'mint');
  const self = find(identities, 'self');
  const ble = find(identities, 'ble');
  const geohash = find(identities, 'geohash');

  const resolvedLoading = loading ?? nostr?.isLoadingProfile ?? false;

  // ---- Leading ----------------------------------------------------------

  const picture = derivePicture(identities);
  const seed = deriveSeed(identities);
  const name = deriveName(identities);
  const avatarState = resolvedLoading ? 'loading' : picture ? 'image' : 'fallback';

  let leadingNode: ReactNode | undefined;
  let avatarProp: ListRowAvatar | undefined;
  let iconCircleProp: ListRowIconCircle | undefined;

  if (nostr?.verified) {
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
  } else if (mint || nostr || self || picture) {
    avatarProp = { picture, seed, name, size: AVATAR_SIZE, state: avatarState };
  } else if (ble) {
    iconCircleProp = { icon: 'mdi:bluetooth', color: BLUETOOTH_ACCENT };
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

  const titleNode: string | ReactNode | undefined =
    isCurrentSelf && titleBase ? (
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
    ) : (
      titleBase
    );

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
  const statList: RowStat[] =
    hideMetadata || resolvedLoading ? [] : buildStats(identities, statKeys, { warning, success });

  const nip05 =
    showNip05 && !hideMetadata && !resolvedLoading && nostr?.profile?.nip05
      ? { handle: nostr.profile.nip05, valid: nostr.profile.nip05Valid }
      : undefined;

  const accentNode = <RowStatsAccent stats={statList} note={disabledReason} nip05={nip05} />;

  // ---- Trailing ---------------------------------------------------------

  const chevronNode = (
    <Icon name="mdi:chevron-right" size={24} color={opacity(foreground, 0.25)} />
  );

  const selectionNode = selectable
    ? selectionVariant === 'checkbox'
      ? (
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggle?.()}
            size={24}
            variant="success"
          />
        )
      : (
          <View
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              borderWidth: 1.5,
              borderColor: selected ? accent : opacity(foreground, 0.25),
              backgroundColor: selected ? accent : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            {selected ? <Icon name="mdi:check" size={16} color="#FFFFFF" /> : null}
          </View>
        )
    : null;

  const inspectNode = onInspectPress ? (
    <TouchableOpacity
      onPress={onInspectPress}
      hitSlop={8}
      style={{ padding: 8, borderRadius: 999, backgroundColor: opacity(foreground, 0.06) }}>
      <Icon name="bx:dots-vertical-rounded" size={18} color={foreground} />
    </TouchableOpacity>
  ) : null;

  const bleConnectionNode =
    ble && ble.isConnected !== undefined
      ? ble.isConnected
        ? <Icon name="mdi:broadcast" size={20} color={CONNECTED_ACCENT} />
        : <Icon name="mdi:clock-outline" size={20} color={opacity(foreground, 0.3)} />
      : null;

  let trailingNode: ReactNode;
  if (trailingOverride !== undefined) {
    trailingNode = trailingOverride;
  } else if (selectable) {
    trailingNode = selectionNode;
  } else if (trailingVariant === 'spinner') {
    trailingNode = <Spinner size={20} />;
  } else if (trailingVariant === 'chevron') {
    trailingNode = chevronNode;
  } else if (trailingVariant === 'none') {
    trailingNode = null;
  } else if (inspectNode) {
    trailingNode = inspectNode;
  } else if (geohash) {
    trailingNode = chevronNode;
  } else if (bleConnectionNode) {
    trailingNode = bleConnectionNode;
  } else {
    trailingNode = null;
  }

  // ---- Interaction ------------------------------------------------------

  const effectivePress = onPress ?? (selectable ? () => onToggle?.() : undefined);

  return (
    <ListRow
      leading={leadingNode}
      avatar={leadingNode ? undefined : avatarProp}
      iconCircle={leadingNode ? undefined : iconCircleProp}
      title={titleNode}
      titleFallback={titleFallback}
      subtitle={subtitleNode}
      accent={accentNode}
      trailing={trailingNode}
      onPress={effectivePress}
      loading={resolvedLoading}
      disabled={disabled}
      padding={padding}
      testID={testID}
    />
  );
}
