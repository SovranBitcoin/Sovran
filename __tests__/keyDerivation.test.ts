import {
  deriveNostrKeys,
  deriveCashuMnemonic,
  deriveCashuWalletSeed,
  deriveCashuWalletSeedFromRoot,
} from '../helper/keyDerivation';
import { getUsername } from '../helper/username';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// NIP-06 test vectors
// https://github.com/nostr-protocol/nips/blob/master/06.md
// ---------------------------------------------------------------------------

const NIP06_VECTORS = [
  {
    mnemonic: 'leader monkey parrot ring guide accident before fence cannon height naive bean',
    privateKeyHex: '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a',
    nsec: 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp',
    publicKeyHex: '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917',
    npub: 'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu',
    username: 'napping-eclipse',
  },
  {
    mnemonic:
      'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade',
    privateKeyHex: 'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add',
    nsec: 'nsec1c9wh8xy5eqdzln7n5t0ctgxjcrdug73gp5yj0x03gntn67h83twssdfhel',
    publicKeyHex: 'd41b22899549e1f3d335a31002cfd382174006e166d3e658e3a5eecdb6463573',
    npub: 'npub16sdj9zv4f8sl85e45vgq9n7nsgt5qphpvmf7vk8r5hhvmdjxx4es8rq74h',
    username: 'surviving-ladybug',
  },
] as const;

describe('NIP-06 Nostr key derivation', () => {
  for (const vec of NIP06_VECTORS) {
    const label = vec.mnemonic.split(' ').slice(0, 3).join(' ') + '...';

    describe(`vector: "${label}"`, () => {
      const keys = deriveNostrKeys(vec.mnemonic, 0);

      it('derives correct private key', () => {
        expect(toHex(keys.privateKey)).toBe(vec.privateKeyHex);
      });

      it('derives correct public key', () => {
        expect(keys.pubkey).toBe(vec.publicKeyHex);
      });

      it('encodes correct nsec', () => {
        expect(keys.nsec).toBe(vec.nsec);
      });

      it('encodes correct npub', () => {
        expect(keys.npub).toBe(vec.npub);
      });

      it('generates correct fallback username', () => {
        expect(getUsername(keys.pubkey)).toBe(vec.username);
      });
    });
  }

  it('derives different keys for different account indexes', () => {
    const mnemonic = NIP06_VECTORS[0].mnemonic;
    const keys0 = deriveNostrKeys(mnemonic, 0);
    const keys1 = deriveNostrKeys(mnemonic, 1);

    expect(keys0.pubkey).not.toBe(keys1.pubkey);
    expect(toHex(keys0.privateKey)).not.toBe(toHex(keys1.privateKey));
  });
});

// ---------------------------------------------------------------------------
// Cashu (NUT-13) mnemonic derivation
// Path: m/44'/129372'/0'/<account>'/0/0
// ---------------------------------------------------------------------------

