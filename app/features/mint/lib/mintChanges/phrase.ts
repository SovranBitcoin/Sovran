/**
 * Facts → the sentence a user reads.
 *
 * Two jobs: merge facts that are really one event (a rail added to both
 * directions, `min_amount` and `max_amount` moved together, three capability
 * flags flipped in one release), and rank what's left so the collapsed row can
 * show the single most consequential thing. Ranking matters more than it looks:
 * a mint that rotated its key AND bumped its version in one revision must lead
 * with the key.
 *
 * Every predicate is written to follow the mint's name — "Sovran " + "added
 * Onchain sending & receiving" — matching how the rest of Notifications reads
 * ("Alice liked your post").
 */
import { railName, type Direction, type MintChangeFact } from './interpret';

/**
 * Semantic register for a change, resolved to a theme colour by the UI: what
 * the mint gained, what it lost, what merely moved.
 */
export type MintChangeTone = 'success' | 'danger' | 'accent' | 'warning' | 'muted';

export type MintChangePhrase = {
  /** Lower sorts first: the most consequential change leads the row. */
  rank: number;
  /** Predicate only — the subject is the mint's name. */
  text: string;
  /** Iconify glyph, the way a notification row carries a reason glyph. */
  icon: string;
  tone: MintChangeTone;
  /**
   * Precise value behind the sentence (a version string, the full notice), shown
   * only on the detail screen. The row stays one short line.
   */
  detail?: string;
};

const RANK = {
  auth: 0,
  key: 1,
  paused: 2,
  railRemoved: 3,
  railAdded: 4,
  limit: 5,
  notice: 6,
  feature: 7,
  identity: 8,
  other: 9,
  software: 10,
} as const;

const NOTICE_MAX = 70;
/** Above this, capabilities are counted rather than listed. */
const MAX_NAMED_FEATURES = 3;

/**
 * One glyph per kind of change, the way `NotificationsScreen` gives a like, a
 * follow and a reply their own. The glyph says WHAT moved; the tone says which
 * way — a rail keeps its own icon whether it was added or dropped.
 */
const ICON = {
  auth: 'mdi:lock-outline',
  key: 'mdi:key-variant',
  paused: 'mdi:pause-circle',
  limit: 'mdi:speedometer',
  notice: 'mdi:bullhorn',
  feature: 'mdi:star-four-points',
  software: 'mdi:package-up',
  profile: 'mdi:card-account-details-outline',
  address: 'mdi:web',
  contact: 'mdi:email',
  terms: 'mdi:information',
  other: 'mdi:information',
  rail: 'mdi:swap-horizontal',
} as const;

/** Rails carry the glyph of the thing they move: a bolt, a chain. */
const RAIL_ICONS: Record<string, string> = {
  bolt11: 'mdi:lightning-bolt',
  bolt12: 'mdi:lightning-bolt',
  onchain: 'mdi:bitcoin',
};

/* ── amounts ─────────────────────────────────────────────────────────── */

const FIAT_SYMBOLS: Record<string, string> = { usd: '$', eur: '€', gbp: '£' };

/**
 * Amounts are shown in the mint's OWN unit, verbatim. Deliberately not
 * `shared/lib/currency`'s `formatAmount`: that converts through live exchange
 * rates and the user's display preference, which would turn "this mint's cap is
 * 100,000 sats" into a number the mint never said.
 */
