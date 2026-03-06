import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveCashuWalletSeed,
  deriveCashuWalletSeedForImported,
  deriveCashuWalletSeedFromRoot,
  deriveNostrKeys,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import { getUsername } from '@/shared/lib/username';
import { getPublicKey, nip19 } from 'nostr-tools';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const ROOT_MNEMONIC =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';

const DERIVED_PROFILE_VECTORS = [
  {
    accountIndex: 0,
    npub: 'npub1zutzeysacnf9rru6zqwmxd54mud0k44tst6l70ja5mhv8jjumytsd2x7nu',
    nsec: 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp',
    pubkey: '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917',
    username: 'napping-cloud',
    cashuMnemonic:
      'bitter session sketch page tissue silent purity mix begin series arrow various pigeon destroy woman judge agree marine seek crush change alone liar tortoise',
    walletSeedHex:
      '1a1721f6118d4acf240ed1674d9f26ab3f504fe2ea9c95741f98b344eacb18421d87ad400927a43369409638272adccd538a96632c1d0858c471ba01183886f0',
  },
  {
    accountIndex: 1,
    npub: 'npub1m9m6dnc0svwugus8sz6l29rqatmdegywxtgld6ymvq6y6ca0fczq88tsjr',
    nsec: 'nsec1x7gvyw2q7c4jxa2pzhhhputwv0x236gptffjhz5fz9cuekkulygqd26n5g',
    pubkey: 'd977a6cf0f831dc4720780b5f51460eaf6dca08e32d1f6e89b60344d63af4e04',
    username: 'reaching-valley',
    cashuMnemonic:
      'omit minute century number region device breeze trophy enter phrase item harsh shove garbage embark audit law turtle scene lift segment renew sister useful',
    walletSeedHex:
      '0e5512c019e7448d8bf2f0a4997aee1625986937c3e0360fe09dc2c6c9056690114245bcc1085a8741ad068b9549543ea740e8725674f4bff099f38ede95145f',
  },
] as const;

const IMPORTED_NSEC_VECTOR = {
  nsec: 'nsec1jlpx0y7gffw63zrhv8fu2lawrcxl7evtz6w5v67urh59j4l0fsys7hr66h',
  npub: 'npub1n95ewwes70sezt4pvp7n77l2kyw8e4er46fj63gmmw7ee6wu907q7jze9g',
  pubkey: '9969973b30f3e1912ea1607d3f7beab11c7cd723ae932d451bdbbd9ce9dc2bfc',
  npubNumber: 1776036860,
  cashuMnemonic:
    'amazing small ankle organ august aisle assist bicycle win address cloth orient melt toilet obtain certain add orphan cube six bomb section spring lab',
  walletSeedHex:
    'f5aae5887a45efe809329d5bc083f2f38acd8cdc6a01d251c198f875442e5757fb85e01f6fbf37df5315b7b28eeb0365e2b4e05dec1fd4c14cbbe4373d00c642',
} as const;

describe('key derivation', () => {
  describe('derived profiles from the root mnemonic', () => {
    for (const profile of DERIVED_PROFILE_VECTORS) {
      it(`derives profile ${profile.accountIndex}`, () => {
        const nostr = deriveNostrKeys(ROOT_MNEMONIC, profile.accountIndex);
        const cashuMnemonic = deriveCashuMnemonic(ROOT_MNEMONIC, profile.accountIndex);
        const walletSeed = deriveCashuWalletSeed(cashuMnemonic);
        const walletSeedFromRoot = deriveCashuWalletSeedFromRoot(
          ROOT_MNEMONIC,
          profile.accountIndex
        );

        expect(nostr.npub).toBe(profile.npub);
        expect(nostr.nsec).toBe(profile.nsec);
        expect(nostr.pubkey).toBe(profile.pubkey);
        expect(getUsername(nostr.pubkey)).toBe(profile.username);

        expect(cashuMnemonic).toBe(profile.cashuMnemonic);
        expect(toHex(walletSeed)).toBe(profile.walletSeedHex);
        expect(toHex(walletSeedFromRoot)).toBe(profile.walletSeedHex);
      });
    }

    it('keeps profile 0 and profile 1 distinct', () => {
      const profile0 = deriveNostrKeys(ROOT_MNEMONIC, 0);
      const profile1 = deriveNostrKeys(ROOT_MNEMONIC, 1);

      expect(profile0.npub).not.toBe(profile1.npub);
      expect(profile0.nsec).not.toBe(profile1.nsec);
      expect(profile0.pubkey).not.toBe(profile1.pubkey);
    });
  });

  describe('imported nsec profile under the root mnemonic', () => {
    it('derives the imported identity and npubNumber', () => {
      const decoded = nip19.decode(IMPORTED_NSEC_VECTOR.nsec);
      expect(decoded.type).toBe('nsec');

      const pubkey = getPublicKey(decoded.data);
      const npub = nip19.npubEncode(pubkey);
      const npubNumber = pubkeyToAccountNumber(pubkey);

      expect(pubkey).toBe(IMPORTED_NSEC_VECTOR.pubkey);
      expect(npub).toBe(IMPORTED_NSEC_VECTOR.npub);
      expect(npubNumber).toBe(IMPORTED_NSEC_VECTOR.npubNumber);
    });

    it('derives the imported Cashu profile on chain 1', () => {
      const cashuMnemonic = deriveCashuMnemonicForImported(
        ROOT_MNEMONIC,
        IMPORTED_NSEC_VECTOR.npubNumber
      );
      const walletSeed = deriveCashuWalletSeed(cashuMnemonic);
      const walletSeedFromRoot = deriveCashuWalletSeedForImported(
        ROOT_MNEMONIC,
        IMPORTED_NSEC_VECTOR.npubNumber
      );

      expect(cashuMnemonic).toBe(IMPORTED_NSEC_VECTOR.cashuMnemonic);
      expect(toHex(walletSeed)).toBe(IMPORTED_NSEC_VECTOR.walletSeedHex);
      expect(toHex(walletSeedFromRoot)).toBe(IMPORTED_NSEC_VECTOR.walletSeedHex);
    });

    it('uses a different Cashu derivation path than a derived profile with the same account number', () => {
      const derivedCashuMnemonic = deriveCashuMnemonic(
        ROOT_MNEMONIC,
        IMPORTED_NSEC_VECTOR.npubNumber
      );
      const importedCashuMnemonic = deriveCashuMnemonicForImported(
        ROOT_MNEMONIC,
        IMPORTED_NSEC_VECTOR.npubNumber
      );

      expect(importedCashuMnemonic).toBe(IMPORTED_NSEC_VECTOR.cashuMnemonic);
      expect(importedCashuMnemonic).not.toBe(derivedCashuMnemonic);
    });
  });
});
