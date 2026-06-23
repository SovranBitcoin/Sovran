import type { NoteStatsMap } from '@sovranbitcoin/schemas';
import type { NaggProfileInfo } from '../../map/feed';
import type { CachedNote, NostrEntityCache } from './entity-cache';

// ---------------------------------------------------------------------------
// readThread — a synchronous projection of "what the cache holds for a thread".
//
// Opening a post should paint instantly from data the feed/notifications already
// ingested. This walks UP from the tapped note via NIP-10 `e` tags to gather the
// cached ancestor chain (root + parents) plus any cached quoted events, and the
// author profiles + metrics for every note in that set. It deliberately does NOT
// discover replies (descendants): those are the network delta the caller fetches
// next, ranked. The caller runs its own NIP-10 tree builder over `relatedNotes`.
//
// Pure and framework-free: a binding calls it on first render, then subscribes to
// the cache stores to revalidate as the delta lands.
// ---------------------------------------------------------------------------

export type CachedThreadView = {
  /** The tapped note, if already cached (else the caller must fetch it). */
  root: CachedNote | undefined;
  /** Cached ancestors + quoted bodies connected to the root (excludes the root). */
  relatedNotes: CachedNote[];
  /** name+picture for every author present in root + relatedNotes + quoted. */
  profiles: Record<string, NaggProfileInfo>;
  /** Aggregate metrics for every note present. */
  stats: NoteStatsMap;
  /** Quoted (`q` tag) event bodies we already hold, keyed by id. */
  quoted: Record<string, CachedNote>;
};

function addProfile(out: Record<string, NaggProfileInfo>, cache: NostrEntityCache, pubkey: string): void {
  if (out[pubkey]) return;
  const profile = cache.getProfile(pubkey);
  if (!profile) return;
  out[pubkey] = { name: profile.name ?? '', ...(profile.picture ? { picture: profile.picture } : {}) };
}

export function readThread(cache: NostrEntityCache, noteId: string): CachedThreadView {
  const root = cache.getNote(noteId);
  const collected = new Map<string, CachedNote>();
  const quoted: Record<string, CachedNote> = {};
  const visited = new Set<string>();
  const queue: string[] = [];

  if (root) {
    collected.set(root.id, root);
    queue.push(root.id);
  }

  // Breadth-first walk up the reply graph via `e` tags; collect `q` targets too.
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    const note = collected.get(id) ?? cache.getNote(id);
    if (!note) continue;
    collected.set(note.id, note);
    for (const tag of note.tags) {
      const ref = tag[1];
      if (!ref) continue;
      if (tag[0] === 'e' && !visited.has(ref)) {
        const ancestor = cache.getNote(ref);
        if (ancestor) {
          collected.set(ancestor.id, ancestor);
          queue.push(ancestor.id);
        }
      } else if (tag[0] === 'q') {
        const q = cache.getNote(ref);
        if (q) quoted[ref] = q;
      }
    }
  }

  const relatedNotes = [...collected.values()].filter((note) => note.id !== noteId);

  const profiles: Record<string, NaggProfileInfo> = {};
  const stats: NoteStatsMap = {};
  for (const note of [...collected.values(), ...Object.values(quoted)]) {
    addProfile(profiles, cache, note.pubkey);
    const noteStats = cache.getNoteStats(note.id);
    if (noteStats) stats[note.id] = noteStats;
  }

  return { root, relatedNotes, profiles, stats, quoted };
}