describe('Cashu (NUT-13) mnemonic derivation', () => {
  for (const vec of NIP06_VECTORS) {
    const label = vec.mnemonic.split(' ').slice(0, 3).join(' ') + '...';

    describe(`from root: "${label}"`, () => {
      const cashuMnemonic = deriveCashuMnemonic(vec.mnemonic, 0);

      it('produces a valid 24-word mnemonic', () => {
        const words = cashuMnemonic.split(' ');
        expect(words).toHaveLength(24);
      });

      it('is deterministic (same input → same output)', () => {
        const again = deriveCashuMnemonic(vec.mnemonic, 0);
        expect(again).toBe(cashuMnemonic);
      });

      it('differs per account index', () => {
        const account1 = deriveCashuMnemonic(vec.mnemonic, 1);
        expect(account1).not.toBe(cashuMnemonic);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Cashu wallet seed derivation
// ---------------------------------------------------------------------------

describe('Cashu wallet seed', () => {
  it('produces a 64-byte seed from the cashu mnemonic', () => {
    const cashuMnemonic = deriveCashuMnemonic(NIP06_VECTORS[0].mnemonic, 0);
    const seed = deriveCashuWalletSeed(cashuMnemonic);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
  });

  it('is deterministic', () => {
    const cashuMnemonic = deriveCashuMnemonic(NIP06_VECTORS[0].mnemonic, 0);
    const seed1 = deriveCashuWalletSeed(cashuMnemonic);
    const seed2 = deriveCashuWalletSeed(cashuMnemonic);
    expect(toHex(seed1)).toBe(toHex(seed2));
  });
});

// ---------------------------------------------------------------------------
// Full pinned vectors — every value in the derivation chain
// Generated via: npx tsx scripts/generate-test-vectors.ts
// ---------------------------------------------------------------------------

const CASHU_VECTORS = [
  {
    rootMnemonic: NIP06_VECTORS[0].mnemonic,
    accountIndex: 0,
    childKeyHex: '16d88b28cf7e2d90eb947014588032f8ca4a787f3bc50511030c1a82620de037',
    cashuMnemonic:
      'bitter session sketch page tissue silent purity mix begin series arrow various pigeon destroy woman judge agree marine seek crush change alone liar tortoise',
    walletSeedHex:
      '1a1721f6118d4acf240ed1674d9f26ab3f504fe2ea9c95741f98b344eacb18421d87ad400927a43369409638272adccd538a96632c1d0858c471ba01183886f0',
  },
  {
    rootMnemonic: NIP06_VECTORS[0].mnemonic,
    accountIndex: 1,
    childKeyHex: '9a71a895cbbb487946e7474b7479db34ac70bf1210787dfd5f0240bc336c7267',
    cashuMnemonic:
      'omit minute century number region device breeze trophy enter phrase item harsh shove garbage embark audit law turtle scene lift segment renew sister useful',
    walletSeedHex:
      '0e5512c019e7448d8bf2f0a4997aee1625986937c3e0360fe09dc2c6c9056690114245bcc1085a8741ad068b9549543ea740e8725674f4bff099f38ede95145f',
  },
  {
    rootMnemonic: NIP06_VECTORS[1].mnemonic,
    accountIndex: 0,
    childKeyHex: '8354f6efab43adc19083c25f3347541ce4a0f5a2c094b60391b6a5fb2b6602c3',
    cashuMnemonic:
      'local police room final depart this dragon joke game olive steak degree energy kiss mention barely render broken horror episode razor reason arch hockey',
    walletSeedHex:
      '3d27e379e3737180498046207d6bea97e03b677d320a822478519dc74b6426189ef041cc74b9246e5a64cbb46ad7b9443f95079b5176162c113b77b086435185',
  },
  {
    rootMnemonic: NIP06_VECTORS[1].mnemonic,
    accountIndex: 1,
    childKeyHex: '55a5a9ee39f132f9e8f769e8f13f6ebde83363383d59b2a19c56c9765115ae49',
    cashuMnemonic:
      'fiber coil knee initial basket language phrase unfold trophy measure sweet knock lobster ranch thought private razor artefact between napkin govern member rice define',
    walletSeedHex:
      '7abe346896750c3259fd2de581ef20da3e4c78e807f88df0fa5a5afc22966fcb0fcf1b44419f3614e971902ece9be7ff7b331e1fc40daa16e402dc57dedd740a',
  },
] as const;

describe('Cashu pinned vectors (mnemonic + wallet seed)', () => {
  for (const vec of CASHU_VECTORS) {
    const label = vec.rootMnemonic.split(' ').slice(0, 3).join(' ') + '...';

    describe(`"${label}" account ${vec.accountIndex}`, () => {
      const cashuMnemonic = deriveCashuMnemonic(vec.rootMnemonic, vec.accountIndex);

      it('derives exact cashu mnemonic', () => {
        expect(cashuMnemonic).toBe(vec.cashuMnemonic);
      });

      it('derives exact wallet seed', () => {
        const seed = deriveCashuWalletSeed(cashuMnemonic);
        expect(toHex(seed)).toBe(vec.walletSeedHex);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Integration: both seedGetter paths produce the same wallet seed
// This mirrors the two code paths in CocoManager.initialize():
//   1. Fast path: cashuMnemonic already set → deriveCashuWalletSeed(cashuMnemonic)
//   2. Fallback:  root mnemonic only       → deriveCashuWalletSeedFromRoot(root, N)
// ---------------------------------------------------------------------------

describe('seedGetter path equivalence', () => {
  for (const vec of CASHU_VECTORS) {
    const label = vec.rootMnemonic.split(' ').slice(0, 3).join(' ') + '...';

    it(`"${label}" account ${vec.accountIndex}: fast path = fallback path = pinned seed`, () => {
      const cashuMnemonic = deriveCashuMnemonic(vec.rootMnemonic, vec.accountIndex);

      const fastPath = deriveCashuWalletSeed(cashuMnemonic);
      const fallbackPath = deriveCashuWalletSeedFromRoot(vec.rootMnemonic, vec.accountIndex);

      expect(toHex(fastPath)).toBe(vec.walletSeedHex);
      expect(toHex(fallbackPath)).toBe(vec.walletSeedHex);
      expect(toHex(fastPath)).toBe(toHex(fallbackPath));
    });
  }
});
