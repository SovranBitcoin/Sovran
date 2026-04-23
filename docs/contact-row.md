# Displaying a contact: the `ContactRow` spec

Every screen that shows a person, mint, peer, or place renders them with
**`ContactRow`** (`shared/ui/composed/ContactRow.tsx`). One component for every
identity kind — nostr profiles, cashu mints, bluetooth peers, geohash channels,
the user's own accounts, plus composites like "a mint that is also a nostr
profile." If you find yourself reaching for `ListRow` directly or hand-rolling
an avatar + name + stats layout, stop: use this instead.

The short version: pick the kind, call the factory, pass it to `ContactRow`.

```tsx
<ContactRow identity={nostrIdentity(pubkey, profile)} onPress={open} />
<ContactRow identity={mintIdentity(mintListItem)} selectable selected={picked} onToggle={toggle} />
<ContactRow identity={bleIdentity(peer)} onPress={openDM} />
<ContactRow identity={geohashIdentity('u0qgh', { label: 'London' })} trailingVariant="chevron" />
```

That's the whole surface for the common case. Everything below explains what
the row does automatically, how to override it, and where every screen in the
app gets its identity data from.

---

## Why one component

Before this unification we had seven per-feature row wrappers (`ContactItem`,
`SearchResult`, `ContactListItem`, `ContactSearchResultItem`,
`LocationTierItem`, `MintItem`, `ParticipantPickerRow`). Each re-derived
`(picture, seed, name)` from a slightly different input shape, built its own
stats pills, rendered NIP-05 three different ways, and handled loading
inconsistently. Touching any of them to add a new field meant patching N files.

`ContactRow` collapses all seven into one. It renders *through* `ListRow` (the
slot primitive), so the 20px/12px padding, 44px avatar, 16/600 title, and
14/0.5-opacity subtitle conventions hold everywhere without each caller
remembering to set them.

---

## Anatomy

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  [ avatar ]   Title  [CURRENT pill if self+active]                   │
│   44×44      Subtitle (or <AmountFormatter> for mints, or null)      │
│              [★ 4.5 (23)] · [📊 92%] · [✓ user@relay.example.com…]  │
│                                                                      │
│                                                    [ trailing 24×24 ]│
└──────────────────────────────────────────────────────────────────────┘
   leading     body                                      trailing
```

- **leading** — `Avatar` with seeded-gradient fallback, or an `iconCircle` for
  BLE / geohash rows (no picture available).
- **body** — three lines max: title, subtitle, accent. Lines collapse when
  their slot is empty.
- **trailing** — chevron, checkbox, circle-check, 3-dot inspect, spinner,
  connection icon, or nothing.

The third line — the **accent row** — packs tight pills (12px icon + 12px
bold value) separated by a bullet, ending with the NIP-05 handle when
present, which takes whatever width remains and truncates with ellipsis.
See §NIP-05.

---

## Quick start

```tsx
import {
  ContactRow,
  nostrIdentity,
  mintIdentity,
  bleIdentity,
  geohashIdentity,
  selfIdentity,
} from '@/shared/ui/composed/ContactRow';
```

Then pick the factory for the kind you have:

```tsx
// A nostr profile — the most common case.
<ContactRow
  identity={nostrIdentity(pubkey, profile, { isLoadingProfile })}
  onPress={() => router.push(`/profile?pubkey=${pubkey}`)}
  testID={`contact-row:nostr:${pubkey}`}
/>

// A mint (full coco-payment-ux MintListItem — unlocks balance + audit pills).
<ContactRow
  identity={mintIdentity(mintListItem)}
  onPress={() => selectMint(mintListItem.mintUrl)}
  onInspectPress={() => openMintReviews(mintListItem.mintUrl)}
/>

// A BLE peer.
<ContactRow
  identity={bleIdentity(peer)}
  onPress={() => openChat(peer.peerID)}
/>

// A geohash jump row.
<ContactRow
  identity={geohashIdentity(geohash, { label: `Go to #${geohash}`, icon: 'mdi:pound' })}
  trailingVariant="chevron"
  subtitle="Open geohash chat channel"
/>

// The user's own account (in the split-bill picker).
<ContactRow
  identity={selfIdentity(pubkey, nickname, { avatarUrl, isActive, subtitle })}
  selectable
  selected={picked}
  onToggle={() => toggle(pubkey)}
