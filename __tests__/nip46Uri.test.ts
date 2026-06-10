/**
 * Pins the NIP-46 pairing URI codec: bunker build/parse round-trips, the
 * nostrconnect field contract (hex pubkey, 1..5 wss relays, bounded secret
 * and metadata), duplicate-param rejection, the manual query-string parser
 * (Hermes-independent — no URLSearchParams), and the perms CSV codec with
 * per-entry drop reporting. The non-negotiables: parse errors never embed
 * raw input (the secret is a bearer credential) and every accepted perm
 * token maps to a real GrantKey.
 */

import type { PermToken } from '@/features/nostrSigner/lib/nip46Types';
import {
  buildBunkerUri,
  buildPermsCsv,
  parseBunkerUri,
  parseNip46Uri,
  parseNostrconnectUri,
  parsePermsCsv,
  parseQueryString,
  type Nip46UriError,
} from '@/features/nostrSigner/lib/nip46Uri';
import { grantKeyFor } from '@/features/nostrSigner/lib/permissionPolicy';

const SIGNER_PUBKEY = 'a'.repeat(64);
const CLIENT_PUBKEY = 'b'.repeat(64);
const SECRET = 'topsecret0123456789';
const RELAY = 'wss://relay.example.com';
const RELAY_2 = 'wss://relay2.example.com';

function nostrconnectUri(
  params: string[],
  pubkey: string = CLIENT_PUBKEY,
  scheme = 'nostrconnect://'
): string {
  return `${scheme}${pubkey}?${params.join('&')}`;
}

const BASE_PARAMS = [`relay=${encodeURIComponent(RELAY)}`, `secret=${SECRET}`];

function errOf(result: { _unsafeUnwrapErr: () => Nip46UriError }): Nip46UriError {
  return result._unsafeUnwrapErr();
}

describe('buildBunkerUri', () => {
  it('produces bunker://<pubkey>?relay=..&relay=..&secret=..', () => {
    const uri = buildBunkerUri({
      signerPubkey: SIGNER_PUBKEY,
      relays: [RELAY, RELAY_2],
      secret: SECRET,
    });
    expect(uri).toBe(
      `bunker://${SIGNER_PUBKEY}?relay=${encodeURIComponent(RELAY)}&relay=${encodeURIComponent(RELAY_2)}&secret=${SECRET}`
    );
  });

  it('percent-encodes reserved characters in relays and secret', () => {
    const uri = buildBunkerUri({
      signerPubkey: SIGNER_PUBKEY,
      relays: ['wss://relay.example.com/path?x=1&y=2'],
      secret: 'a&b=c+d',
    });
    expect(uri).toContain('relay=wss%3A%2F%2Frelay.example.com%2Fpath%3Fx%3D1%26y%3D2');
    expect(uri).toContain('secret=a%26b%3Dc%2Bd');
  });

  it('round-trips through parseBunkerUri, including awkward secrets', () => {
    const input = {
      signerPubkey: SIGNER_PUBKEY,
      relays: [RELAY, RELAY_2, 'wss://relay.example.com:4443/sub?auth=1'],
      secret: 'a&b=c+d e%20f',
    };
    const parsed = parseBunkerUri(buildBunkerUri(input))._unsafeUnwrap();
    expect(parsed).toEqual({ type: 'bunker', ...input });
  });
});

