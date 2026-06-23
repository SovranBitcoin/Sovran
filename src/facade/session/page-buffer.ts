// ---------------------------------------------------------------------------
// PageBuffer — the no-reshuffle core of a surface session
//
// A relay-only surface must FEEL like a normal paginated API while a background
// listener streams newer items. The rule the user cares about: what's on screen
// never re-sorts under the thumb. This buffer encodes that as a state machine:
//
//   • `seed` sets the first page and FREEZES a `cutoff` at its newest item.
//   • `appendOlder` adds an older page at the bottom — the visible top is untouched.
//   • `offerNew` (the listener) withholds anything newer than the cutoff; it does
//     NOT inject it. `pendingNew` counts it — that's the "Load new" pill.
//   • `revealNew` is the ONLY sanctioned reshuffle: on an explicit tap, withheld
//     items merge in and the cutoff advances.
//
// Items are kept globally sorted newest-first by a stable (created_at, id) key and
// de-duped by id, so concurrent relay delivery collapses into one ordered set.
// Pure and synchronous — the fetch/listen plumbing lives above it.
// ---------------------------------------------------------------------------

export type SortKey = { createdAt: number; id: string };

/** Order newest-first: later `created_at` wins; ties broken by id descending (stable). */
export function compareNewestFirst(a: SortKey, b: SortKey): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

/** True when `a` sorts strictly before `b` (i.e. `a` is newer). */
export function isNewer(a: SortKey, b: SortKey): boolean {
  return compareNewestFirst(a, b) < 0;
}

export type PageBufferOptions<T> = {
  keyOf: (item: T) => SortKey;
};

export interface PageBuffer<T> {
  /** Current on-screen items, newest-first. Never reshuffles except via `revealNew`. */
  readonly revealed: ReadonlyArray<T>;
  /** How many newer items the listener is holding back behind the "Load new" pill. */
  readonly pendingNew: number;
  /** Set/replace the first page; freezes the new-item cutoff at its newest entry. */
  seed(items: readonly T[]): void;
  /** Add an older page (from a load-older fetch) at the bottom. */
  appendOlder(items: readonly T[]): void;
  /** Offer listener items; those newer than the cutoff and unseen are withheld. */
  offerNew(items: readonly T[]): void;
  /** Reveal the withheld newer items and advance the cutoff. Returns the new `revealed`. */
  revealNew(): ReadonlyArray<T>;
  /** Oldest revealed key — the bound for the next load-older fetch (`until`). */
  oldestKey(): SortKey | undefined;
  /** Newest revealed key — the bound for the listener (`since`). */
  newestKey(): SortKey | undefined;
}

export function createPageBuffer<T>(options: PageBufferOptions<T>): PageBuffer<T> {
  const { keyOf } = options;
  let revealed: T[] = [];
  const withheld = new Map<string, T>();
  const seen = new Set<string>();
  let cutoff: SortKey | null = null;

  function sortInPlace(items: T[]): void {
    items.sort((a, b) => compareNewestFirst(keyOf(a), keyOf(b)));
  }

  return {
    get revealed() {
      return revealed;
    },
    get pendingNew() {
      return withheld.size;
    },
    seed(items) {
      revealed = [];
      withheld.clear();
      seen.clear();
      for (const item of items) {
        const { id } = keyOf(item);
        if (seen.has(id)) continue;
        seen.add(id);
        revealed.push(item);
      }
      sortInPlace(revealed);
      cutoff = revealed.length > 0 ? keyOf(revealed[0]) : null;
    },
    appendOlder(items) {
      let added = false;
      for (const item of items) {
        const { id } = keyOf(item);
        if (seen.has(id)) continue;
        seen.add(id);
        revealed.push(item);
        added = true;
      }
      if (added) sortInPlace(revealed);
    },
    offerNew(items) {
      for (const item of items) {
        const key = keyOf(item);
        if (seen.has(key.id)) continue;
        // Only items strictly newer than the frozen cutoff are "new". Without a
        // cutoff (empty first page) everything is new.
        if (cutoff && !isNewer(key, cutoff)) continue;
        seen.add(key.id);
        withheld.set(key.id, item);
      }
    },
    revealNew() {
      if (withheld.size > 0) {
        revealed = [...revealed, ...withheld.values()];
        withheld.clear();
        sortInPlace(revealed);
        cutoff = revealed.length > 0 ? keyOf(revealed[0]) : cutoff;
      }
      return revealed;
    },
    oldestKey() {
      return revealed.length > 0 ? keyOf(revealed[revealed.length - 1]) : undefined;
    },
    newestKey() {
      return revealed.length > 0 ? keyOf(revealed[0]) : undefined;
    },
  };
}
