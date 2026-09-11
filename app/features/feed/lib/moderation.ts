import type { FeedItem } from '../components/nostr/feedTypes';

/** NIP-51 preserves unfamiliar tags and keeps private entries private. */
export type MuteList = {
  id: string;
  createdAt: number;
  tags: string[][];
  privateTags: string[][];
};

export function isNewerMuteList(next: MuteList, current: MuteList | null): boolean {
  return (
    !current ||
    next.createdAt > current.createdAt ||
    (next.createdAt === current.createdAt && next.id < current.id)
  );
}

export function mutedValues(list: MuteList | null, type: 'p' | 'e'): string[] {
  if (!list) return [];
  return Array.from(
    new Set(
      list.tags
        .concat(list.privateTags)
        .filter((tag) => tag[0] === type && /^[0-9a-f]{64}$/.test(tag[1] ?? ''))
        .map((tag) => tag[1])
    )
  );
}

export function changeMute(list: MuteList, pubkey: string, blocked: boolean): MuteList {
  const keep = (tag: string[]) => tag[0] !== 'p' || tag[1] !== pubkey;
  if (blocked && mutedValues(list, 'p').includes(pubkey)) return list;
  return {
    id: list.id,
    createdAt: list.createdAt,
    tags: list.tags.filter(keep),
    privateTags: blocked ? list.privateTags.concat([['p', pubkey]]) : list.privateTags.filter(keep),
  };
}

export const REPORT_REASONS = {
  spam: 'Spam',
  nudity: 'Sexual content',
  profanity: 'Harassment or hateful language',
  illegal: 'Illegal content',
  impersonation: 'Impersonation',
  malware: 'Malware',
  other: 'Other abuse',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

/** Only public post IDs belong here. Private messages are reported by author. */
export function reportTags(
  pubkey: string,
  reason: ReportReason,
  publicEventId?: string
): string[][] {
  if (
    !/^[0-9a-f]{64}$/.test(pubkey) ||
    !Object.hasOwn(REPORT_REASONS, reason) ||
    (publicEventId !== undefined && !/^[0-9a-f]{64}$/.test(publicEventId))
  ) {
    throw new Error('Invalid report target');
  }
  const tags = [['p', pubkey, reason]];
  if (publicEventId) tags.push(['e', publicEventId, reason]);
  return tags;
}

export function normalizeDmWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split('\n')
        .map((word) => word.trim().normalize('NFKC').toLowerCase())
        .filter(Boolean)
    )
  )
    .slice(0, 100)
    .map((word) => word.slice(0, 100));
}

/** Literal, case-insensitive phrase matching; no user-supplied regular expressions. */
export function shouldCensorDm(
  content: string,
  enabled: boolean,
  words: readonly string[]
): boolean {
  if (!enabled) return false;
  const normalized = content.normalize('NFKC').toLowerCase();
  return words.some((word) => word.length > 0 && normalized.includes(word));
}

/** Apply remote replacement without discarding older local blocks or pending local choices. */
export function reconcileBlockedPeople(
  current: string[],
  previous: MuteList | null,
  next: MuteList,
  overrides: Record<string, boolean>,
  max = 5_000
): string[] {
  const previousPeople = new Set(mutedValues(previous, 'p'));
  const people = new Set(current.filter((key) => !previousPeople.has(key)));
  for (const key of mutedValues(next, 'p')) people.add(key);
  for (const [key, blocked] of Object.entries(overrides)) {
    if (blocked) people.add(key);
    else people.delete(key);
  }
  if (people.size > max) throw new Error('Mute list exceeds supported size');
  return Array.from(people);
}

/** Filter before deriving video/story navigation, not only when painting cards. */
export function moderateFeedItems(
  items: FeedItem[],
  people: readonly string[],
  ids: readonly string[]
): FeedItem[] {
  if (people.length === 0 && ids.length === 0) return items;
  const blocked = new Set(people);
  const hidden = new Set(ids);
  const canShow = (event: { pubkey: string; id: string } | undefined) =>
    !event || (!blocked.has(event.pubkey) && !hidden.has(event.id));
  return items
    .filter(
      (item) =>
        canShow(item.rootEvent) &&
        !hidden.has(item.rootEventId ?? '') &&
        (item.type === 'note'
          ? canShow(item.event)
          : canShow(item.repostEvent) &&
            canShow(item.originalEvent) &&
            !hidden.has(item.originalEventId))
    )
    .map((item) => {
      if (item.type === 'note' && item.replyPreviewEvents?.some((event) => !canShow(event))) {
        return { ...item, replyPreviewEvents: item.replyPreviewEvents.filter(canShow) };
      }
      if (item.type === 'repost' && item.reposters?.some((person) => blocked.has(person.pubkey))) {
        return {
          ...item,
          reposters: item.reposters.filter((person) => !blocked.has(person.pubkey)),
        };
      }
      return item;
    });
}