/>
```

---

## Identity kinds

Each kind is a discriminated union variant under `Identity` in
`shared/ui/composed/ContactRow.tsx`. Factories are the only thing callers
should construct — they protect against field-plumbing drift.

### `nostr`

```ts
nostrIdentity(
  pubkey: string,
  profile?: NostrProfileLike,
  opts?: { isLoadingProfile?: boolean; verified?: boolean },
): NostrIdentity
```

| Data source | Where it comes from |
|---|---|
| Hex pubkey | Wherever the screen lives — DM history, search results, user toggles |
| Profile (kind 0) | `useSubscribe({ filters: [{ kinds: [0], authors }] })` via NDK, or `useContactSearch` REST endpoint (already shaped as `UserProfile` from `@sovranbitcoin/schemas`) |
| `nip05Valid` | Inlined in `UserProfile` from the REST API. Not set for relay-sourced metadata unless you verify separately |
| `score` / `followers` / `follows` | From `UserProfile` (REST path only). Drive the reputation / followers / following stats pills when present |
| `verified` | `Object.values(PUBLIC_KEYS).includes(pubkey)` at the call site — rendered via `Avatar status="VERIFIED"` |

**Default title:** `display_name → displayName → name → short-pubkey`.
**Default subtitle:** none — NIP-05 lives on the accent line.
**Default stats:** `['reputation', 'followers', 'following']`.

### `mint`

```ts
// Overload 1: full MintListItem from coco-payment-ux
mintIdentity(item: MintListItem): MintIdentity

// Overload 2: minimal shape for screens that only know URL + name
mintIdentity({
  mintUrl: string;
  displayName: string;
  iconUrl?: string;
  stats?: MintStatFields;
}): MintIdentity
```

| Overload | Use when | Unlocks |
|---|---|---|
| Full `MintListItem` | MintListScreen (trusted wallet mints) | balance subtitle, score, audit, reputation, followers, offline pills |
| Minimal shape | ContactsScreen (DM contacts that are also mints), MintAddScreen (search results) | whatever `stats` fields the caller fills in; skips balance subtitle |

`MintStatFields` carries `kymScore`, **`reviewCount`**, `auditScore`,
`auditState`, `contactReputation`, `contactFollowers`, `worksOffline`,
`balance`, `unit`, `status`. Each field is optional and missing ones drop
silently from the accent.

**Default title:** `displayName`.
**Default subtitle:** `<AmountFormatter>` with `balance` + `unit` when both
are present on `stats`; otherwise nothing.
**Default stats:** `['score', 'audit', 'reputation', 'followers', 'offline']`.
**Score pill meta:** `kymScore` renders with `reviewCount` in muted parens —
`★ 4.5 (23)` — when both are set.

### `ble`

```ts
bleIdentity({
  peerID: string;
  nickname?: string;
  isConnected?: boolean;
  lastSeen?: number;
}): BleIdentity
```

`peerID` is the 16-hex bitchat identifier. `nickname` is often blank —
callers should fall back via `titleFallback` (ContactRow does this for you).

Leave `isConnected` / `lastSeen` undefined when the caller supplies its own
`subtitle` / `trailing` — ContactRow then won't try to build either.

**Default title:** `nickname → short-peerID`.
**Default subtitle:** `#peerID · connected` or `#peerID · seen 2m ago`
(only when `isConnected` is set).
**Default trailing:** broadcast icon (green) when connected, clock-outline
(dim) otherwise.
**Default stats:** none — status is shown via subtitle + trailing, not pills.

### `geohash`

```ts
geohashIdentity(
  geohash: string,
  opts?: {
    label?: string;
    displayName?: string;
    transport?: 'ble' | 'nostr' | 'geohash';
    icon?: string;
  },
): GeohashIdentity
```

Geohash rows render with an `iconCircle` leading (not an avatar).
`icon` defaults to `mdi:pound`; `transport === 'ble'` uses
`mdi:bluetooth`-tinted color via the caller (see `useLocationTiers`).

**Default title:** `label → displayName → #geohash`.
**Default subtitle:** `~{displayName} · #{geohash}` or
`Nearby via Bluetooth mesh` when `transport === 'ble'`.
**Default stats:** none.
**Default trailing:** chevron.

### `self`

```ts
selfIdentity(
  pubkey: string,
  nickname: string,
  opts?: { avatarUrl?: string; isActive?: boolean; subtitle?: string },
): SelfIdentity
```

The user's own accounts (in the split-bill "Who Pays" picker). `isActive`
marks the currently-loaded profile; that row inlines a small **`CURRENT`**
pill next to the title.

