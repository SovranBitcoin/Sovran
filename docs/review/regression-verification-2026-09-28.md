# Verification of eleven reported regressions

Reviewed 2026-09-28 against working base `3950985b` and tag `v0.1.3`.
No funds, accounts, commits or published artifacts were changed during validation.

| # | Finding and evidence | Disposition |
| --- | --- | --- |
| 1 | Confirmed regression. `retrieveMnemonic` makes a read error sticky; `ensureMnemonicExists` refuses subsequent initialization and the recovery screen had no retry. A locked-device launch is a plausible native trigger, not reproduced on hardware here. | Retry reads the existing phrase, then restarts initialization only if valid. Runs on foreground and from an accessible Retry button. Missing/unreadable keys never authorize seed generation. |
| 2 | Confirmed regression. `deleteAllProfiles` destroyed Coco databases before the newly strict index read; vault-manifest reads could also fail after other keys had been deleted. | Preflight the index and every manifest before database deletion. Preserve manifests until all chunks are deleted. An unreadable index still refuses a reset, now before destruction; deleting unenumerated secrets cannot honestly be called a complete wipe. Native delete failures after preflight are still not transactional. |
| 3 | Confirmed regression. `v0.1.3` accepted incoming messages; the new `recipientPubkeys.length !== 1` check rejected duplicate and sender tags. NIP-17 defines rooms by the participant **set**, not tag count. | Accept exactly two distinct participants including the viewer. Continue excluding true group rooms and messages for other viewers. |
| 4 | Confirmed behavior change, retained safety restriction. Coco 2.0.0's `DefaultSendHandler.prepare` sends a gross amount and can select exact proofs from inactive keysets. Its `PaymentRequestService.prepare` passes the requested amount through without recipient-fee compensation. Merely ignoring inactive keysets or failed fee reads can underpay a NUT-18 request. | No guard removal. Mints with fees or unknown fees in the requested unit remain unsupported for these requests. Proper net-amount support is a separate wallet-core change; the old successful send was not proof of correct payment. Tests retain refusal before reservation/delivery. |
| 5 | Confirmed current failure, with a baseline qualification: `v0.1.3` sent bearer proofs for Nostr requests, ignoring the requested lock. The newer rejection exposed that unsupported behavior rather than removing a correct locked-payment implementation. | Plain permanent P2PK requests now prepare Coco's P2PK target with the requested key. Other conditions remain refused, rather than stripped. |
| 6 | Confirmed latency regression in `7b966a43`, explicitly documented as online-first in ADR 0019. An exact bearer send does not need new mint outputs. Installed Coco's patched offline path uses durable reservation and no fetch. | Restore immediate local execution for exact bearer proofs, including online. Locked and non-exact sends retain the online path. Do not repeat a failed local execution as an offline fallback. A randomized integration run also found an existing selector miss: the offline patch now tries deterministic descending proof selection first. The 1097-sat counterexample is pinned with `Math.random = 0`. ADR 0020 amends the routing decision. |
| 7 | Confirmed pre-existing defect, already present in `v0.1.3`: the quote cache passed the preview quote to execution without carrying expiry into the preview. | Carry mint expiry into the preview. Pay on an expired preview refreshes it and requires another approval, so changed fees are never silently accepted. |
| 8 | The guard is intentional custody protection, not an onboarding regression. `NostrKeysProvider.initializeKeys` awaits `ensureMnemonicExists` (which awaits `storeMnemonic`) before derivation and `addProfile`. The normal creation path never persists the profile first. Generating a new root beneath restored profiles strands their deterministic wallet identity. | Retain the guard. Existing tests prove no RNG, key writes or deletes when account metadata is nonempty/unreadable and the root is missing. |
| 9 | Confirmed recovery-UI defect introduced with the gate. `locked={false}` always offered an nsec regardless of the account's source. | Imported profiles retain nsec recovery; derived profiles get Retry and phrase recovery. Phrase recovery validates all known derived identities and retains profile metadata outside onboarding. |
| 10 | The reported silent paid-request failure is not supported by the callers. `writeSensitiveValue` rejects; `createSdkStorageDriver` captures voided SDK writes and its awaited `flush()` rejects. `sdk/client.ts` flushes before wallet send and after journaling the token, before returning it to the request. | Retain strict indexing. Add a corrupt-index test at the actual SDK storage/flush seam; it reports failure and writes no unindexed token. |
| 11 | Confirmed cache problem in a newly added feature, with a qualification: the fallback does not itself lock a token. `deriveSendLockGate` marks it unconfirmed and the lock UI warns about the identity-key assumption; locking remains a user action. | Cache only a declared wallet key. Failed, absent and malformed discoveries are retried on the next lookup instead of pinning the fallback for ten minutes. The explicitly warned fallback remains available. |

