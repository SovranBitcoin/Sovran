import { nip19 } from 'nostr-tools';
import { notificationPreviewText } from '@/features/feed/lib/notificationPreviewText';
import snapshot from '@/shared/stores/runtime/fixtures/publicDemoSnapshot.json';

it('renders the real demo mention as names while preserving its signed source', () => {
  const event = snapshot.notifications[0].event;
  const before = JSON.stringify(event);
  const profiles = new Map(
    snapshot.profiles.map((e) => {
      const m = JSON.parse(e.content);
      return [e.pubkey, { name: m.display_name || m.name }];
    })
  );
  const preview = notificationPreviewText(event.content, profiles);
  expect(preview).toBe(
    'Shoutout to @kelbie, building @Sovran app. Works like a charm and has tap2pay!'
  );
  expect(JSON.stringify(event)).toBe(before);
});

it('keeps text and URLs unchanged, and treats profile names as literal text', () => {
  const pubkey = 'ab'.repeat(32);
  const uri = `nostr:${nip19.npubEncode(pubkey)}`;
  expect(
    notificationPreviewText(
      `Hello ${uri}\nhttps://example.com`,
      new Map([[pubkey, { name: '$&' }]])
    )
  ).toBe('Hello @$&\nhttps://example.com');
  expect(notificationPreviewText('nostr:nprofile1invalid', undefined)).toBe(
    'nostr:nprofile1invalid'
  );
});

it('bounds an unresolved valid profile mention without pretending it has a name', () => {
  const npub = nip19.npubEncode('ab'.repeat(32));
  expect(notificationPreviewText(`Hi nostr:${npub}`, undefined)).toBe(`Hi @${npub.slice(0, 12)}…`);
});
