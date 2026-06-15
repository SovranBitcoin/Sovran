// ---------------------------------------------------------------------------
// Annotation keying (framework-agnostic)
// ---------------------------------------------------------------------------
//
// A transaction's id is NOT stable across its lifecycle: a mint/melt preview
// carries an operation id that differs from the final persisted coco row, and
// an in-flight receive is synthesised with id `receive-<opId>` before it
// finalises under its real id. Writing side-data under the wrong id orphans it.
//
// We solve this with one canonical key derived from the most stable anchor
// available, plus a read-time candidate set so a write that landed under an
// earlier anchor is still found:
//
//   1. `quote:<quoteId>`     — mint, melt (stable across ctx/events/rows)
//   2. `op:<operationId>`    — send, receive (stable across execute → row;
//                               the synthetic `receive-` prefix is stripped so
//                               an in-flight receive and its finalised row map
//                               to the SAME `op:` key)
//   3. `id:<entry.id>`       — fallback
//
// Plus a `raw:<normalisedRaw>` key for scan-time writes that happen before any
// id exists; the writer later bridges it to the entry key with `linkAnnotation`.

/** Minimal shape needed to key any history entry or synthetic preview entry. */
export interface AnnotationEntryLike {
  id?: string;
  type?: string;
  quoteId?: string;
  operationId?: string;
  metadata?: Record<string, unknown> | undefined;
}

const RECEIVE_PREFIX = "receive-";

function stripReceivePrefix(id: string): string | null {
  return id.startsWith(RECEIVE_PREFIX) ? id.slice(RECEIVE_PREFIX.length) : null;
}

function entryOperationId(entry: AnnotationEntryLike): string | undefined {
  if (typeof entry.operationId === "string" && entry.operationId.length > 0) {
    return entry.operationId;
  }
  const metaOp = entry.metadata?.operationId;
  if (typeof metaOp === "string" && metaOp.length > 0) return metaOp;
  if (typeof entry.id === "string" && entry.id.length > 0) {
    const stripped = stripReceivePrefix(entry.id);
    if (stripped) return stripped;
  }
  return undefined;
}

/**
 * Normalise a raw scanned string for keying — strips a leading payment-URI
 * scheme, trims and lower-cases so trivially-different surface forms collapse
 * onto one key. Mirrors the app's scan-history dedupe so existing scan rows
 * migrate cleanly.
 */
export function normaliseAnnotationRaw(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^(nostr|cashu|bitcoin|lightning):/, "");
}

/** Key for a scan-time write that precedes any transaction id. */
export function rawAnnotationKey(raw: string): string {
  return `raw:${normaliseAnnotationRaw(raw)}`;
}

/**
 * The single canonical key to WRITE an annotation under for a given entry.
 * Reads should use `candidateKeys` so a write under an earlier anchor still
 * resolves.
 */
export function annotationKey(entry: AnnotationEntryLike): string {
  if (entry.type === "mint" || entry.type === "melt") {
    if (typeof entry.quoteId === "string" && entry.quoteId.length > 0) {
      return `quote:${entry.quoteId}`;
    }
  }
  const op = entryOperationId(entry);
  if (op) return `op:${op}`;
  return `id:${entry.id ?? ""}`;
}

/**
 * Every key an entry could legitimately have been written under, most-stable
 * first. Read paths look these up in order and use the first hit, so a
 * misaligned write self-heals without a clobber.
 */
export function candidateKeys(entry: AnnotationEntryLike): string[] {
  const keys: string[] = [];
  const push = (key: string) => {
    if (key && !keys.includes(key)) keys.push(key);
  };

  if (entry.type === "mint" || entry.type === "melt") {
    if (typeof entry.quoteId === "string" && entry.quoteId.length > 0) {
      push(`quote:${entry.quoteId}`);
    }
  }
  const op = entryOperationId(entry);
  if (op) push(`op:${op}`);
  if (typeof entry.id === "string" && entry.id.length > 0)
    push(`id:${entry.id}`);

  return keys;
}
