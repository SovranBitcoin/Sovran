import { renderHook } from '@testing-library/react-native';
import { nip19, verifyEvent } from 'nostr-tools';
import snapshot from '@/shared/stores/runtime/fixtures/publicDemoSnapshot.json';
import { usePresentationPubkey } from '@/shared/hooks/usePresentationPubkey';
import { useProfileDisplay } from '@/shared/hooks/useProfileDisplay';
import { PUBLIC_DEMO_METADATA } from '@/shared/stores/runtime/mockPublicProfile';

let mockMode = false;
const mockProfiles = [
  {
    pubkey: 'ab'.repeat(32),
    cachedDisplayName: 'Actual wallet',
    cachedPicture: 'https://example.com/real.png',
  },
];
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (state: { mockMode: boolean }) => unknown) => selector({ mockMode }),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: (selector: (state: { profiles: typeof mockProfiles }) => unknown) =>
    selector({ profiles: mockProfiles }),
}));

it('retains authentic signed public events from the requested viewer and follow graph', () => {
  expect(nip19.decode(snapshot.viewerNpub)).toEqual({ type: 'npub', data: snapshot.viewerPubkey });
  const events = [
    snapshot.followEvent,
    ...snapshot.profiles,
    ...snapshot.feed,
    ...snapshot.targets,
    ...snapshot.notifications.map((n) => n.event),
  ];
  for (const event of events) expect(verifyEvent(event)).toBe(true);
  expect(snapshot.followEvent.pubkey).toBe(snapshot.viewerPubkey);
  const follows = new Set(snapshot.followEvent.tags.filter((t) => t[0] === 'p').map((t) => t[1]));
  for (const event of snapshot.feed) {
    expect(follows.has(event.pubkey)).toBe(true);
    expect(event.kind).toBe(1);
    expect(event.tags.some((t) => t[0] === 'e' || t[0] === 'q')).toBe(false);
  }
  for (const notification of snapshot.notifications) {
    expect(notification.event.pubkey).not.toBe(snapshot.viewerPubkey);
    expect(
      notification.event.tags.some((t) => t[0] === 'p' && t[1] === snapshot.viewerPubkey)
    ).toBe(true);
    if (notification.targetEventId) {
      const target = snapshot.targets.find((t) => t.id === notification.targetEventId);
      expect(target?.pubkey).toBe(snapshot.viewerPubkey);
    }
  }
});

it('changes presentation reactively while preserving the active account and its cached metadata', () => {
  mockMode = false;
  const before = JSON.stringify(mockProfiles);
  const { result, rerender } = renderHook(() => {
    const pubkey = usePresentationPubkey(mockProfiles[0].pubkey);
    return { pubkey, ...useProfileDisplay(pubkey) };
  });
  expect(result.current.displayName).toBe('Actual wallet');
  for (const enabled of [true, true, false, true, false]) {
    mockMode = enabled;
    rerender(undefined);
    expect(result.current.pubkey).toBe(enabled ? snapshot.viewerPubkey : mockProfiles[0].pubkey);
    expect(result.current.displayName).toBe(enabled ? 'kelbie' : 'Actual wallet');
    expect(result.current.picture).toBe(
      enabled
        ? PUBLIC_DEMO_METADATA.get(snapshot.viewerPubkey)?.picture
        : mockProfiles[0].cachedPicture
    );
    expect(JSON.stringify(mockProfiles)).toBe(before);
  }
});

it('has reviewed local media and avatar-backed notifications for a full demo', () => {
  expect(snapshot.feed.length).toBeGreaterThanOrEqual(6);
  expect(snapshot.notifications.length).toBeGreaterThanOrEqual(7);
  expect(snapshot.bundledMedia).toHaveLength(3);
  for (const notification of snapshot.notifications) {
    expect(PUBLIC_DEMO_METADATA.get(notification.event.pubkey)?.picture).toBeTruthy();
  }
  for (const media of snapshot.bundledMedia) {
    expect(snapshot.feed.find((event) => event.id === media.eventId)?.content).toContain(
      media.sourceUrl
    );
  }
});