**Default title:** `nickname` (+ `CURRENT` pill when active).
**Default subtitle:** `subtitle` prop.
**Default stats:** none.

---

## Composites — mint + nostr

Pass an array when a row represents two identities at once. The classic case
is the Select Mint list where a mint has a nostr pubkey via NUT-06 `contact`.

```tsx
<ContactRow
  identity={[
    mintIdentity(mintListItem),
    nostrIdentity(operatorPubkey, operatorProfile),
  ]}
  onPress={...}
/>
```

Resolution rules:

| Slot | Winner | Why |
|---|---|---|
| Avatar | mint | The row reads as a mint first — users are picking which wallet to use |
| Title | mint displayName | Same |
| Subtitle | mint balance (AmountFormatter) | The primary "what do I have here" signal |
| `score` pill | mint `kymScore` + `reviewCount` meta | Mint-review community |
| `audit` pill | mint `auditScore` / `auditState` | Auditor data |
| `reputation` pill | **nostr** `score`, falling back to mint `contactReputation` | The mint's operator's nostr reputation is richer than the mint's own when present |
| `followers` pill | **nostr** `followerCount`, falling back to mint `contactFollowers` | Same |
| `offline` pill | mint `worksOffline` | Wallet-specific |
| NIP-05 pill | nostr `profile.nip05` | Only source that has one |

Result:

```
[mint icon]  Example Mint
             ₿ 12,345 sats
             [★ 4.5 (23)] · [📊 92%] · [🛡 87] · [👥 1.2k] · [✈ Offline] · [✓ example@mint.com…]
                                                                                                   [⋮]
```

---

## Stats — the pill picker

Every row builds its accent from the same set of keys. Specify your own
order via `stats={[...]}` to override kind defaults, or omit for the kind
default.

| Key | Icon | Tint | Value | Source field(s) | Meta? |
|---|---|---|---|---|---|
| `balance` | `mdi:wallet-outline` | blue | `formatCompact(n)` | `mint.stats.balance` | — |
| `score` | `ic:round-star` | warning yellow | `4.5` or `4` | `mint.stats.kymScore` | `(23)` from `reviewCount` |
| `audit` | `lucide:activity` | success / error | `92%` | `mint.stats.auditScore`, tinted by `auditState` | — |
| `reputation` | `mdi:shield-check` | social blue | `87` | `nostr.score` → `mint.stats.contactReputation` | — |
| `followers` | `mdi:account-group` | social blue | `1.2k` | `nostr.followerCount` → `mint.stats.contactFollowers` | — |
| `following` | `mdi:account-arrow-right` | social blue | `420` | `nostr.followingCount` | — |
| `offline` | `mdi:airplane` | success | `Offline` | `mint.stats.worksOffline === true` | — |
| `connection` | `mdi:broadcast` / `clock-outline` | green / blue | `Connected` / `5m ago` | `ble.isConnected`, `ble.lastSeen` | — |

Rules:

- Order is caller-specified; missing values drop silently.
- A stat with no data isn't rendered — the accent collapses to just what's
  present. An accent with zero stats and no NIP-05 produces no third line
  at all.
- The **score** pill is special: when `reviewCount` is present, it renders
  as `★ 4.5 (23)` — one pill, two values, count in muted parens at 70%
  opacity. Do not split into two separate pills.

---

## NIP-05 pill — always last, truncated

When any nostr identity in the row has `profile.nip05` (and you haven't set
`showNip05={false}`), a NIP-05 pill is appended as the **final** entry on
the accent row. The pill gets whatever horizontal space remains and
truncates with ellipsis — so short stat icons sit on the left, the human-
readable handle stretches to fit, and very long handles
(`really_long_handle@somerelay.example.com`) don't overflow.

The checkmark tints `theme.success` when `nip05Valid === true` (the REST
path is the primary source of this flag), and a dim foreground otherwise.

```
[★ 4.5 (23)] · [👥 1.2k] · [✓ user@relay.example.com…]
                                           └──────────┘
                                           flex:1, numberOfLines:1, ellipsizeMode:tail
```

Don't render NIP-05 in the subtitle — the pill is the canonical home, and
mixing both gives you two copies of the same handle on one row.

---

## Subtitle contract

Three states:

