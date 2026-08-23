import * as nip19 from 'nostr-tools/nip19';

export type MemoMentionToken = {
  start: number;
  end: number;
  query: string;
};

export type MemoMentionEntity = {
  start: number;
  end: number;
  display: string;
  nprofile: string;
};

type MemoNprofileReference = {
  raw: string;
  start: number;
  end: number;
  pubkey: string;
};

const WHITESPACE_RE = /\s/;
const NPROFILE_RE = /\bnprofile1[a-z0-9]+\b/gi;

function clampCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.max(0, Math.min(value.length, Math.trunc(cursor)));
}

function hasValidEntityRange(value: string, entity: MemoMentionEntity): boolean {
  return (
    entity.start >= 0 &&
    entity.end <= value.length &&
    entity.start < entity.end &&
    value.slice(entity.start, entity.end) === entity.display
  );
}

function compareEntityPosition(a: MemoMentionEntity, b: MemoMentionEntity): number {
  return a.start - b.start || a.end - b.end;
}

function uniqueRelayUrls(relays: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const relay of relays) {
    const trimmed = relay.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function findActiveMemoMention(value: string, cursor: number): MemoMentionToken | null {
  const end = clampCursor(value, cursor);

  for (let i = end - 1; i >= 0; i--) {
    const char = value[i];
    if (WHITESPACE_RE.test(char)) return null;
    if (char !== '@') continue;

    const isTokenStart = i === 0 || WHITESPACE_RE.test(value[i - 1]);
    if (!isTokenStart) return null;

    return {
      start: i,
      end,
      query: value.slice(i + 1, end),
    };
  }

  return null;
}

function createMemoMentionDisplay(displayName: string, fallbackName: string): string {
  const normalized = (displayName || fallbackName).replace(/^@+/, '').trim().replace(/\s+/g, ' ');
  return `@${normalized || fallbackName || 'user'}`;
}

export function createMemoMentionNprofile(pubkey: string, relays: readonly string[]): string {
  return nip19.nprofileEncode({ pubkey, relays: uniqueRelayUrls(relays) });
}

export function insertMemoMentionProfile(
  value: string,
  mention: MemoMentionToken,
  profile: { displayName: string; nprofile: string },
  entities: readonly MemoMentionEntity[] = []
): { value: string; cursor: number; entities: MemoMentionEntity[] } {
  const display = createMemoMentionDisplay(profile.displayName, 'user');
  const before = value.slice(0, mention.start);
  const after = value.slice(mention.end);
  const needsTrailingSpace = after.length === 0 || !WHITESPACE_RE.test(after[0]);
  const inserted = `${display}${needsTrailingSpace ? ' ' : ''}`;
  const nextValue = `${before}${inserted}${after}`;
  const delta = inserted.length - (mention.end - mention.start);
  const insertedEntity: MemoMentionEntity = {
    start: before.length,
    end: before.length + display.length,
    display,
    nprofile: profile.nprofile,
  };

  const shiftedEntities = entities.flatMap((entity) => {
    if (entity.end <= mention.start) return [entity];
    if (entity.start >= mention.end) {
      return [{ ...entity, start: entity.start + delta, end: entity.end + delta }];
    }
    return [];
  });

  return {
    value: nextValue,
    cursor: before.length + inserted.length,
    entities: [...shiftedEntities, insertedEntity]
      .filter((entity) => hasValidEntityRange(nextValue, entity))
      .sort(compareEntityPosition),
  };
}

export function reconcileMemoMentionEntities(
  previousValue: string,
  nextValue: string,
  entities: readonly MemoMentionEntity[]
): MemoMentionEntity[] {
  if (previousValue === nextValue) {
    return entities
      .filter((entity) => hasValidEntityRange(nextValue, entity))
      .sort(compareEntityPosition);
  }

  let start = 0;
  while (
    start < previousValue.length &&
    start < nextValue.length &&
    previousValue[start] === nextValue[start]
  ) {
    start += 1;
  }

  let previousEnd = previousValue.length;
  let nextEnd = nextValue.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  const delta = nextValue.length - previousValue.length;
  return entities
    .flatMap((entity) => {
      if (previousEnd <= entity.start) {
        return [{ ...entity, start: entity.start + delta, end: entity.end + delta }];
      }
      if (start >= entity.end) {
        return [entity];
      }
      return [];
    })
    .filter((entity) => hasValidEntityRange(nextValue, entity))
    .sort(compareEntityPosition);
}

export function serializeMemoWithMentions(
  value: string,
  entities: readonly MemoMentionEntity[]
): string {
  const validEntities = entities
    .filter((entity) => hasValidEntityRange(value, entity))
    .sort(compareEntityPosition);
  if (validEntities.length === 0) return value;

  let cursor = 0;
  let result = '';
  for (const entity of validEntities) {
    if (entity.start < cursor) continue;
    result += value.slice(cursor, entity.start);
    result += entity.nprofile;
    cursor = entity.end;
  }
  return result + value.slice(cursor);
}

export function extractMemoNprofileReferences(value: string): MemoNprofileReference[] {
  const references: MemoNprofileReference[] = [];
  for (const match of value.matchAll(NPROFILE_RE)) {
    const raw = match[0];
    const start = match.index ?? 0;
    try {
      const decoded = nip19.decode(raw);
      if (decoded.type !== 'nprofile') continue;
      references.push({ raw, start, end: start + raw.length, pubkey: decoded.data.pubkey });
    } catch {
      // User-supplied memo text can contain nprofile-looking strings; ignore
      // malformed values and leave them visible as plain text.
    }
  }
  return references;
}

export function formatMemoForDisplay(
  value: string,
  getDisplayName: (pubkey: string) => string | undefined
): string {
  const references = extractMemoNprofileReferences(value);
  if (references.length === 0) return value;

  let cursor = 0;
  let result = '';
  for (const reference of references) {
    result += value.slice(cursor, reference.start);
    result += createMemoMentionDisplay(getDisplayName(reference.pubkey) ?? '', reference.pubkey);
    cursor = reference.end;
  }
  return result + value.slice(cursor);
}