function formatMintAmount(amount: number, unit?: string): string {
  const u = unit?.toLowerCase();
  if (u === 'sat') return `${amount.toLocaleString('en-US')} sats`;
  if (u && FIAT_SYMBOLS[u]) {
    return `${FIAT_SYMBOLS[u]}${(amount / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  const value = amount.toLocaleString('en-US');
  return u ? `${value} ${u}` : value;
}

/* ── direction wording ───────────────────────────────────────────────── */

const DIRECTION_NOUN: Record<Direction, string> = { receive: 'receiving', send: 'sending' };

function directionsPhrase(directions: Set<Direction>, joiner = 'and'): string {
  if (directions.has('receive') && directions.has('send')) {
    return `sending ${joiner} receiving`;
  }
  return DIRECTION_NOUN[directions.has('send') ? 'send' : 'receive'];
}

/**
 * "its receiving limit" — or just "its limits" when the same numbers moved for
 * both directions, which is how mints usually set them. Two directions means
 * two limits, so the noun goes plural there regardless of how many bounds moved.
 */
function limitSubject(directions: Set<Direction>, plural: boolean): string {
  const both = directions.has('receive') && directions.has('send');
  if (both) return 'its limits';
  return `its ${DIRECTION_NOUN[directions.has('send') ? 'send' : 'receive']} ${plural ? 'limits' : 'limit'}`;
}

function listNames(names: string[]): string {
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/* ── grouping helpers ────────────────────────────────────────────────── */

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

type LimitFact = Extract<MintChangeFact, { kind: 'limit' }>;

/**
 * Limits arrive one bound, one direction, one method-index at a time. Fold them
 * into "the same numbers moved" buckets first (so a mint that set 0–2,100 on
 * four method entries says it once), then phrase per bucket.
 */
function phraseLimits(limits: LimitFact[]): MintChangePhrase[] {
  const byValues = new Map<string, { fact: LimitFact; directions: Set<Direction> }>();
  for (const limit of limits) {
    const key = `${limit.bound}|${limit.from ?? ''}|${limit.to ?? ''}|${limit.unit ?? ''}`;
    const bucket = byValues.get(key);
    if (bucket) bucket.directions.add(limit.direction);
    else byValues.set(key, { fact: limit, directions: new Set([limit.direction]) });
  }

  // Then pair a min and a max that moved for the same directions — mints almost
  // always set both at once, and "0–2,100 sats" is one fact, not two.
  const byDirections = new Map<string, { fact: LimitFact; directions: Set<Direction> }[]>();
  for (const bucket of byValues.values()) {
    push(byDirections, [...bucket.directions].sort().join('+'), bucket);
  }

  const limitPhrase = { rank: RANK.limit, icon: ICON.limit, tone: 'accent' } as const;
  const phrases: MintChangePhrase[] = [];
  for (const buckets of byDirections.values()) {
    const directions = buckets[0]!.directions;
    const min = buckets.find((b) => b.fact.bound === 'min')?.fact;
    const max = buckets.find((b) => b.fact.bound === 'max')?.fact;

    if (min && max && min.to !== undefined && max.to !== undefined) {
      phrases.push({
        ...limitPhrase,
        text: `set ${limitSubject(directions, true)} to ${formatMintAmount(min.to, min.unit)}–${formatMintAmount(max.to, max.unit)}`,
      });
      continue;
    }

    for (const { fact } of buckets) {
      const noun = limitSubject(directions, false);
      if (fact.to === undefined) {
        phrases.push({ ...limitPhrase, text: `removed ${limitSubject(directions, true)}` });
        continue;
      }
      const amount = formatMintAmount(fact.to, fact.unit);
      if (fact.from === undefined) {
        phrases.push({ ...limitPhrase, text: `set ${noun} to ${amount}` });
        continue;
      }
      const verb = fact.to > fact.from ? 'raised' : 'lowered';
      phrases.push({ ...limitPhrase, text: `${verb} ${noun} to ${amount}` });
    }
  }
  return phrases;
}

/* ── the phraser ─────────────────────────────────────────────────────── */

/**
 * Merged, ranked predicates for one mint's facts. Facts are expected to be
 * pre-folded across revisions (newest wins) by the caller.
 */
export function phraseFacts(facts: readonly MintChangeFact[]): MintChangePhrase[] {
  const phrases: MintChangePhrase[] = [];

  const auth = facts.filter((f) => f.kind === 'auth');
  if (auth.length > 0) {
    const added = auth.some((f) => f.action === 'added');
    const removed = auth.some((f) => f.action === 'removed');
    phrases.push({
      rank: RANK.auth,
      icon: ICON.auth,
      // A mint that starts demanding sign-in has taken something away.
      tone: added ? 'danger' : removed ? 'success' : 'warning',
      text: added
        ? 'now requires sign-in'
        : removed
          ? 'no longer requires sign-in'
          : 'changed its sign-in requirements',
    });
  }

  if (facts.some((f) => f.kind === 'key')) {
    phrases.push({
      rank: RANK.key,
      icon: ICON.key,
      tone: 'warning',
      text: 'rotated its mint key',
    });
  }

  // paused / resumed, merged across directions
  const pausedDirections = new Map<boolean, Set<Direction>>();
  for (const fact of facts) {
    if (fact.kind !== 'paused') continue;
    const set = pausedDirections.get(fact.paused) ?? new Set<Direction>();
    set.add(fact.direction);
    pausedDirections.set(fact.paused, set);
  }
  for (const [paused, directions] of pausedDirections) {
    phrases.push({
      rank: RANK.paused,
      icon: ICON.paused,
      tone: paused ? 'danger' : 'success',
      text: `${paused ? 'paused' : 'resumed'} ${directionsPhrase(directions)}`,
    });
  }

  // rails: one sentence per (action, method, unit), directions merged
  const rails = new Map<
    string,
    { action: 'added' | 'removed'; method: string; unit?: string; directions: Set<Direction> }
  >();
  for (const fact of facts) {
    if (fact.kind !== 'rail') continue;
    // `sat` is the ordinary unit; naming it adds noise. Anything else (msat,
    // usd) is part of what changed and has to be said.
    const unit = fact.unit && fact.unit !== 'sat' ? fact.unit : undefined;
    const key = `${fact.action}|${fact.method}|${unit ?? ''}`;
    const bucket = rails.get(key);
    if (bucket) bucket.directions.add(fact.direction);
    else
      rails.set(key, {
        action: fact.action,
        method: fact.method,
        ...(unit ? { unit } : {}),
        directions: new Set([fact.direction]),
      });
  }
  for (const rail of rails.values()) {
    const scope = directionsPhrase(rail.directions, '&');
    const unit = rail.unit ? ` in ${rail.unit}` : '';
    phrases.push({
      rank: rail.action === 'added' ? RANK.railAdded : RANK.railRemoved,
      icon: RAIL_ICONS[rail.method] ?? ICON.rail,
      tone: rail.action === 'added' ? 'success' : 'danger',
      text: `${rail.action === 'added' ? 'added' : 'dropped'} ${railName(rail.method)} ${scope}${unit}`,
    });
  }

  phrases.push(...phraseLimits(facts.filter((f): f is LimitFact => f.kind === 'limit')));

  for (const fact of facts) {
    if (fact.kind !== 'notice') continue;
    phrases.push({
      rank: RANK.notice,
      icon: ICON.notice,
      tone: fact.text ? 'warning' : 'muted',
      text: fact.text
        ? `posted a notice: “${truncate(fact.text, NOTICE_MAX)}”`
        : 'cleared its notice',
      ...(fact.text && fact.text.length > NOTICE_MAX ? { detail: fact.text } : {}),
    });
  }

  // capabilities, merged per action
  for (const action of ['added', 'removed'] as const) {
    const names = [
      ...new Set(
        facts
          .filter(
            (f): f is Extract<MintChangeFact, { kind: 'feature' }> =>
              f.kind === 'feature' && f.action === action
          )
          .map((f) => f.feature)
      ),
    ];
    if (names.length === 0) continue;
    const verb = action === 'added' ? 'added' : 'dropped';
    phrases.push({
      rank: RANK.feature,
      icon: ICON.feature,
      tone: action === 'added' ? 'success' : 'danger',
      // Beyond three, naming them all is a paragraph — count them instead, and
      // keep the names for the detail screen.
      text:
        names.length > MAX_NAMED_FEATURES
          ? `${verb} ${names.length} capabilities`
          : `${verb} ${listNames(names)}`,
      ...(names.length > MAX_NAMED_FEATURES ? { detail: listNames(names) } : {}),
    });
  }

  phrases.push(...phraseIdentity(facts));

  const others = [...new Set(facts.filter((f) => f.kind === 'other').map((f) => f.text))];
  for (const text of others) {
    phrases.push({ rank: RANK.other, icon: ICON.other, tone: 'muted', text });
  }

  const software = facts.find((f) => f.kind === 'software');
  if (software) {
    const switched = software.switched && !!software.impl;
    // The sentence already names the implementation when it switched, so the
    // detail only has to carry what the sentence left out.
    const detail = switched
      ? software.version
      : [software.impl, software.version].filter(Boolean).join(' ');
    phrases.push({
      rank: RANK.software,
      icon: ICON.software,
      tone: 'muted',
      text: switched ? `switched to ${software.impl}` : 'updated its software',
      ...(detail ? { detail } : {}),
    });
  }

  // Two different facts can land on the same sentence (a min and a max both
  // removed each read as "removed its limits"). Say it once.
  const seen = new Set<string>();
  return phrases
    .sort((a, b) => a.rank - b.rank)
    .filter((phrase) => {
      if (seen.has(phrase.text)) return false;
      seen.add(phrase.text);
      return true;
    });
}

type IdentityFact = Extract<MintChangeFact, { kind: 'identity' }>;

function phraseIdentity(facts: readonly MintChangeFact[]): MintChangePhrase[] {
  const identity = facts.filter((f): f is IdentityFact => f.kind === 'identity');
  if (identity.length === 0) return [];

  // Name, description and icon moving together is one event: the mint redid its
  // profile. Saying it three times is exactly the verbosity this file exists to
  // remove.
  const cosmetic = identity.filter(
    (f) => f.field === 'name' || f.field === 'description' || f.field === 'icon'
  );
  const rest = identity.filter((f) => !cosmetic.includes(f));
  const phrases: MintChangePhrase[] = [];

  const cosmeticFields = new Set(cosmetic.map((f) => f.field));
  if (cosmeticFields.size > 1) {
    phrases.push({
      rank: RANK.identity,
      icon: ICON.profile,
      tone: 'muted',
      text: 'updated its profile',
    });
  } else if (cosmetic.length > 0) {
    phrases.push({
      rank: RANK.identity,
      icon: ICON.profile,
      tone: 'muted',
      text: cosmeticText(cosmetic[0]!),
    });
  }

  const seen = new Set<string>();
  for (const fact of rest) {
    const text = otherIdentityText(fact);
    if (seen.has(text)) continue;
    seen.add(text);
    phrases.push({ rank: RANK.identity, icon: identityIcon(fact.field), tone: 'muted', text });
  }
  return phrases;
}

/** Contact, address and terms each get their own glyph; the rest read as profile. */
function identityIcon(field: IdentityFact['field']): string {
  if (field === 'contact') return ICON.contact;
  if (field === 'urls') return ICON.address;
  if (field === 'tos') return ICON.terms;
  return ICON.profile;
}

function cosmeticText(fact: IdentityFact): string {
  if (fact.field === 'icon') {
    return fact.action === 'removed' ? 'removed its icon' : 'changed its icon';
  }
  if (fact.field === 'description') {
    return fact.action === 'removed' ? 'removed its description' : 'updated its description';
  }
  if (fact.action === 'removed') return 'removed its name';
  // The row already shows the mint under its NEW name, so naming the old one is
  // what actually tells the reader something.
  if (fact.previous) return `renamed itself from ${fact.previous}`;
  return fact.detail ? `renamed itself to ${fact.detail}` : 'changed its name';
}

function otherIdentityText(fact: IdentityFact): string {
  if (fact.field === 'contact') {
    if (fact.action === 'added') {
      return fact.detail
        ? `added ${article(fact.detail)} ${fact.detail} contact`
        : 'added a contact';
    }
    return fact.action === 'removed' ? 'removed a contact' : 'updated its contact details';
  }
  if (fact.field === 'urls') {
    if (fact.action === 'added') {
      return fact.detail === 'tor' ? 'added a Tor address' : 'added a new address';
    }
    return fact.action === 'removed' ? 'removed an address' : 'changed its addresses';
  }
  return fact.action === 'removed'
    ? 'removed its terms of service'
    : 'updated its terms of service';
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

/**
 * "Sovran added Onchain sending & receiving" — the collapsed row's one line.
 * A revision made entirely of protocol bookkeeping leaves no phrase; the row
 * still exists, so name the thing that did happen.
 */
export function mintChangeSentence(mintName: string, phrase: MintChangePhrase | undefined): string {
  return `${mintName} ${phrase?.text ?? 'updated its details'}`;
}

/** Standalone sentence for the detail screen, where the mint is already named. */
export function capitalize(text: string): string {
  return text.length > 0 ? text[0]!.toUpperCase() + text.slice(1) : text;
}