| Pass | Behaviour |
|---|---|
| `subtitle={string}` or `subtitle={<ReactNode>}` | Replaces the default |
| `subtitle={null}` | Suppresses entirely (no line reserved) |
| Omit | Falls back to the kind default (see per-kind sections above) |

Replies mode on the Contacts list uses the subtitle override with
`hideMetadata`:

```tsx
<ContactRow
  identity={nostrIdentity(pubkey, profile)}
  subtitle={lastMessagePreview}
  hideMetadata={true}
  onPress={openDM}
/>
```

`hideMetadata` wipes the stats accent AND the NIP-05 pill — the thinking
is: if you're showing a last-message sentence, a row of pill icons beside
it is noise.

---

## Skeleton and loading

The contract is precise and it is worth getting right.

| Kind | Is data ever async? | Pass `loading` / `isLoadingProfile`? |
|---|---|---|
| `nostr` | Yes — profile arrives via relay | **Yes** — set `isLoadingProfile: true` on the identity until the profile lands |
| `mint` | No — mints are fully local | No |
| `mint-info` (minimal mint shape) | Usually no, unless stats are enriched async | Only if specifically fetching enrichment — otherwise leave alone |
| `ble` | No — peers come from the BLE subscription with nicknames already | No |
| `geohash` | No — tiers are computed from a device location | No |
| `self` | No — read from profileStore | No |

`loading` on the row prop and `isLoadingProfile` on a nostr identity mean
the same thing — the identity-side is preferred because it keeps the
information with the data. Either triggers the `ListRow` skeleton bars for
title + subtitle and the avatar's loading state.

**For list-level loading** — e.g. a search screen where the whole result
set is still streaming — render placeholder rows instead of mixing
skeleton rows into real rows:

```tsx
const placeholders = Array.from({ length: 4 }, (_, i) =>
  nostrIdentity(`placeholder-${i}`, undefined, { isLoadingProfile: true })
);

{loading && results.length === 0
  ? placeholders.map((id) => <ContactRow key={id.pubkey} identity={id} />)
  : results.map((r) => <ContactRow key={r.pubkey} identity={nostrIdentity(r.pubkey, r.profile)} onPress={...} />)}
```

This is what `SearchResultsList` does. An alternative — a separate
"loader card" shown above or instead of the list (like `MintAddScreen`'s
`LoadingMintsList`) — is fine when the list has list-level chrome you'd
rather not render during load.

What you should **not** do: pass `loading: true` when the data is fully
available. A BLE row with a nickname doesn't need a skeleton because the
nickname is right there; triggering skeleton anyway just makes the UI
stutter as it resolves. Skeleton is for genuine "we don't have it yet."

---

## Selection

```tsx
<ContactRow
  identity={...}
  selectable
  selected={picked.has(id)}
  onToggle={() => toggle(id)}
  selectionVariant="circle-check"  // default; 'checkbox' for multi-select mint adders
/>
```

Two variants:

- **`circle-check`** — a 24px circle with a checkmark when selected. The
  split-bill "Who Pays" picker uses this.
- **`checkbox`** — the `Checkbox` primitive. The Mint Add screen uses this
  for multi-select.

When `selectable` is set the trailing slot renders the toggle; tapping the
row itself also fires `onToggle` (unless `onPress` is set, which wins).

---

## Trailing priority

Only one trailing element renders; priority from highest to lowest:

1. `trailing={<SomeNode/>}` — full override, always wins.
2. `selectable` — renders the `circle-check` or `checkbox`.
3. `trailingVariant="spinner"` — `Spinner` (20px).
4. `trailingVariant="chevron"` — `mdi:chevron-right` at 25% foreground.
5. `trailingVariant="none"` — nothing.
6. `onInspectPress` — 3-dot `bx:dots-vertical-rounded` in a soft pill.
7. Kind default: `geohash` → chevron, `ble` (with `isConnected` set) →
   connection icon, everything else → nothing.

If you want a loading spinner specifically (e.g. after a mint is tapped),
set `trailingVariant="spinner"` and update it back to `undefined` on the
next render.

---

## Disabled state

```tsx
<ContactRow identity={...} disabled disabledReason="Mint is offline" />
```

`disabled` dims the row (50% opacity via `ListRow`) and ignores `onPress`.
`disabledReason` flows into `RowStatsAccent.note` — it renders below the
stats pills in a dim foreground. Don't duplicate the reason into the
subtitle; the note line is specifically for this.

---

## Testing

Every row deserves a `testID`. Convention:

```
contact-row:{kind}:{id}
```

