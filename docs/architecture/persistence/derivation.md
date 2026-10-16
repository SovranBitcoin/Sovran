# From the recovery phrase to everything an account uses

Every identity and wallet secret in Sovran comes from one of two roots: the 12-word recovery
phrase, or a Nostr private key the person imported. This page follows each root to every value
the app stores or uses, says which of those values are the truth and which are caches, and lists
the invariants that must hold between them.

One module checks those invariants: `app/shared/lib/nostr/derivationIntegrity.ts`. It derives
with its own code, compares, and never repairs. When a saved account does not follow from its
root the app stops on a critical screen and changes nothing. Why it stops instead of fixing is
in [When a check fails](#when-a-check-fails).

Paths are relative to `app/`. Line numbers in the chain table are as of the change that added
this page.

## The chain

`i` is a derived account's index (0, 1, 2, ...). `n` is an imported account's number:
its public key, read as an integer, modulo 2^31 (`shared/lib/nostr/keyDerivation.ts:124`).

| # | Value | Made from | How | Where it is made |
|---|---|---|---|---|
| 1 | **Recovery phrase** | 128 random bits | BIP-39, 12 English words | `shared/lib/nostr/secureStorage.ts` (`ensureMnemonicExists`), or entered at recovery |
| 2 | Root seed, 64 bytes | 1 | BIP-39 stretch: PBKDF2-SHA512, 2048 rounds, salt `mnemonic`, no passphrase | `shared/lib/nostr/keyDerivation.ts:18` |
| 3 | Derived Nostr private key | 2, `i` | BIP-32 at `m/44'/1237'/i'/0/0` (NIP-06) | `shared/lib/nostr/keyDerivation.ts:42` |
| 4 | **Imported Nostr private key** | the person | pasted `nsec` | `shared/lib/popup/popups/actionSheets.tsx:206`, stored by `importAndSwitchProfile` |
| 5 | Nostr public key | 3 or 4 | BIP-340 x-only public key | same as 3; `getPublicKey` for 4 |
| 6 | Wallet phrase, derived account | 2, `i` | BIP-32 at `m/44'/129372'/0'/i'/0/0`; the 32-byte child key written as 24 BIP-39 words | `shared/lib/nostr/keyDerivation.ts:75` |
| 7 | Wallet phrase, imported account | 2, `n` | the same, at `m/44'/129372'/0'/n'/1/0` (chain 1) | `shared/lib/nostr/keyDerivation.ts:140` |
| 8 | Wallet seed, 64 bytes | 6 or 7 | BIP-39 stretch of the wallet phrase, no passphrase | `wallet/src/wallet-seed.ts` (`deriveStandardCashuSeed`), called from `shared/lib/cashu/manager.ts:792` |
| 9 | Ecash secrets and blinding factors | 8, keyset, counter | NUT-13, inside Coco | `@cashu/coco-core` |
| 10 | Pay-to-key (P2PK) key in the wallet's keyring | 3 or 4 | the Nostr private key itself, held in memory for the session and never written to the wallet database | `shared/lib/cashu/manager.ts:847`, `:767` |
| 11 | Payment-request transport key | 3 or 4 | the Nostr private key itself | `shared/lib/cashu/manager.ts` (`createPaymentRequestNostrTransportPlugin`) |
| 12 | npub.cash identity and signer | 5, 3 or 4 | account id is the saved row's public key; requests are signed with the staged private key | `shared/lib/cashu/manager.ts:1461`, `:1535` |
| 13 | Mesh (bitchat) Noise and signing keys | 3 or 4, 5 | HKDF-SHA256 of the private key, salted with the public key, one label per key | `features/bitchat/lib/bleIdentity.ts:38` |

Two roots, so two kinds of account:

- A **derived** account's identity (3, 5) and wallet (6, 8) both come from the phrase and its index.
- An **imported** account's identity (4, 5) comes from its own key. Its wallet (7, 8) still comes
  from the phrase, at a number computed from its public key. The imported key alone cannot
  reproduce the wallet; the phrase alone cannot reproduce the identity.

Nothing below row 8 is checked here. Rows 9 to 13 are pure functions of rows 3 to 8 with no stored
copy of their own, so they are right exactly when their inputs are.

## What is stored, and what is only a cache

| Stored value | Where | Keyed by | Truth or cache |
|---|---|---|---|
| Recovery phrase | SecureStore `user_mnemonic` | the installation | **Truth.** Nothing can make it again. |
| Imported private key | SecureStore `imported_nsec_<pubkey>` | public key | **Truth.** Nothing can make it again. |
| Profile row: `accountIndex`, `pubkey`, `source` | AsyncStorage `profile-store` | the installation | **Truth** for which accounts exist and which is active. Its `pubkey` and `source` are claims that must agree with the roots. |
| Derived keys | SecureStore `derived_keys_<i>`: `npub`, `nsec`, `pubkey`, `privateKeyHex`, `mnemonicHash` | account index | Cache of rows 3 and 5. |
| Wallet phrase | SecureStore `cashu_mnemonic_<i or n>`: `value`, `mnemonicHash` | account index | Cache of row 6 or 7. |
| Wallet seed | SecureStore `cashu_seed_<i or n>`: `hex`, `mnemonicHash` | account index | Cache of row 8. |
| Wallet database | SQLite `coco.db` for index 0, `coco-<i or n>.db` otherwise (`shared/lib/cashu/manager.ts:436`) | account index | **Truth** for the proofs it holds. Its counters only mean anything under the seed that made them. |
| Per-account stores | AsyncStorage `<store>:profile:<pubkey>` (`shared/lib/cashu/profileScopedStorage.ts:105`) | the **row's** public key | Truth, filed under whatever the row says. |
| npub.cash cursor | AsyncStorage `npc_since:profile:<pubkey>` | the row's public key | Truth, small. |

A cache carries `mnemonicHash`, the first 16 hex characters of SHA-256 of the phrase it was made
from (`shared/lib/nostr/secureStorage.ts:638`). The derived-key and wallet-phrase caches are keyed
to the recovery phrase. The wallet-seed cache is keyed to the phrase the wallet stretched, which
is the wallet phrase. A cache whose hash is not the current one is **stale**: the app ignores it
and derives again, and the check ignores it too. That is what makes a recovery with another phrase
safe to leave caches behind.

The things that are keyed by **account index** (caches, database files) and the things keyed by
**public key** (stores, the imported key) meet only in the profile row. That is why a wrong row is
the dangerous failure: it files one account's stores under one key while its wallet opens under
another's seed.

## How earlier releases derived

The identity path (`m/44'/1237'/i'/0/0`) and the wallet path have not changed since profiles
existed. What changed is how the wallet seed was made from the child key; the table is in
[persistence-map.md](persistence-map.md#wallet-storage-and-seed-derivation) and the source reads
are in [audit-2026-10-10/coco-and-cashu.md](audit-2026-10-10/coco-and-cashu.md).

| Releases | Wallet seed | Imported accounts |
|---|---|---|
| 0.0.1 to 0.0.12 build 3 | the raw 32-byte child key at `m/44'/129372'/0'/i'/0/0` | none |
| 0.0.12 build 10 onwards | row 8: that child key as 24 words, then the BIP-39 stretch | none |
| 0.0.62 onwards, including 0.1.0 to 0.1.3 | the same | row 7, chain 1, numbered by public key |

So every 0.1.x install derives exactly as this page describes, and the check compares against the
same paths those releases used. The raw-key wallets of the earliest releases predate the profile
list, so no profile row points at one and the check has nothing to say about them.

## The invariants

Each has a name in the checker and a two-letter code that appears in the diagnostic code.

| Code | Invariant | Needs the root seed |
|---|---|---|
| `RD` `row.derived-pubkey` | A derived row's `pubkey` is the key the phrase derives at the row's `accountIndex`. | yes |
| `RK` `row.imported-key` | An imported row's `pubkey` is the public key of the `imported_nsec_<pubkey>` stored for it. | no |
| `RI` `row.imported-index` | An imported row's `accountIndex` is the number computed from its `pubkey`. | no |
| `CC` `cache.derived-keys-consistent` | In `derived_keys_<i>`, the private key, the `nsec`, the `npub` and `pubkey` all describe one key. | no |
| `CR` `cache.derived-keys-row` | A current `derived_keys_<i>` holds the row's key (compared through the private key). | no |
| `CP` `cache.derived-keys-phrase` | A current `derived_keys_<i>` holds the key the phrase derives. | yes |
| `CW` `cache.wallet-phrase` | A current `cashu_mnemonic_<i>` is the wallet phrase the phrase derives for this account, on the right chain. | yes |
| `CS` `cache.wallet-seed` | A current `cashu_seed_<i>` is the stretch of that wallet phrase. | yes |
| `SA` `session.account` | The account index and imported flag staged for the wallet are the row's. | no |
| `SS` `session.signer-row` | The signing key about to be used has the row's public key. | no |
| `SW` `session.wallet-phrase` | The wallet phrase about to be used is the one the phrase derives. | yes |

Not a mismatch, on purpose:

- **A stale cache.** Its hash says it belongs to another phrase; the app does not read it.
- **A missing imported key.** That account needs a re-import, which is the key recovery screen's
  job. An imported row with no key is not judged further, because a row can also read as
  imported when a newer build wrote a `source` this one does not know.
- **An unreadable phrase.** The key recovery screen handles a locked or absent keychain.
- **A cache of the wrong shape.** A blob that will not parse, a wallet seed that is not 64 bytes,
  a key cache whose private key is not a key: none of these says the account is another wallet's,
  so each is read as absent and left where it is. Only a well-formed value that disagrees is a
  mismatch.

## Where it is checked

| Boundary | What runs | On a mismatch |
|---|---|---|
| Account startup: `shared/lib/nostr/loadAccountKeys.ts` | Read, choose, check, write, in that order. Everything stored for the account is read unchanged (`readAccountSecretsUnchanged`); the keys and wallet phrase are chosen; then **every** invariant runs (`verifyStoredAccount`) before the provider reports ready. Only after it passes are caches written or a row's label corrected. With no saved row, the row about to be created is checked. | Throws `AccountIntegrityError`; `NostrKeysProvider` shows the critical screen. Nothing was written or deleted, and nothing below the key provider was mounted. |
| After startup: `shared/providers/NostrKeysProvider.tsx`, `verifyOtherAccountsInBackground` | The check of every account that is not the open one. | Records the failure, which covers the app until closed. |
| Switching: `shared/lib/profile/profileSessionOrchestrator.ts` (`targetPassesIntegrity`) | The full check of the target, before the splash and before the wallet is closed. | The switch is refused; the active account is untouched. |
| Creating a profile: `profileSessionOrchestrator.ts` (`createAndSwitchProfile`) | The new key is derived a second time, independently, before the row is saved. | The profile is not created. |
| Importing a profile: `profileSessionOrchestrator.ts` (`importIsConsistent`) | The key, its public key and its account number must describe one identity before anything is stored. | `key-mismatch`; nothing is stored. |
| Recovery: `profileSessionOrchestrator.ts` (`recoverMnemonicSession`) | The entered phrase must derive every derived row already saved. | The phrase is refused; the stored one is kept. |
| Opening a wallet: `shared/lib/cashu/manager.ts` (`checkStagedCredentials`) | `SA` and `SS` on the credentials captured for this open, before the database is opened. | The open fails (the wallet-open failure screen). This is a fault in what was staged, not in what is stored, so the critical screen is not raised. |
| Migration `adopt-leftover-bare-stores-v1`: `shared/lib/migrations/globalMigrations.ts` | `phraseDerivesPubkey` decides whether account 0 owns the leftover stores. | The leftovers stay where they are and the migration is **not** recorded, so it runs again once the right phrase is back. |

Three rules hold at every one of these:

- **Whole values decide.** The eight-character prints in a result are for reporting. Two keys that
  share a prefix are different keys.
- **Read before anything else, and never delete.** The startup reader leaves a cache it cannot parse
  where it is and reads it as absent. The key and wallet-phrase readers that used to delete such
  a blob are gone. The wallet's own seed-cache reader still drops a blob of the wrong length, but
  it only runs once the account has passed.
- **The check stretches the phrase itself.** It does not borrow the root seed the app derived
  with (`keyDerivation.ts` keeps its own): a seed that had gone wrong there would otherwise vouch
  for what was derived from it. The check's seed is made in `phraseStretch.ts` and kept for the
  launch in `accountIntegrity.ts`.

### A row labelled imported that is really derived

A row reads as imported when it is, and also when a newer build saved a `source` this build does
not know. If such a row has no stored key, startup asks whether the phrase derives its public key.
If not, it needs a re-import. If so, the account is checked in full **as the derived account it
is**, caches included, and only when that passes is the label rewritten. No cache is deleted. If
the check fails it is a mismatch like any other, and the label is left alone.

### What it costs at startup

The active account pays for the whole check before it is ready: two stretches (the phrase, and
the wallet phrase when there is a current seed cache to compare), two short BIP-32 walks and a few
public keys.

- Where the platform has PBKDF2 (`crypto.subtle`), both stretches run there, off the JavaScript
  thread. Measured under Node 24 on a development Mac, as a rough guide only: about 1 ms per
  native stretch and about 15 to 20 ms for the whole check.
- Where it does not, the JavaScript stretch runs instead: about 5 ms each under Node, but seconds
  each on an old phone without a JIT. That pause is accepted for the account being opened, once
  per launch. Nothing has been timed on a device; see [follow-ups](../../follow-ups/README.md) F93.
- A mismatch found with the native stretch is only believed after the JavaScript one confirms
  it, so a fault in the native call cannot put a healthy account on the critical screen.

The other accounts are checked in the background. The phrase is not stretched again for them, and
their wallet seed caches are only compared when the native stretch is there to do it; otherwise
that one invariant waits until the account is switched to, which runs the full check. No check
writes anything.

## Recovery and the check

Entering a phrase is the one flow that replaces the root, so it is where the check could lock out
someone who did nothing wrong. The rule:

> A phrase is accepted only if it derives every derived account already saved on the device. If
> the profile list is being thrown away (recovery during onboarding), it is emptied before the
> phrase is stored.

Either way, once the phrase is stored every derived row follows from it. What recovery leaves
behind are caches stamped with the old phrase's hash, and those are stale, not mismatches. An
imported account answers to its own stored key whatever the phrase is.

The same rule is what lets a person put a mismatched account right themselves: on the critical
screen, entering the phrase the account was made with passes this test and replaces the phrase on
the device. The app never does that on its own.

One case the check cannot see: when the keychain is unreadable and only imported accounts exist,
recovery accepts any valid phrase, and those accounts' wallets will then be derived from the new
phrase. Nothing stored records which phrase an imported account's wallet was made with. See
[follow-ups](../../follow-ups/README.md).

## When a check fails

The app stops on `shared/blocks/AccountMismatchScreen.tsx` (`account-mismatch-screen`) and does
not open that account's wallet. It does not rewrite the row, overwrite a cache, or derive and save
anything. A repair would be a guess about which side is right, and a wrong guess overwrites the
only copy of a key or opens a wallet database under a seed that cannot restore it.

The screen says which account, that nothing was changed, and that money sent to the account may
not be recoverable from this phrase alone. It offers:

- **View recovery information**: the existing page the legal screens link to. For a mismatched
  derived account it shows the key still held in `derived_keys_<i>` when that key is the row's,
  even if the rest of that blob is damaged. When a wallet phrase cached on the device is stamped
  as current but is not the one the phrase derives, it is shown as well, labelled as the one
  stored on this device, because the wallet may have been opened under it.
- **Copy diagnostic code**, for example `AM1-D0-RD-1a2b3c4d-9f8e7d6c`: format, account kind and
  index, the invariants that failed, then eight characters of what the first one expected and
  found. Public keys are shown by prefix and secrets by a tagged hash. It holds no key.
- **Switch to** another account, through the same checked switch.
- **Enter this account's recovery phrase**, under the recovery rule above.
- The operator's contact address.

### Installs coming from 0.1.0 to 0.1.3

A healthy install passes: the paths and the cache format are the ones those releases wrote, and
the tests include an install shaped like 0.1.3's with two derived accounts and an imported one
(`__tests__/accountIntegrityBoundaries.test.ts`, `__tests__/accountIntegrityStartup.test.tsx`).

One unhealthy state exists in the field. On 0.1.3 an Android backup restore could bring back the
profile row and the wallet database without the keychain; the app generated a new phrase and ran
on, with the row naming a key the new phrase cannot derive. Earlier builds of this candidate
logged it and carried on. This build stops on the critical screen on first launch. Nothing is
lost by stopping: the database, the row and the phrase are all still there, and a person who has
the original phrase can enter it. What they cannot do from this screen is spend the ecash already
in that database; see [follow-ups](../../follow-ups/README.md).

### More than one mismatched account

Every account's failure is kept. The active account's always wins and stops the app; another
account's only covers it and can be closed, and closing it never hides the active one's.