describe('parseNostrconnectUri', () => {
  it('parses a fully populated URI', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([
        ...BASE_PARAMS,
        `relay=${encodeURIComponent(RELAY_2)}`,
        'name=Primal',
        `url=${encodeURIComponent('https://primal.net')}`,
        `image=${encodeURIComponent('https://primal.net/icon.png')}`,
        'perms=sign_event:1,nip44_encrypt',
      ])
    )._unsafeUnwrap();
    expect(parsed).toEqual({
      type: 'nostrconnect',
      clientPubkey: CLIENT_PUBKEY,
      relays: [RELAY, RELAY_2],
      secret: SECRET,
      name: 'Primal',
      url: 'https://primal.net',
      image: 'https://primal.net/icon.png',
      perms: [{ method: 'sign_event', kind: 1 }, { method: 'nip44_encrypt' }],
      droppedPerms: [],
    });
  });

  it('parses a minimal URI with no metadata or perms', () => {
    const parsed = parseNostrconnectUri(nostrconnectUri(BASE_PARAMS))._unsafeUnwrap();
    expect(parsed.name).toBeUndefined();
    expect(parsed.url).toBeUndefined();
    expect(parsed.image).toBeUndefined();
    expect(parsed.perms).toEqual([]);
    expect(parsed.droppedPerms).toEqual([]);
  });

  it('lowercases an uppercase hex pubkey', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri(BASE_PARAMS, CLIENT_PUBKEY.toUpperCase())
    )._unsafeUnwrap();
    expect(parsed.clientPubkey).toBe(CLIENT_PUBKEY);
  });

  it('accepts a case-insensitive scheme, trailing slash, and fragment', () => {
    const uri = `NostrConnect://${CLIENT_PUBKEY}/?${BASE_PARAMS.join('&')}#frag`;
    expect(parseNostrconnectUri(uri)._unsafeUnwrap().secret).toBe(SECRET);
  });

  it('decodes + as space and %2B as a literal plus in metadata', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([...BASE_PARAMS, 'name=My+Nostr%2BApp'])
    )._unsafeUnwrap();
    expect(parsed.name).toBe('My Nostr+App');
  });

  it('decodes percent-encoded UTF-8 metadata', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([...BASE_PARAMS, `name=${encodeURIComponent('Café ⚡')}`])
    )._unsafeUnwrap();
    expect(parsed.name).toBe('Café ⚡');
  });

  it('treats empty or whitespace-only optional metadata as absent', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([...BASE_PARAMS, 'name=+++', 'url=', 'image='])
    )._unsafeUnwrap();
    expect(parsed.name).toBeUndefined();
    expect(parsed.url).toBeUndefined();
    expect(parsed.image).toBeUndefined();
  });

  it('decodes a secret with encoded reserved characters', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([`relay=${encodeURIComponent(RELAY)}`, 'secret=a%26b'])
    )._unsafeUnwrap();
    expect(parsed.secret).toBe('a&b');
  });

  it('ignores unknown query params', () => {
    const result = parseNostrconnectUri(
      nostrconnectUri([...BASE_PARAMS, 'theme=dark', 'foo=bar', 'Relay=wss://shouty.example.com'])
    );
    expect(result._unsafeUnwrap().relays).toEqual([RELAY]);
  });

  it('collapses identical duplicate relay params', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([...BASE_PARAMS, `relay=${encodeURIComponent(RELAY)}`])
    )._unsafeUnwrap();
    expect(parsed.relays).toEqual([RELAY]);
  });

  it('accepts exactly five distinct relays', () => {
    const relays = [1, 2, 3, 4, 5].map((n) => `wss://r${n}.example.com`);
    const parsed = parseNostrconnectUri(
      nostrconnectUri([...relays.map((r) => `relay=${encodeURIComponent(r)}`), `secret=${SECRET}`])
    )._unsafeUnwrap();
    expect(parsed.relays).toEqual(relays);
  });

  it('accepts a 64-char secret and rejects a 65-char one', () => {
    const ok64 = nostrconnectUri([
      `relay=${encodeURIComponent(RELAY)}`,
      `secret=${'s'.repeat(64)}`,
    ]);
    expect(parseNostrconnectUri(ok64).isOk()).toBe(true);
    const too65 = nostrconnectUri([
      `relay=${encodeURIComponent(RELAY)}`,
      `secret=${'s'.repeat(65)}`,
    ]);
    expect(errOf(parseNostrconnectUri(too65))).toEqual({
      type: 'invalid_field',
      issues: ['secret: too_big'],
    });
  });

  it('accepts a 120-char name and rejects a 121-char one', () => {
    const name120 = nostrconnectUri([...BASE_PARAMS, `name=${'n'.repeat(120)}`]);
    expect(parseNostrconnectUri(name120).isOk()).toBe(true);
    const name121 = nostrconnectUri([...BASE_PARAMS, `name=${'n'.repeat(121)}`]);
    expect(errOf(parseNostrconnectUri(name121))).toEqual({
      type: 'invalid_field',
      issues: ['name: too_big'],
    });
  });

  describe('malformed URIs', () => {
    it.each([
      ['empty string', ''],
      ['plain text', 'not a uri'],
      ['http scheme', `http://${CLIENT_PUBKEY}?${BASE_PARAMS.join('&')}`],
      ['nostr scheme', `nostr:${CLIENT_PUBKEY}`],
      ['missing slashes', `nostrconnect:${CLIENT_PUBKEY}?${BASE_PARAMS.join('&')}`],
      [
        'bunker passed to nostrconnect parser',
        `bunker://${SIGNER_PUBKEY}?${BASE_PARAMS.join('&')}`,
      ],
    ])('rejects %s with unsupported_scheme', (_label, raw) => {
      expect(errOf(parseNostrconnectUri(raw)).type).toBe('unsupported_scheme');
    });

    it.each([
      ['63 hex chars', CLIENT_PUBKEY.slice(0, 63)],
      ['65 hex chars', `${CLIENT_PUBKEY}b`],
      ['non-hex chars', 'z'.repeat(64)],
      ['empty pubkey', ''],
      ['npub form', `npub1${'q'.repeat(59)}`],
    ])('rejects pubkey with %s', (_label, pubkey) => {
      const error = errOf(parseNostrconnectUri(nostrconnectUri(BASE_PARAMS, pubkey)));
      expect(error).toEqual({ type: 'invalid_field', issues: ['clientPubkey: invalid_format'] });
    });

    it('rejects a URI with no relays', () => {
      const error = errOf(parseNostrconnectUri(nostrconnectUri([`secret=${SECRET}`])));
      expect(error).toEqual({ type: 'invalid_field', issues: ['relays: too_small'] });
    });

    it('rejects six distinct relays', () => {
      const params = [1, 2, 3, 4, 5, 6].map(
        (n) => `relay=${encodeURIComponent(`wss://r${n}.example.com`)}`
      );
      const error = errOf(parseNostrconnectUri(nostrconnectUri([...params, `secret=${SECRET}`])));
      expect(error).toEqual({ type: 'invalid_field', issues: ['relays: too_big'] });
    });

    it.each([
      ['ws relay', 'ws://relay.example.com'],
      ['https relay', 'https://relay.example.com'],
      ['bare host', 'relay.example.com'],
      ['empty relay value', ''],
    ])('rejects %s', (_label, relay) => {
      const error = errOf(
        parseNostrconnectUri(
          nostrconnectUri([`relay=${encodeURIComponent(relay)}`, `secret=${SECRET}`])
        )
      );
      expect(error.type).toBe('invalid_field');
    });

    it('rejects a missing or empty secret', () => {
      const missing = errOf(
        parseNostrconnectUri(nostrconnectUri([`relay=${encodeURIComponent(RELAY)}`]))
      );
      expect(missing).toEqual({ type: 'invalid_field', issues: ['secret: invalid_type'] });
      const empty = errOf(
        parseNostrconnectUri(nostrconnectUri([`relay=${encodeURIComponent(RELAY)}`, 'secret=']))
      );
      expect(empty).toEqual({ type: 'invalid_field', issues: ['secret: too_small'] });
    });

    it.each([
      ['http url', 'http://primal.net'],
      ['javascript url', 'javascript:alert(1)'],
      ['oversized url', `https://primal.net/${'x'.repeat(2048)}`],
    ])('rejects %s in url/image', (_label, value) => {
      for (const param of ['url', 'image'] as const) {
        const error = errOf(
          parseNostrconnectUri(
            nostrconnectUri([...BASE_PARAMS, `${param}=${encodeURIComponent(value)}`])
          )
        );
        expect(error.type).toBe('invalid_field');
      }
    });

    it.each(['secret', 'name', 'url', 'image', 'perms'])(
      'rejects a duplicated %s param',
      (param) => {
        const params = [...BASE_PARAMS, `${param}=first`, `${param}=second`];
        expect(errOf(parseNostrconnectUri(nostrconnectUri(params)))).toEqual({
          type: 'duplicate_param',
          param,
        });
      }
    );

    it('rejects undecodable percent-encoding with bad_encoding', () => {
      const error = errOf(parseNostrconnectUri(nostrconnectUri([...BASE_PARAMS, 'name=%E0%A4%A'])));
      expect(error).toEqual({ type: 'bad_encoding' });
    });

    it('never embeds the secret in returned errors', () => {
      const failing = [
        nostrconnectUri([...BASE_PARAMS, `name=${'n'.repeat(121)}`]),
        nostrconnectUri([...BASE_PARAMS, 'url=%zz']),
        nostrconnectUri([...BASE_PARAMS, 'name=a', 'name=b']),
      ];
      for (const uri of failing) {
        const result = parseNostrconnectUri(uri);
        expect(JSON.stringify(errOf(result))).not.toContain(SECRET);
      }
    });
  });
});

