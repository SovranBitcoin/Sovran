/**
 * Everything known about one mint, as rows for the Details modal the mint page
 * opens from its footer: what the mint says about itself, how it has been
 * running, what people think of it, who runs it, and when each of those was
 * last read. A fact nobody knows is left out rather than shown as a dash.
 */
import * as nip19 from 'nostr-tools/nip19';

import { selectMintAudit } from '@/features/mint/lib/auditInfo';
import { NUT_TITLES } from '@/features/mint/lib/mintChanges/nuts';
import { getSortedMintInfoContacts } from '@/features/mint/lib/mintInfoContacts';
import { selectMintLiveness } from '@/features/mint/lib/mintLiveness';
import { formatRelative } from '@/shared/lib/date';
import { formatRate } from '@/shared/lib/number';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';
import type { DetailGroup, DetailsSheetItem } from '@/shared/ui/composed/DetailsSheet';

interface MintDetailsSource {
  mintUrl: string;
  /** The page's route entry: seed keys first, then what the bridge read. */
  entry?: Readonly<Record<string, unknown>> | null;
  /** The mint's row in the metadata store. */
  cached?: MintMetadataEntry;
  /** The operator's Nostr identity, as the page resolved it. */
  operator?: { pubkey?: string; name?: string };
  now?: number;
}

const AUDITOR_NAMES: Record<string, string> = { ucash: 'ucash', '8333': '8333.space' };
const AUDIT_STATES: Record<string, string> = {
  OK: 'Working',
  ERROR: 'Failing',
  OFFLINE: 'Offline',
};

/** A value worth a row: not missing, not blank, not NaN. Strings are trimmed. */
function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  // `FormattedString` and other boxed strings from the route entry.
  const s = (typeof value === 'string' || value instanceof String ? String(value) : '').trim();
  return s.length > 0 ? s : undefined;
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A whole number as people write it: 12,345. */
const count = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * When something happened, in words. The store stamps epoch milliseconds; an
 * auditor's own date may be Unix seconds or a date string. Below 1e11 a number
 * cannot be milliseconds since 1973, so it is read as seconds.
 */
function when(value: unknown, now: number): string | undefined {
  let ms: number;
  if (finite(value)) ms = value;
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) ms = Number(value);
  else if (typeof value === 'string' && value.trim()) ms = Date.parse(value);
  else return undefined;
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  if (ms < 1e11) ms *= 1000;
  return text(formatRelative(ms, 'verbose', now));
}

/**
 * The NUTs a mint offers, named. A NUT counts only when its settings are an
 * object that is not `disabled` and, where it says, is `supported` (a NUT-17
 * list of subscriptions counts when it is not empty).
 */
export function supportedNutNames(nuts: unknown): string[] {
  if (!nuts || typeof nuts !== 'object') return [];
  return Object.entries(nuts as Record<string, unknown>)
    .filter(([, setting]) => {
      if (!setting || typeof setting !== 'object') return false;
      const { disabled, supported } = setting as { disabled?: unknown; supported?: unknown };
      if (disabled === true) return false;
      if (supported === undefined) return true;
      return Array.isArray(supported) ? supported.length > 0 : supported === true;
    })
    .map(([nut]) => nut)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((nut) =>
      Object.prototype.hasOwnProperty.call(NUT_TITLES, nut)
        ? `${NUT_TITLES[nut]} (NUT-${nut})`
        : `NUT-${nut}`
    );
}

