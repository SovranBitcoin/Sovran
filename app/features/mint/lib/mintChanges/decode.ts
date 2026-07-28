/**
 * nagg's mint-info changelog (`/nostr/mint/changes`) → per-revision entries.
 *
 * This is the mechanical half: identity, ordering, and the JSON Pointer /
 * invertible-patch mechanics that `interpret.ts` builds meaning on top of. The
 * pointer-labelling tables and the `test`-pairing rule are ported from the
 * `Sovran/changes` observatory (`src/decode.ts`) — keep them in sync if the feed
 * shape moves.
 *
 * The upstream feed ships both a `summary` array and a `patch` array per change.
 * The summaries truncate long values at ~50 chars and speak in NUT numbers, so
 * the patch is the source of truth here; summaries are kept only as the last
 * resort for a revision nagg couldn't diff.
 */
import { INFO_FIELDS, LEAF_FIELDS, NUT_TITLES } from './nuts';

/* ── upstream shapes ─────────────────────────────────────────────────── */

export type PatchOp = {
  op: string;
  path: string;
  value?: unknown;
};

export type RawChange = {
  mintUrl: string;
  name?: string;
  at: number;
  previousLastSeenAt?: number;
  hash: string;
  summary?: string[];
  patch?: PatchOp[];
};

export type RawFeed = {
  trackedMints: number;
  reachableMints: number;
  totalChanges: number;
  changes: RawChange[];
};

/* ── decoded shapes ──────────────────────────────────────────────────── */

/** One revision of one mint's info document. */
export type Entry = {
  mintUrl: string;
  host: string;
  name: string;
  at: number;
  /**
   * Seconds since the previous check confirmed the OLD value — the change
   * happened somewhere inside that window, not necessarily at `at`.
   */
  sincePrevious?: number;
  hash: string;
  patch: PatchOp[];
  /** Upstream's own summaries; only shown when the patch yields nothing. */
  summary: string[];
};

type Feed = {
  tracked: number;
  reachable: number;
  total: number;
  entries: Entry[];
};

/* ── pointer decoding ────────────────────────────────────────────────── */

const unescapePointer = (t: string) => t.replace(/~1/g, '/').replace(/~0/g, '~');

/** What one member of a named collection is called. */
const MEMBER: Record<string, string> = {
  methods: 'method',
  supported: 'entry',
  commands: 'command',
  cached_endpoints: 'endpoint',
  protected_endpoints: 'endpoint',
  contact: 'contact',
  urls: 'URL',
  nuts: 'NUT',
};

const nutLabel = (n: string) => {
  const num = /^\d+$/.test(n) ? String(n).padStart(2, '0') : n;
  const title = NUT_TITLES[String(Number(n))];
  return title ? `NUT-${num} ${title}` : `NUT-${num}`;
};

const fieldLabel = (key: string) => LEAF_FIELDS[key] ?? key.replace(/_/g, ' ');

/**
 * Turn a JSON Pointer into human label segments.
 * Returns `append: true` when the pointer targets an array append ("/-").
 */
export function decodePointer(path: string): { label: string[]; append: boolean } {
  const tokens = path.split('/').slice(1).map(unescapePointer);
  const label: string[] = [];
  let append = false;
  let parent = '';

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;

    if (t === '-') {
      append = true; // the container itself is the subject
      break;
    }

    if (/^\d+$/.test(t)) {
      if (parent === 'nuts') {
        label.push(nutLabel(t));
      } else {
        const member = MEMBER[parent] ?? 'item';
        // The first segment opens the sentence, so it carries the capital.
        const shown = i === 1 ? member[0]!.toUpperCase() + member.slice(1) : member;
        label.push(`${shown} ${Number(t) + 1}`);
      }
      continue;
    }

    // A named collection is only worth a segment when it is the leaf; when an
    // index follows, the member name carries it ("method 2", not "methods · method 2").
    const next = tokens[i + 1];
    const indexFollows = next !== undefined && (/^\d+$/.test(next) || next === '-');
    if (t !== 'nuts' && (!indexFollows || next === '-')) {
      label.push(i === 0 ? (INFO_FIELDS[t] ?? fieldLabel(t)) : fieldLabel(t));
    }
    parent = t;
  }

  if (label.length === 0) label.push('mint info');
  return { label, append };
}

/* ── invertible patch pairing ────────────────────────────────────────── */

/** One real change, with the old value its `test` precondition carried. */
type PairedOp = {
  op: string;
  path: string;
  /** New value (`add` / `replace`); absent for `remove`. */
  value?: unknown;
  /** Old value, when the invertible patch supplied a `test` precondition. */
  before?: unknown;
  hadBefore: boolean;
};

/**
 * The patch nagg produces uses `test` as a precondition carrying the OLD value,
 * immediately before the `remove`/`replace` on the same path. Pair them so a
 * change is one event with two sides — and so a removal can report what was
 * actually removed, which only the precondition knows.
 */
export function pairPatchOps(patch: readonly PatchOp[]): PairedOp[] {
  const out: PairedOp[] = [];
  for (let i = 0; i < patch.length; i++) {
    const cur = patch[i]!;
    if (cur.op === 'test') continue; // consumed by the op that follows it
    const prev = patch[i - 1];
    const hadBefore = prev?.op === 'test' && prev.path === cur.path;
    out.push({
      op: cur.op,
      path: cur.path,
      value: cur.value,
      ...(hadBefore ? { before: prev.value } : {}),
      hadBefore,
    });
  }
  return out;
}

/* ── feed ────────────────────────────────────────────────────────────── */

const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.host + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
};

export function decodeFeed(raw: RawFeed): Feed {
  const entries: Entry[] = (raw.changes ?? [])
    .map((c) => ({
      mintUrl: c.mintUrl,
      host: hostOf(c.mintUrl),
      name: c.name?.trim() || hostOf(c.mintUrl),
      at: c.at,
      ...(typeof c.previousLastSeenAt === 'number' && c.previousLastSeenAt > 0
        ? { sincePrevious: c.at - c.previousLastSeenAt }
        : {}),
      hash: c.hash,
      patch: c.patch ?? [],
      summary: c.summary ?? [],
    }))
    // Upstream already sends newest first; do not depend on it.
    .sort((a, b) => b.at - a.at);

  return {
    tracked: raw.trackedMints ?? 0,
    reachable: raw.reachableMints ?? 0,
    total: raw.totalChanges ?? entries.length,
    entries,
  };
}