describe('parseBunkerUri', () => {
  it('parses a client-pasted bunker URI with a secret', () => {
    const parsed = parseBunkerUri(
      `bunker://${SIGNER_PUBKEY}?relay=${encodeURIComponent(RELAY)}&secret=${SECRET}`
    )._unsafeUnwrap();
    expect(parsed).toEqual({
      type: 'bunker',
      signerPubkey: SIGNER_PUBKEY,
      relays: [RELAY],
      secret: SECRET,
    });
  });

  it('treats the secret as optional', () => {
    const parsed = parseBunkerUri(
      `bunker://${SIGNER_PUBKEY}?relay=${encodeURIComponent(RELAY)}`
    )._unsafeUnwrap();
    expect(parsed.secret).toBeUndefined();
  });

  it('ignores nostrconnect-only params instead of failing', () => {
    const parsed = parseBunkerUri(
      `bunker://${SIGNER_PUBKEY}?relay=${encodeURIComponent(RELAY)}&name=Evil&perms=sign_event:1`
    )._unsafeUnwrap();
    expect(parsed).not.toHaveProperty('name');
    expect(parsed).not.toHaveProperty('perms');
  });

  it('still requires at least one wss relay', () => {
    expect(errOf(parseBunkerUri(`bunker://${SIGNER_PUBKEY}?secret=${SECRET}`))).toEqual({
      type: 'invalid_field',
      issues: ['relays: too_small'],
    });
  });

  it('rejects a nostrconnect URI with unsupported_scheme', () => {
    expect(errOf(parseBunkerUri(nostrconnectUri(BASE_PARAMS))).type).toBe('unsupported_scheme');
  });
});

