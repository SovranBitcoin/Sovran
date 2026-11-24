/**
 * @jest-environment node
 *
 * NUT-27 mint backup interop: the key a seed derives, the kind 30078
 * `d: mint-list` event, NIP-44 self-encryption, what a hostile relay can and
 * cannot make us read, and recovery's read-only discovery of backed-up mints.
 */
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as nip44 from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import { fetchBackedUpMintUrls } from '@/features/settings/lib/recoveryDiscovery';
import {
  decodeMintBackupEvent,
  deriveMintBackupKeys,
  encodeMintBackupEvent,
  latestMintBackup,
  mintBackupFilter,
  MINT_BACKUP_KIND,
  type MintBackupKeys,
} from '@/shared/lib/cashu/nut27MintBackup';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Computed independently of this codebase: BIP-39 seed by Node's PBKDF2, then
// Node's SHA-256 of seed || "cashu-mint-backup", then Node's secp256k1 ECDH
// public key (x-only).
const VECTOR = {
  seed: '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4',
  privateKey: 'a2b87a529208651bbf974186ee4a0c13c1f31e07030de6ebd09ee33559ff97a7',
  publicKey: 'e1c971f6a291628471291a266ab85c6ffd7116c7aab6299a6801ae502f56d69b',
};

const seed = () => mnemonicToSeedSync(MNEMONIC);
const keys = (): MintBackupKeys => deriveMintBackupKeys(seed());
const MINTS = ['https://mint.example.com', 'https://another-mint.org'];

/** A backup event written the way cashu.me's `nostrMintBackup` store writes it. */
function cashuMeStyleEvent(k: MintBackupKeys, mints: string[], createdAt: number) {
  const conversationKey = nip44.v2.utils.getConversationKey(k.privateKey, k.publicKeyHex);
  return finalizeEvent(
    {
      kind: 30078,
      created_at: createdAt,
      tags: [
        ['d', 'mint-list'],
        ['client', 'cashu.me'],
      ],
      content: nip44.v2.encrypt(JSON.stringify({ mints, timestamp: createdAt }), conversationKey),
    },
    k.privateKey
  );
}

describe('NUT-27 key derivation', () => {
  it('matches the independently computed vector', () => {
    expect(bytesToHex(seed())).toBe(VECTOR.seed);
    const derived = keys();
    expect(bytesToHex(derived.privateKey)).toBe(VECTOR.privateKey);
    expect(derived.publicKeyHex).toBe(VECTOR.publicKey);
    expect(getPublicKey(hexToBytes(VECTOR.privateKey))).toBe(VECTOR.publicKey);
  });

  it('refuses anything but the 64-byte BIP-39 seed', () => {
    expect(() => deriveMintBackupKeys(new Uint8Array(32))).toThrow(RangeError);
  });

  it('finds the backup by kind, author and d tag', () => {
    expect(mintBackupFilter(VECTOR.publicKey)).toEqual({
      kinds: [30078],
      authors: [VECTOR.publicKey],
      '#d': ['mint-list'],
    });
  });
});

