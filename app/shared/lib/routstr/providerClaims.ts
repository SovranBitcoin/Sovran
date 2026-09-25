/**
 * @fileoverview Who is allowed to say what about a provider.
 *
 * Five parties describe a Routstr provider and they do not agree. The node
 * describes itself at `/v1/info`. Its operator signs a kind-38421 announcement.
 * nagg aggregates both across the network. Every OTHER node serves a
 * `/v1/providers/` directory of its peers. And this app reads a catalog when
 * the user opens a provider's page.
 *
 * These used to be merged by writing them one after another into a single
 * mutable record, so the answer was whichever party spoke last. That is the
 * wrong question. A provider's name is a thing the provider knows and a peer
 * node is repeating; when they disagree the provider is right, whatever the
 * order the network happened to deliver them in. Arrival order was also not
 * stable — two discovery sweeps 13ms apart merged 50 and 45 announcements into
 * 38 and 37 rows — so the same list rendered differently on each open.
 *
 * So nothing is merged on write. Each source's claim is kept as its own
 * record, and the displayed value is resolved per field by AUTHORITY:
 *
 *   name         self → announcement → aggregator → peer
 *   pubkey       self → announcement → aggregator          (never a peer)
 *   mints        self → aggregator → announcement → peer
 *   e2ee         catalog
 *
 * Two rules make it hold:
 *
 *  - **Nothing is invented.** A provider with no name resolves to `null`, and
 *    the hostname shown in its place is produced at the point of RENDER. Both
 *    discovery readers used to substitute the hostname for a missing name,
 *    which is indistinguishable from a real one the moment it is stored — so a
 *    peer's guess overwrote the provider's own name and 14 of 15 rows turned
 *    into URLs in a single write.
 *  - **`pubkey` is an identity claim, so only self-attestation counts.** A
 *    peer directory listing someone else's endpoint has no standing to say who
 *    runs it, and an announcement speaks only for the key that SIGNED it.
 *    Without this, publishing a kind-38421 naming another operator's endpoint
 *    silently rebrands their row.
 *
 * Absence is not a claim. An undefined field, an empty string and an empty
 * mint list all mean "this source did not say" and fall through to the next —
 * an empty mint list in particular reads as "accepts any mint" everywhere else
 * in the app, so treating it as an answer would erase a real one. `e2ee: false`
 * IS an answer, because only a catalog read can produce it.
 */

/** A party that describes providers, in the app's own vocabulary. */
export type ProviderSource =
  /** The node's own `/v1/info`. It is the subject; nobody outranks it. */
  | 'self'
  /** A kind-38421 announcement, attributed to the key that signed it. */
  | 'announcement'
  /** nagg, which has read the whole network and resolved the operators. */
  | 'aggregator'
  /** Another node's `/v1/providers/` directory — hearsay about a third party. */
  | 'peer'
  /** This app's own catalog read. The only party that can answer `e2ee`. */
  | 'catalog'
  /** Everything the single mutable record held before this model existed.
   *  Ranked last: it cannot say which party any of it came from. */
  | 'legacy';

/** One party's statement about one provider. Every field optional — a source
 *  says what it knows and stays silent about the rest. */
export interface ProviderClaim {
  name?: string;
  description?: string;
  version?: string;
  /** Hex, never an npub — the form every profile read in this app takes. */
  pubkey?: string;
  mints?: string[];
  e2ee?: boolean;
}

/** Everything said about one provider, kept apart by who said it. */
export interface ProviderRecord {
  claims: Partial<Record<ProviderSource, ProviderClaim>>;
}

/** One provider as the app should show it. `null` means nobody has said. */
export interface ResolvedProvider {
  baseUrl: string;
  /** The provider's published name. `null` when none was published — the
   *  hostname belongs to the row that renders it, never to this record. */
  name: string | null;
  description: string | null;
  version: string | null;
  pubkey: string | null;
  /** Empty means it publishes no list, which the payment path reads as
   *  "any mint". */
  mints: string[];
  /** `null` until a catalog has been read for it — absence of evidence. */
  e2ee: boolean | null;
}

/**
 * Authority per field, most authoritative first.
 *
 * Deliberately per field rather than one ranking of sources: nagg outranks an
 * announcement on `mints`, because it reads the node's live `/v1/info` while
 * an announcement carries whatever was true when it was published, and an
 * announcement outranks nagg on `name`, because the operator wrote it.
 */
const AUTHORITY = {
  name: ['self', 'announcement', 'aggregator', 'peer', 'legacy'],
  description: ['self', 'announcement', 'aggregator', 'peer', 'legacy'],
  // A peer directory does carry versions, and a stale version beats no
  // version on the provider page. It cannot reach `name` or `pubkey` the same
  // way because those are claims about identity, not about a build.
  version: ['self', 'peer', 'legacy'],
  pubkey: ['self', 'announcement', 'aggregator', 'legacy'],
  mints: ['self', 'aggregator', 'announcement', 'peer', 'legacy'],
  e2ee: ['catalog', 'legacy'],
} satisfies Record<keyof ProviderClaim, ProviderSource[]>;

