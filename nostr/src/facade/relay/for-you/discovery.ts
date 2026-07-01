import type { NaggFeedEvent } from '../../../map/feed';

// ---------------------------------------------------------------------------
// Relay For-You discovery — pure ranking primitives
//
// The relay floor can't rank server-side, so For-You is built from the viewer's
// OWN signal: the accounts whose posts they like. These pure functions turn raw
// kind-7 reactions into a ranked candidate-author set and then rank the notes
// those authors posted. No I/O here — the orchestrator (build.ts) drives the
// relay round-trips and feeds events in, so every ranking rule is unit-testable.
//
// The same primitive serves three callers, distinguished by `source`:
//   - viewer:  reactions authored by the viewer → who the VIEWER likes.
//   - one-hop: reactions authored by the viewer's liked authors → who THEY like
//              (the "melting pot" expansion when the viewer's own likes are thin).
//   - curated: reactions authored by curated accounts → cold-start melting pot.
// ---------------------------------------------------------------------------

const REACTION_KIND = 7;
const NOTE_KIND = 1;

export type CandidateSource = 'viewer' | 'one-hop' | 'curated';

export type CandidateAuthor = {
  /** The liked author (hex pubkey) — a candidate whose notes we'll surface. */
  pubkey: string;
  /** Affinity weight: viewer-like COUNT for `viewer`, distinct-liker count otherwise. */
  score: number;
  /** Total usable reactions toward this author in the batch. */
  likeCount: number;
  /** Distinct seed authors who liked this author (popularity within a melting pot). */
  likedBy: string[];
  /** Most recent reaction timestamp toward this author — recency tiebreak. */
  latestLikeAt: number;
  source: CandidateSource;
};

/**
 * The author of the post a kind-7 reaction points at. Per NIP-25 a reaction
 * SHOULD carry an `e` tag (the liked event) and a `p` tag (its author); the
 * author convention is the LAST `p` tag (earlier ones can be inherited mentions).
 * We require BOTH an `e` and a `p` so we only count reactions to actual notes,
 * not profile-only reactions. Returns null when the reaction is unusable.
 */
export function targetAuthorFromReaction(event: NaggFeedEvent): string | null {
  if (event.kind !== REACTION_KIND) return null;
  let hasETag = false;
  let lastPTag: string | null = null;
  for (const tag of event.tags) {
    if (tag[0] === 'e' && typeof tag[1] === 'string' && tag[1].length > 0) hasETag = true;
    else if (tag[0] === 'p' && typeof tag[1] === 'string' && tag[1].length > 0) lastPTag = tag[1];
  }
  return hasETag ? lastPTag : null;
}

/**
 * Tally a batch of kind-7 reactions into ranked candidate authors. `viewer`
 * scores by how many times the seed liked each author (personal affinity);
 * `one-hop`/`curated` score by how many DISTINCT seeds liked each author
 * (melting-pot popularity). The viewer is always excluded from their own feed.
 */
export function tallyLikedAuthors(
  reactions: ReadonlyArray<NaggFeedEvent>,
  options: { source: CandidateSource; excludePubkey?: string },
): CandidateAuthor[] {
  const byAuthor = new Map<
    string,
    { likeCount: number; likedBy: Set<string>; latestLikeAt: number }
  >();

  for (const reaction of reactions) {
    const author = targetAuthorFromReaction(reaction);
    if (!author || author === options.excludePubkey) continue;
    const entry = byAuthor.get(author) ?? { likeCount: 0, likedBy: new Set<string>(), latestLikeAt: 0 };
    entry.likeCount += 1;
    if (reaction.pubkey) entry.likedBy.add(reaction.pubkey);
    if (reaction.created_at > entry.latestLikeAt) entry.latestLikeAt = reaction.created_at;
    byAuthor.set(author, entry);
  }

  const candidates: CandidateAuthor[] = [];
  for (const [pubkey, entry] of byAuthor) {
    const likedBy = [...entry.likedBy];
    candidates.push({
      pubkey,
      score: options.source === 'viewer' ? entry.likeCount : likedBy.length,
      likeCount: entry.likeCount,
      likedBy,
      latestLikeAt: entry.latestLikeAt,
      source: options.source,
    });
  }
  return sortCandidates(candidates);
}

/**
 * Union candidate groups (caller passes higher-priority groups first, e.g. the
 * viewer's own likes before one-hop), de-duped by pubkey keeping the first
 * (highest-priority) occurrence, then re-sorted and capped. `exclude` drops
 * authors already covered (e.g. the viewer).
 */
export function mergeCandidates(
  groups: ReadonlyArray<ReadonlyArray<CandidateAuthor>>,
  options: { maxAuthors: number; exclude?: ReadonlyArray<string> },
): CandidateAuthor[] {
  const excluded = new Set(options.exclude ?? []);
  const byPubkey = new Map<string, CandidateAuthor>();
  for (const group of groups) {
    for (const candidate of group) {
      if (excluded.has(candidate.pubkey) || byPubkey.has(candidate.pubkey)) continue;
      byPubkey.set(candidate.pubkey, candidate);
    }
  }
  return sortCandidates([...byPubkey.values()]).slice(0, options.maxAuthors);
}

/** Distinct usable target authors across a reaction batch — drives the widen/stop loop. */
export function distinctTargetAuthors(reactions: ReadonlyArray<NaggFeedEvent>): number {
  const authors = new Set<string>();
  for (const reaction of reactions) {
    const author = targetAuthorFromReaction(reaction);
    if (author) authors.add(author);
  }
  return authors.size;
}

/**
 * Rank candidate authors' notes by author affinity, then recency, then id (stable),
 * enforcing a per-author cap so one prolific author can't flood the page. Returns
 * the full ranked id list plus a lookup; the orchestrator caches this and paginates
 * by slicing, so the order is materialized once and never reshuffles between pages.
 */
export function rankNotes(args: {
  notes: ReadonlyArray<NaggFeedEvent>;
  candidates: ReadonlyArray<CandidateAuthor>;
  perAuthorCap: number;
}): { rankedIds: string[]; eventsById: Map<string, NaggFeedEvent> } {
  const scoreByAuthor = new Map<string, number>();
  for (const candidate of args.candidates) scoreByAuthor.set(candidate.pubkey, candidate.score);

  const eventsById = new Map<string, NaggFeedEvent>();
  for (const note of args.notes) {
    if (note.kind !== NOTE_KIND || !note.id) continue;
    if (!eventsById.has(note.id)) eventsById.set(note.id, note);
  }

  const sorted = [...eventsById.values()].sort((a, b) => {
    const sa = scoreByAuthor.get(a.pubkey) ?? 0;
    const sb = scoreByAuthor.get(b.pubkey) ?? 0;
    if (sb !== sa) return sb - sa;
    if (b.created_at !== a.created_at) return b.created_at - a.created_at;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  const perAuthor = new Map<string, number>();
  const rankedIds: string[] = [];
  for (const note of sorted) {
    const used = perAuthor.get(note.pubkey) ?? 0;
    if (used >= args.perAuthorCap) continue;
    perAuthor.set(note.pubkey, used + 1);
    rankedIds.push(note.id);
  }
  return { rankedIds, eventsById };
}

/** Stable candidate ordering: score desc, then most-recent like desc, then pubkey. */
function sortCandidates(candidates: CandidateAuthor[]): CandidateAuthor[] {
  return candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.latestLikeAt !== a.latestLikeAt) return b.latestLikeAt - a.latestLikeAt;
    return a.pubkey < b.pubkey ? -1 : a.pubkey > b.pubkey ? 1 : 0;
  });
}
