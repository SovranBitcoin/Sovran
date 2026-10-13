import { expect, test } from 'bun:test';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools';
import { unwrapEvent } from 'nostr-tools/nip59';
import { messageFor } from './person';

test('a message for someone is one only they can open, from the sender, and it expires', () => {
  const sender = generateSecretKey();
  const reader = generateSecretKey();
  const wrap = messageFor(sender, getPublicKey(reader), 'cashuBtoken', 1_000_000);

  expect(verifyEvent(wrap)).toBe(true);
  expect(wrap.kind).toBe(1059);
  // Signed by a key used once, so nothing on the relay says who sent it.
  expect(wrap.pubkey).not.toBe(getPublicKey(sender));
  expect(wrap.tags).toEqual([
    ['p', getPublicKey(reader)],
    ['expiration', '1000060'],
  ]);
  const opened = unwrapEvent(wrap, reader);
  expect(opened).toMatchObject({ kind: 14, content: 'cashuBtoken', pubkey: getPublicKey(sender) });
  expect(() => unwrapEvent(wrap, generateSecretKey())).toThrow();
});
