import { describe, expect, test } from 'vitest';
import {
  eventsAppView,
  profilesAppView,
  eventsQueryAppView,
  followStatusAppView,
  ownProfilesAppView,
  dmConversationAppView,
  threadAppView,
  whitenoiseGroupMessagesInput,
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

  test('eventsQueryAppView POSTs the constrained filter body (authors + tags)', () => {
    const b = eventsQueryAppView(whitenoiseGroupMessagesInput({ groupIds: ['g1', 'g2'], limit: 50 }));
    expect(b.path).toBe('/nostr/events/query');
    expect(b.method).toBe('POST');
    expect(b.body).toMatchObject({
      kinds: [445],
      tags: [{ key: 'h', values: ['g1', 'g2'] }],
      limit: 50,
    });
  });

  test('followStatusAppView GETs /nostr/follow-status with viewer + candidates CSV', () => {
    const b = followStatusAppView({ viewer: HEX, candidates: [HEX, 'b'.repeat(64)] });
    expect(b.path).toBe('/nostr/follow-status');
    expect(b.searchParams).toMatchObject({ viewer: HEX, candidates: `${HEX},${'b'.repeat(64)}` });
  });

  test('ownProfilesAppView GETs /nostr/own/profiles', () => {
    const b = ownProfilesAppView([HEX]);
    expect(b).toMatchObject({ path: '/nostr/own/profiles', method: 'GET', searchParams: { pubkeys: HEX } });
  });

  test('dmConversationAppView scopes to a counterparty when given', () => {
    const cp = 'c'.repeat(64);
    const b = dmConversationAppView({ viewer: HEX, counterparty: cp, kinds: [4] });
    expect(b.path).toBe('/nostr/dm/conversation');
    expect(b.searchParams).toMatchObject({ viewer: HEX, counterparty: cp, kinds: '4' });
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
