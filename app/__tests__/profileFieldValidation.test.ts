import {
  ABOUT_MAX_LENGTH,
  checkAbout,
  checkLud16,
  checkNip05,
} from '@/shared/lib/nostr/profile/profileFieldValidation';

describe('checkLud16', () => {
  it.each([
    ['alice@getalby.com', 'alice@getalby.com'],
    ['  Alice@GetAlby.com ', 'alice@getalby.com'],
    ['npub1abc@npub.cash', 'npub1abc@npub.cash'],
    ['first.last-name_1@pay.example.org', 'first.last-name_1@pay.example.org'],
    ['', ''],
  ])('accepts and normalises %j', (input, expected) => {
    expect(checkLud16(input)).toEqual({ ok: true, value: expected });
  });
  it.each(['alice', '@getalby.com', 'alice@', 'alice@localhost', 'al ice@x.com', 'a@b@c.com'])(
    'rejects %j',
    (input) => {
      expect(checkLud16(input).ok).toBe(false);
    }
  );
});

describe('checkNip05', () => {
  it.each([
    ['bob@example.com', 'bob@example.com'],
    ['Bob@Example.COM', 'bob@example.com'],
    ['_@example.com', '_@example.com'],
    // A bare domain is NIP-05 shorthand for the root name.
    ['example.com', '_@example.com'],
    ['', ''],
  ])('accepts and normalises %j', (input, expected) => {
    expect(checkNip05(input)).toEqual({ ok: true, value: expected });
  });
  it.each(['bob', 'bob@', 'bö@example.com', 'bob@example', 'bob@ex ample.com'])(
    'rejects %j',
    (input) => {
      expect(checkNip05(input).ok).toBe(false);
    }
  );
});

describe('checkAbout', () => {
  it('trims and caps length', () => {
    expect(checkAbout('  hi  ')).toEqual({ ok: true, value: 'hi' });
    expect(checkAbout('x'.repeat(ABOUT_MAX_LENGTH)).ok).toBe(true);
    expect(checkAbout('x'.repeat(ABOUT_MAX_LENGTH + 1)).ok).toBe(false);
  });
});