function npubOf(pubkey: string | undefined): string | undefined {
  if (!pubkey) return undefined;
  try {
    return nip19.npubEncode(pubkey);
  } catch {
    return undefined;
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

export function buildMintDetailsRows({
  mintUrl,
  entry,
  cached,
  operator,
  now = Date.now(),
}: MintDetailsSource): DetailsSheetItem[] {
  const rows: DetailsSheetItem[] = [];
  const add = (group: DetailGroup, title: string, value: string | undefined) => {
    if (value !== undefined) rows.push({ group, title, value });
  };

  // ── The mint, in its own words (NUT-06) ───────────────────────────────────
  const info = cached?.info;
  add('Mint', 'Address', text(mintUrl));
  const name =
    text(entry?.displayName) ??
    text(info?.name) ??
    text(cached?.displayName) ??
    text(entry?.seedDisplayName);
  // A name that is only the address again says nothing the Address row has not.
  add('Mint', 'Name', name === text(mintUrl) ? undefined : name);
  add('Mint', 'Software', text(info?.version));
  add('Mint', 'Mint public key', text(info?.pubkey));
  const units = cached?.supportedUnits?.map(text).filter((u) => u !== undefined);
  add('Mint', 'Units', units?.length ? units.join(', ') : undefined);
  const nuts = supportedNutNames(info?.nuts ?? cached?.nuts);
  add('Mint', 'Supported features', nuts.length ? nuts.join('\n') : undefined);
  add('Mint', 'Message from the mint', text(entry?.motd) ?? text(info?.motd));
  add('Mint', 'Summary', text(entry?.description) ?? text(info?.description));
  add('Mint', 'Full description', text(entry?.longDescription) ?? text(info?.description_long));
  const contacts = getSortedMintInfoContacts(
    (Array.isArray(entry?.contact) ? entry.contact : info?.contact) as
      { method: string; info: string }[] | undefined
  );
  const seenMethods = new Map<string, number>();
  for (const contact of contacts) {
    const method = text(contact.method);
    const value = text(contact.info);
    if (!method || !value) continue;
    const label = `${capitalize(method)} contact`;
    const n = (seenMethods.get(label) ?? 0) + 1;
    seenMethods.set(label, n);
    add('Mint', n === 1 ? label : `${label} ${n}`, value);
  }

  // ── How it has been running (the auditor, and the last liveness check) ────
  const liveness = selectMintLiveness(cached, now);
  add('Reliability', 'Status', liveness === 'unknown' ? undefined : capitalize(liveness));
  const audit = selectMintAudit(cached);
  if (audit) {
    const state = audit.state?.toUpperCase();
    add('Reliability', 'Audit result', state ? (AUDIT_STATES[state] ?? audit.state) : undefined);
    add(
      'Reliability',
      'Success rate',
      finite(audit.successRate) ? formatRate(audit.successRate) : undefined
    );
    add(
      'Reliability',
      'Average time',
      finite(audit.avgLatencyMs) ? `${Math.round(audit.avgLatencyMs)} ms` : undefined
    );
    add('Reliability', 'Total mints', finite(audit.mints) ? count(audit.mints) : undefined);
    add('Reliability', 'Total melts', finite(audit.melts) ? count(audit.melts) : undefined);
    // Errors are the operations behind the rate that were not successes.
    const errors =
      finite(audit.totalOps) && finite(audit.mints) && finite(audit.melts)
        ? audit.totalOps - audit.mints - audit.melts
        : undefined;
    add('Reliability', 'Failed operations', errors !== undefined ? count(errors) : undefined);
    add('Reliability', 'Auditor', audit.source ? AUDITOR_NAMES[audit.source] : undefined);
  }
  // nagg reports uptime as a percentage, 0-100.
  add(
    'Reliability',
    'Uptime, last 24 hours',
    finite(cached?.uptime24h) ? formatRate(cached.uptime24h / 100) : undefined
  );
  add('Reliability', 'Last audited', when(cached?.auditUpdatedAt, now));

  // ── What people think of it ───────────────────────────────────────────────
  const score = [entry?.kymScore, cached?.averageScore, entry?.seedKymScore].find(finite);
  add(
    'Reviews',
    'Average score',
    score !== undefined && score >= 0 ? `${score.toFixed(1)} out of 5` : undefined
  );
  const reviewCount = [cached?.reviewCount, entry?.seedReviewCount].find(finite);
  add('Reviews', 'Number of reviews', reviewCount !== undefined ? count(reviewCount) : undefined);
  add(
    'Reviews',
    'Favourites',
    finite(cached?.favouriteCount) ? count(cached.favouriteCount) : undefined
  );

  // ── Who runs it ───────────────────────────────────────────────────────────
  add('Operator', 'Nostr name', text(operator?.name));
  add('Operator', 'Nostr key', npubOf(operator?.pubkey) ?? text(cached?.operatorNpub));
  // nagg sends 0 when it could not count, so zero is not shown as a fact.
  add(
    'Operator',
    'Followers',
    finite(cached?.contactFollowers) && cached.contactFollowers > 0
      ? count(cached.contactFollowers)
      : undefined
  );
  add(
    'Operator',
    'Reputation',
    finite(cached?.contactReputation)
      ? `${Math.round(cached.contactReputation)} out of 100`
      : undefined
  );
  // 0 until the Vertex cache has the operator.
  add(
    'Operator',
    'Vertex rank',
    finite(cached?.vertexRank) && cached.vertexRank > 0
      ? String(Number(cached.vertexRank.toPrecision(3)))
      : undefined
  );

  // ── When each part was last read on this phone ────────────────────────────
  add('Last updated', 'Mint info', when(cached?.identityAt, now));
  add('Last updated', 'Audit', when(cached?.auditAt, now));
  add('Last updated', 'Reviews', when(cached?.reviewsAt, now));
  add('Last updated', 'Operator', when(cached?.socialAt, now));
  add('Last updated', 'Status check', when(cached?.livenessAt, now));

  return rows;
}