describe('parseNip46Uri', () => {
  it('dispatches to the discriminated union by scheme', () => {
    const bunker = parseNip46Uri(
      buildBunkerUri({ signerPubkey: SIGNER_PUBKEY, relays: [RELAY], secret: SECRET })
    )._unsafeUnwrap();
    expect(bunker.type).toBe('bunker');

    const connect = parseNip46Uri(nostrconnectUri(BASE_PARAMS))._unsafeUnwrap();
    expect(connect.type).toBe('nostrconnect');
    if (connect.type === 'nostrconnect') {
      expect(connect.clientPubkey).toBe(CLIENT_PUBKEY);
    }
  });

  it('rejects unknown schemes', () => {
    expect(errOf(parseNip46Uri('cashu:token')).type).toBe('unsupported_scheme');
  });
});

// The manual parser is the only query-string path — these tests pin the exact
// semantics URLSearchParams.getAll would otherwise provide on Hermes.
describe('parseQueryString (manual fallback)', () => {
  it('splits pairs in order, preserving repeated keys', () => {
    const pairs = parseQueryString('relay=a&secret=b&relay=c')._unsafeUnwrap();
    expect(pairs).toEqual([
      ['relay', 'a'],
      ['secret', 'b'],
      ['relay', 'c'],
    ]);
  });

  it('treats a segment without = as a key with an empty value', () => {
    expect(parseQueryString('flag&a=1')._unsafeUnwrap()).toEqual([
      ['flag', ''],
      ['a', '1'],
    ]);
  });

  it('splits on the first = only', () => {
    expect(parseQueryString('a=b=c')._unsafeUnwrap()).toEqual([['a', 'b=c']]);
  });

  it('skips empty segments', () => {
    expect(parseQueryString('&&a=1&&')._unsafeUnwrap()).toEqual([['a', '1']]);
  });

  it('returns no pairs for an empty query', () => {
    expect(parseQueryString('')._unsafeUnwrap()).toEqual([]);
  });

  it('decodes + as space and percent-encoding in keys and values', () => {
    expect(parseQueryString('my+key=my+value%2B1&x=%E2%9A%A1')._unsafeUnwrap()).toEqual([
      ['my key', 'my value+1'],
      ['x', '⚡'],
    ]);
  });

  it('surfaces undecodable percent-encoding as bad_encoding', () => {
    expect(errOf(parseQueryString('a=%zz')).type).toBe('bad_encoding');
    expect(errOf(parseQueryString('%e0%a4%a=1')).type).toBe('bad_encoding');
  });
});

