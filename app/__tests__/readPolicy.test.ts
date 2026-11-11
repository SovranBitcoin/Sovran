/**
 * The strategy each read surface's `read.<surface>.request` log carries.
 */
import { readStrategyFor } from '@/shared/lib/read/readPolicy';

it('maps every read surface to its logged strategy', () => {
  const surfaces = [
    'feed',
    'thread',
    'notifications',
    'followers',
    'dmConversations',
    'dmThread',
    'profile',
    'profileFeed',
    'profiles',
    'profileStats',
    'searchProfiles',
    'searchMints',
    'searchPosts',
    'noteStats',
    'socialGraph',
    'discoverMints',
    'mintDetail',
    'mintReviews',
    'mintAudit',
    'mintChanges',
    'paymentRequestInbox',
  ] as const;
  expect(Object.fromEntries(surfaces.map((s) => [s, readStrategyFor(s)]))).toEqual({
    feed: 'sequential',
    thread: 'sequential',
    notifications: 'session',
    followers: 'sequential',
    dmConversations: 'sequential',
    dmThread: 'sequential',
    profile: 'aggregate',
    profileFeed: 'sequential',
    profiles: 'aggregate',
    profileStats: 'aggregate',
    searchProfiles: 'aggregate',
    searchMints: 'sequential',
    searchPosts: 'sequential',
    noteStats: 'http',
    socialGraph: 'aggregate',
    discoverMints: 'sequential',
    mintDetail: 'sequential',
    mintReviews: 'aggregate',
    mintAudit: 'sequential',
    mintChanges: 'sequential',
    paymentRequestInbox: 'sequential',
  });
});
