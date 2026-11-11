import { describe, expect, test } from 'vitest';
import {
  eventsAppView,
  profilesAppView,
  threadAppView,
} from '../src/recipes';

const HEX = 'a'.repeat(64);

describe('appview-social bindings', () => {
  test('eventsAppView GETs /nostr/events with an ids CSV', () => {
    const b = eventsAppView([HEX, '']);
    expect(b).toMatchObject({ path: '/nostr/events', method: 'GET', searchParams: { ids: HEX } });
  });

  test('profilesAppView GETs /nostr/profiles with a pubkeys CSV', () => {
    const b = profilesAppView([HEX]);
    expect(b).toMatchObject({ path: '/nostr/profiles', method: 'GET', searchParams: { pubkeys: HEX } });
  });

  test('threadAppView carries the relevance sort + viewer + pool sizes', () => {
    const b = threadAppView({ id: HEX, sort: 'relevant', viewer: HEX, candidateLimit: 200, rankedLimit: 50 });
    expect(b.path).toBe('/nostr/thread');
    expect(b.searchParams).toMatchObject({
      id: HEX,
      sort: 'relevant',
      viewer: HEX,
      candidateLimit: 200,
      rankedLimit: 50,
    });
  });

  test('threadAppView omits sort for the default (new) order', () => {
    const b = threadAppView({ id: HEX });
    expect(b.searchParams).not.toHaveProperty('sort');
    expect(b.searchParams).not.toHaveProperty('viewer');
  });
});