describe('perms CSV codec', () => {
  it('parses a mixed CSV into grantable tokens', () => {
    const parsed = parsePermsCsv(
      'sign_event:1,sign_event:0,sign_event:65535,nip44_encrypt,nip04_decrypt'
    )._unsafeUnwrap();
    expect(parsed.tokens).toEqual([
      { method: 'sign_event', kind: 1 },
      { method: 'sign_event', kind: 0 },
      { method: 'sign_event', kind: 65535 },
      { method: 'nip44_encrypt' },
      { method: 'nip04_decrypt' },
    ]);
    expect(parsed.dropped).toEqual([]);
  });

  it('produces only GrantKey-compatible tokens', () => {
    const parsed = parsePermsCsv(
      'sign_event:1,ping,get_public_key,connect,nip44_decrypt,sign_event'
    )._unsafeUnwrap();
    for (const token of parsed.tokens) {
      expect(grantKeyFor(token.method, token.kind)).not.toBeNull();
    }
    expect(parsed.dropped).toEqual(['ping', 'get_public_key', 'connect', 'sign_event']);
  });

  it.each([
    ['unknown method', 'delete_account'],
    ['bare sign_event (wildcard unrepresentable)', 'sign_event'],
    ['empty kind', 'sign_event:'],
    ['non-numeric kind', 'sign_event:abc'],
    ['negative kind', 'sign_event:-1'],
    ['out-of-range kind', 'sign_event:65536'],
    ['six-digit kind', 'sign_event:100000'],
    ['kind on an encryption method', 'nip44_encrypt:4'],
    ['kind on an auto method', 'connect:1'],
    ['uppercase method', 'SIGN_EVENT:1'],
  ])('drops %s and reports it', (_label, entry) => {
    const parsed = parsePermsCsv(`sign_event:1,${entry}`)._unsafeUnwrap();
    expect(parsed.tokens).toEqual([{ method: 'sign_event', kind: 1 }]);
    expect(parsed.dropped).toEqual([entry]);
  });

  it('skips empty entries silently and trims whitespace', () => {
    const parsed = parsePermsCsv(',, sign_event:1 ,  ,nip44_encrypt,')._unsafeUnwrap();
    expect(parsed.tokens).toEqual([{ method: 'sign_event', kind: 1 }, { method: 'nip44_encrypt' }]);
    expect(parsed.dropped).toEqual([]);
  });

  it('dedupes repeats, including non-canonical leading-zero kinds', () => {
    const parsed = parsePermsCsv(
      'sign_event:1,sign_event:01,sign_event:1,nip44_encrypt,nip44_encrypt'
    )._unsafeUnwrap();
    expect(parsed.tokens).toEqual([{ method: 'sign_event', kind: 1 }, { method: 'nip44_encrypt' }]);
  });

  it('accepts 32 entries and rejects 33', () => {
    const entries = Array.from({ length: 33 }, (_, i) => `sign_event:${i}`);
    expect(parsePermsCsv(entries.slice(0, 32).join(',')).isOk()).toBe(true);
    expect(errOf(parsePermsCsv(entries.join(',')))).toEqual({
      type: 'invalid_field',
      issues: ['perms: too_big'],
    });
  });

  it('truncates oversized dropped entries to 64 chars', () => {
    const junk = `bogus_${'x'.repeat(200)}`;
    const parsed = parsePermsCsv(junk)._unsafeUnwrap();
    expect(parsed.tokens).toEqual([]);
    expect(parsed.dropped).toEqual([junk.slice(0, 64)]);
  });

  it('round-trips through buildPermsCsv', () => {
    const tokens: PermToken[] = [
      { method: 'sign_event', kind: 1 },
      { method: 'sign_event', kind: 30078 },
      { method: 'nip44_encrypt' },
      { method: 'nip04_decrypt' },
    ];
    const csv = buildPermsCsv(tokens);
    expect(csv).toBe('sign_event:1,sign_event:30078,nip44_encrypt,nip04_decrypt');
    expect(parsePermsCsv(csv)._unsafeUnwrap()).toEqual({ tokens, dropped: [] });
  });

  it('reports dropped perms through parseNostrconnectUri', () => {
    const parsed = parseNostrconnectUri(
      nostrconnectUri([
        ...BASE_PARAMS,
        `perms=${encodeURIComponent('sign_event:1,ping,bogus,sign_event:99999')}`,
      ])
    )._unsafeUnwrap();
    expect(parsed.perms).toEqual([{ method: 'sign_event', kind: 1 }]);
    expect(parsed.droppedPerms).toEqual(['ping', 'bogus', 'sign_event:99999']);
  });
});