describe('NUT-27 event codec', () => {
  it('writes a kind 30078 mint-list event that round-trips', () => {
    const k = keys();
    const event = encodeMintBackupEvent(
      k,
      { mints: MINTS, timestamp: 1703721600 },
      { createdAt: 1703721600, client: 'sovran' }
    );
    expect(event.kind).toBe(MINT_BACKUP_KIND);
    expect(event.pubkey).toBe(VECTOR.publicKey);
    expect(event.tags).toEqual([
      ['d', 'mint-list'],
      ['client', 'sovran'],
    ]);
    expect(event.content).not.toContain('mint.example.com');
    expect(decodeMintBackupEvent(k, event)).toEqual({
      mints: MINTS,
      timestamp: 1703721600,
      createdAt: 1703721600,
    });
  });

  it('reads a backup written the way cashu.me writes it', () => {
    const k = keys();
    expect(decodeMintBackupEvent(k, cashuMeStyleEvent(k, MINTS, 1703721600))?.mints).toEqual(MINTS);
  });

  it('accepts a payload without a timestamp', () => {
    const k = keys();
    const conversationKey = nip44.v2.utils.getConversationKey(k.privateKey, k.publicKeyHex);
    const event = finalizeEvent(
      {
        kind: 30078,
        created_at: 5,
        tags: [['d', 'mint-list']],
        content: nip44.v2.encrypt(JSON.stringify({ mints: MINTS }), conversationKey),
      },
      k.privateKey
    );
    expect(decodeMintBackupEvent(k, event)?.mints).toEqual(MINTS);
  });

  describe('rejects what is not this seed’s backup', () => {
    const k = keys();
    const conversationKey = nip44.v2.utils.getConversationKey(k.privateKey, k.publicKeyHex);
    const signed = (content: string, tags: string[][] = [['d', 'mint-list']], kind = 30078) =>
      finalizeEvent({ kind, created_at: 1, tags, content }, k.privateKey);
    const stranger = generateSecretKey();

    it.each([
      ['another kind', signed(nip44.v2.encrypt('{"mints":[]}', conversationKey), undefined, 30079)],
      ['another d tag', signed(nip44.v2.encrypt('{"mints":[]}', conversationKey), [['d', 'x']])],
      ['plaintext content', signed('{"mints":["https://evil.example"]}')],
      ['content that is not JSON', signed(nip44.v2.encrypt('not json', conversationKey))],
      ['mints that are not strings', signed(nip44.v2.encrypt('{"mints":[1,2]}', conversationKey))],
      [
        'too many mints',
        signed(
          nip44.v2.encrypt(
            JSON.stringify({
              mints: Array.from({ length: 201 }, (_, i) => `https://m${i}.example`),
            }),
            conversationKey
          )
        ),
      ],
      [
        'another author',
        finalizeEvent(
          {
            kind: 30078,
            created_at: 1,
            tags: [['d', 'mint-list']],
            content: nip44.v2.encrypt(
              '{"mints":["https://evil.example"]}',
              nip44.v2.utils.getConversationKey(stranger, getPublicKey(stranger))
            ),
          },
          stranger
        ),
      ],
      [
        'a forged signature',
        { ...signed(nip44.v2.encrypt('{"mints":[]}', conversationKey)), sig: '00'.repeat(64) },
      ],
      ['not an event', { kind: 30078 }],
      ['nothing', null],
    ])('%s', (_name, event) => {
      expect(decodeMintBackupEvent(k, event)).toBeNull();
    });
  });

  it('takes the newest valid backup', () => {
    const k = keys();
    const older = cashuMeStyleEvent(k, ['https://old.example'], 100);
    const newer = cashuMeStyleEvent(k, ['https://new.example'], 200);
    expect(latestMintBackup(k, [newer, older, null])?.mints).toEqual(['https://new.example']);
    expect(latestMintBackup(k, [])).toBeNull();
  });
});

describe('recovery: read-only NUT-27 discovery', () => {
  it('discovers the backed-up mints for the restored seed', async () => {
    const k = keys();
    const fetchEvents = jest.fn(async () => [
      cashuMeStyleEvent(k, [...MINTS, 'https://known.example/', 'http://plain.example'], 10),
    ]);
    await expect(
      fetchBackedUpMintUrls(['https://KNOWN.example'], seed(), fetchEvents)
    ).resolves.toEqual(MINTS);
    expect(fetchEvents).toHaveBeenCalledWith(mintBackupFilter(VECTOR.publicKey), undefined);
  });

  it('admits only public https hosts from a backup', async () => {
    const k = keys();
    const fetchEvents = async () => [
      cashuMeStyleEvent(
        k,
        [
          'https://localhost/x',
          'https://192.168.1.1',
          'https://mint.example:8443',
          'https://user@mint.example',
          'https://mint.onion',
          'https://ok.example/Bitcoin',
        ],
        10
      ),
    ];
    await expect(fetchBackedUpMintUrls([], seed(), fetchEvents)).resolves.toEqual([
      'https://ok.example/Bitcoin',
    ]);
  });

  it('finds nothing, without failing, when there is no backup or the read fails', async () => {
    await expect(fetchBackedUpMintUrls([], seed(), async () => [])).resolves.toEqual([]);
    await expect(
      fetchBackedUpMintUrls([], seed(), async () => {
        throw new Error('relays down');
      })
    ).resolves.toEqual([]);
    const controller = new AbortController();
    controller.abort();
    const fetchEvents = jest.fn(async () => []);
    await expect(
      fetchBackedUpMintUrls([], seed(), fetchEvents, controller.signal)
    ).resolves.toEqual([]);
    expect(fetchEvents).not.toHaveBeenCalled();
  });

  it('ignores a backup published under another seed', async () => {
    const otherSeed = mnemonicToSeedSync('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong');
    const other = deriveMintBackupKeys(otherSeed);
    const fetchEvents = async () => [cashuMeStyleEvent(other, ['https://theirs.example'], 10)];
    await expect(fetchBackedUpMintUrls([], seed(), fetchEvents)).resolves.toEqual([]);
  });
});