/** Did this source actually say something? Empty string and empty array are
 *  silence; `false` is an answer. */
function said(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Drop everything this source did not actually say, so a partial update
 *  cannot erase what the same source said earlier. */
function cleanClaim(claim: ProviderClaim): ProviderClaim {
  const out: ProviderClaim = {};
  if (said(claim.name)) out.name = claim.name?.trim();
  if (said(claim.description)) out.description = claim.description?.trim();
  if (said(claim.version)) out.version = claim.version?.trim();
  if (said(claim.pubkey)) out.pubkey = claim.pubkey?.trim();
  if (said(claim.mints)) out.mints = claim.mints;
  if (said(claim.e2ee)) out.e2ee = claim.e2ee;
  return out;
}

function sameStrings(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function sameClaim(a: ProviderClaim | undefined, b: ProviderClaim): boolean {
  if (!a) return false;
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.version === b.version &&
    a.pubkey === b.pubkey &&
    a.e2ee === b.e2ee &&
    sameStrings(a.mints, b.mints)
  );
}

/**
 * Record what one source said, returning the SAME record when it taught
 * nothing.
 *
 * Reference identity is the contract, not an optimisation: a probe sweep
 * writes once per provider and the directory read writes 38 rows at a time,
 * and almost none of those writes carry news. Publishing a fresh record
 * regardless is what re-rendered every row of the list roughly fourteen times
 * per viewing.
 *
 * Within one source the claim MERGES rather than replaces. `/v1/info` arrives
 * in two parts — the liveness probe, then the metadata fetch — and the second
 * must not erase what the first established.
 */
export function withClaim(
  record: ProviderRecord | undefined,
  source: ProviderSource,
  claim: ProviderClaim
): ProviderRecord {
  const existing = record?.claims[source];
  const merged = { ...existing, ...cleanClaim(claim) };
  if (record && sameClaim(existing, merged)) return record;
  return { claims: { ...record?.claims, [source]: merged } };
}

function pick<K extends keyof ProviderClaim>(
  record: ProviderRecord,
  field: K
): ProviderClaim[K] | undefined {
  for (const source of AUTHORITY[field]) {
    const value = record.claims[source]?.[field];
    if (said(value)) return value as ProviderClaim[K];
  }
  return undefined;
}

/** One provider as the app should show it, from everything said about it. */
export function resolveProvider(baseUrl: string, record: ProviderRecord): ResolvedProvider {
  return {
    baseUrl,
    name: pick(record, 'name') ?? null,
    description: pick(record, 'description') ?? null,
    version: pick(record, 'version') ?? null,
    pubkey: pick(record, 'pubkey') ?? null,
    mints: pick(record, 'mints') ?? [],
    e2ee: pick(record, 'e2ee') ?? null,
  };
}

function sameResolved(a: ResolvedProvider, b: ResolvedProvider): boolean {
  return (
    a.baseUrl === b.baseUrl &&
    a.name === b.name &&
    a.description === b.description &&
    a.version === b.version &&
    a.pubkey === b.pubkey &&
    a.e2ee === b.e2ee &&
    sameStrings(a.mints, b.mints)
  );
}

/**
 * Resolve every record, reusing the previous result wherever it still holds.
 *
 * Returns `previous` itself when nothing resolved differently, so a write that
 * only changed a claim nobody outranks — or only moved a housekeeping
 * timestamp — costs no render at all. The rows a list draws are compared, not
 * the claims behind them: a peer repeating a name the provider already gave us
 * is new information about the network and no news at all to the user.
 */
export function resolveProviders(
  records: Record<string, ProviderRecord>,
  previous: Record<string, ResolvedProvider>
): Record<string, ResolvedProvider> {
  const out: Record<string, ResolvedProvider> = {};
  let reused = 0;
  for (const [baseUrl, record] of Object.entries(records)) {
    const resolved = resolveProvider(baseUrl, record);
    const before = previous[baseUrl];
    if (before && sameResolved(before, resolved)) {
      out[baseUrl] = before;
      reused++;
    } else {
      out[baseUrl] = resolved;
    }
  }
  const keys = Object.keys(out);
  return reused === keys.length && keys.length === Object.keys(previous).length ? previous : out;
}

/**
 * Who else claims a different `pubkey` than the one that resolved.
 *
 * An identity contest is worth saying out loud: two signers claiming the same
 * endpoint is either a stale announcement or somebody rebranding another
 * operator's node, and the resolution above deliberately hides which by
 * picking the more authoritative one. Returns the sources that disagree.
 */
export function contestedPubkeySources(record: ProviderRecord): ProviderSource[] {
  const resolved = pick(record, 'pubkey');
  if (!resolved) return [];
  const out: ProviderSource[] = [];
  for (const [source, claim] of Object.entries(record.claims) as [
    ProviderSource,
    ProviderClaim,
  ][]) {
    if (said(claim.pubkey) && claim.pubkey !== resolved) out.push(source);
  }
  return out;
}