## Primary evidence

- [NIP-17 room membership](https://github.com/nostr-protocol/nips/blob/master/17.md#chat-rooms).
- [NUT-18 net input fees](https://github.com/cashubtc/nuts/blob/main/18.md#input-fees).
- [Mnemonic storage and reset enumeration](https://github.com/SovranBitcoin/Sovran/blob/main/app/shared/lib/nostr/secureStorage.ts),
  [session orchestration](https://github.com/SovranBitcoin/Sovran/blob/main/app/shared/lib/profile/profileSessionOrchestrator.ts),
  [key initialization](https://github.com/SovranBitcoin/Sovran/blob/main/app/shared/providers/NostrKeysProvider.tsx).
- [Routstr driver](https://github.com/SovranBitcoin/Sovran/blob/main/app/shared/lib/routstr/sdk/driver.ts) and
  [awaited payment boundaries](https://github.com/SovranBitcoin/Sovran/blob/main/app/shared/lib/routstr/sdk/client.ts).
- Installed `@cashu/coco-core@2.0.0`, `dist/index.js`: `DefaultSendHandler.prepare`
  and `PaymentRequestService.prepare`; the committed offline-send patch changes
  local preparation/execution and exact selection, not recipient fee accounting.

## Validation

Regression tests first failed for duplicate/sender DM tags, cached discovery failure,
exact online send routing, locked Nostr requests, and expired quote approval. The
corresponding fixes pass. Custody tests cover retry without writes, reset preflight,
matching derived-phrase recovery and the paid-request persistence barrier.

Final checks:

- `bun run --cwd wallet test`: 100 files, 1,572 tests passed after rebuilding the patch.
- `bun run --cwd app test -- --runInBand`: 573 suites, 5,567 tests and 168 snapshots
  passed before the selector-patch rebuild. Jest did not exit cleanly, emitted
  imports-after-teardown errors from Routstr tests, and was terminated after the
  completed result. This is not a clean teardown result.
- After the rebuild, the eight affected app suites (storage, recovery, DMs,
  discovery and installed Coco patch) passed: 81 tests, clean exit.
- Coco patch rebuild: 1,252 upstream core unit tests passed; Bun patch regenerated
  from TypeScript. Package manifests and `bun.lock` have no final changes.
- `bun run type-check`: every workspace passed, including app iOS and Android.
- `bun run --cwd app lint`: zero errors, 205 warnings. Subsequent changed-file
  checks passed. Styling ratchet and `git diff --check` passed.
- `bun run --cwd app e2e:validate`: all JSON scenarios and suite references valid.
- `expo export --platform ios` and `--platform android`: both passed after the
  final patch rebuild.
- React Compiler ratchet: this change's recovery component compiles. The check
  still fails for two files identical to HEAD: `MintAddScreen.tsx` (ref access)
  and `useColadaTransactionAnnotation.ts` (existing memoization).
- `hunch check --base origin/main`, CLI 0.22.0: incomplete. Gateway authentication
  was unavailable and fallback ended with `ERR_STREAM_WRITE_AFTER_END`. No clean
  semantic-review verdict is claimed.

Native locked-device launch/unlock, destructive reset, live P2PK delivery and live
expired-quote payment were not exercised. JSON recovery scenarios require a
manually prepared disposable device and were validated statically only.