- `kind` is the primary identity's discriminator (`nostr`, `mint`, `ble`,
  `geohash`, `self`).
- `id` is pubkey for `nostr` / `self`, `mintUrl` for `mint`, `peerID` for
  `ble`, `geohash` for `geohash`.
- For composite rows (mint + nostr), use the primary's id — typically the
  mint URL.

```tsx
testID={`contact-row:nostr:${pubkey}`}
testID={`contact-row:mint:${mintListItem.mintUrl}`}
testID={`contact-row:ble:${peer.peerID}`}
testID={`contact-row:geohash:${geohash}`}
```

The `phone` mode targets these with `phone tap-id contact-row:mint:...` —
stable across copy edits, theme changes, and layout reflows. If you add
a row in a screen without a `testID`, `phone tap` will nudge you.

---

## Adding a new identity kind

Checklist if you need to represent something that isn't covered (e.g. an
LN node, a hardware device, a lightning address):

1. Add an interface to the `Identity` union in `ContactRow.tsx`.
2. Add the kind to `DEFAULT_STATS_BY_KIND`.
3. Extend `derivePicture`, `deriveSeed`, `deriveName`,
   `deriveTitleFallback`, `deriveSubtitle` with the new kind's
   contribution.
4. If the kind has new stats, add them to the `StatKey` union and handle
   them in `buildStats`.
5. Write a factory — `xyzIdentity(...)` — that returns the well-typed
   object. Don't let call sites spell the kind discriminator themselves.
6. Add a row to the **Identity kinds** section of this doc.
7. Decide on default trailing (chevron? none? something kind-specific?).
   Plumb it in the trailing `if/else` chain.

---

## Don't do this

- **Don't drop down to `ListRow` directly** when you're rendering an
  identity. `ListRow` is fine for pure-layout rows that aren't tied to a
  person/mint/peer, but anything contact-shaped goes through `ContactRow`
  so the avatar, title, stats, NIP-05, and skeleton behaviour stay
  consistent.
- **Don't spell out `kind: 'nostr'` and enumerate fields inline.** Use
  the factory. The field list changes; the factory will handle it.
- **Don't render NIP-05 in the subtitle.** The accent pill is the one true
  home. Showing it in the subtitle too produces a duplicate row.
- **Don't pass `loading: true` on a row whose data is local** (mint, BLE,
  self, geohash without async enrichment). The skeleton is for genuine
  pending fetches.
- **Don't wrap `<ContactRow>` in a per-feature shim** (`MyFeatureRow`
  that forwards to ContactRow). A thin adapter function like
  `candidateToIdentity` is fine — it just builds the identity. But
  wrapping the render produces exactly the drift this component exists
  to kill.
- **Don't add a new stat icon without updating `STAT_ICONS`** in
  `RowStatsAccent.tsx`. Using the same iconify glyph for the same
  semantic across the whole app is half the point.

---

## Where identity data comes from

One last table — when you need to render a row, these are the places in the
codebase that hand you the data you feed into the factories.

| Kind | Hook / store | Shape returned |
|---|---|---|
| `nostr` (recent DMs) | `useRecentContacts(keys)` + `useSubscribe` with kind-0 filter | pubkey + kind-0 metadata |
| `nostr` (search) | `useContactSearch(query)` | `{ pubkey, profile: UserProfile }` (REST, camelCase, `score` / `followers` / `follows` inline) |
| `mint` (wallet) | `useMints()` + `buildMintListItems(...)` | `MintListItem` from coco-payment-ux |
| `mint` (add-mint search) | `useMintSearch(query)` | `MintSearchResult` from `@sovranbitcoin/schemas` — has `review_score` + `review_count` |
| `mint-info` (DM contact that's a mint) | `useMintContacts(keys, mints, getMintInfo, dmEvents)` | URL + NUT-06 `info` blob |
| `ble` | `useBLEPeers()` | `BLEPeer` from `bitchat-module` |
| `geohash` (tiers) | `useLocationTiers()` | `TierEntry` with `geohash`, `label`, `transport`, `displayName` |
| `geohash` (jump row) | `parseGeohashQuery(searchInput)` in `ContactsScreen` / `SearchResultsList` | bare geohash string |
| `self` | `useProfileStore((s) => s.profiles)` + `activeAccountIndex` | `ProfileEntry` |

If you're wiring a new screen, start from one of these — the factories take
the natural shape each of these returns, so you shouldn't need to adapt at
the call site.
