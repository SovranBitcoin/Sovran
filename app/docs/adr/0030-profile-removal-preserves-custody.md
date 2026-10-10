# 30. Profile removal preserves custody

Date: 2026-10-09
Status: Accepted; native validation pending.

A profile is a local identity within the recovery phrase's account. Removing one
must leave the shared phrase and every other profile untouched. Sign out is not
a separate flow: the recovery phrase is the identity, and the existing Delete
Account flow removes everything.

Only an inactive profile may be removed, and at least one profile must remain.
The user switches away before removing an active profile. The profile switcher's
inactive row opens actions; removal uses the existing destructive action menu.
Derived identity confirmation explains that it can be added again from the
phrase. Imported identity removal requires a second, separate acknowledgement
that its key is deleted from this device and cannot be recovered from the phrase.
Shared wording lives in `copy/onboarding`.

## Custody before deletion

The admission lock is shared with profile switching, creation and delete-all.
Removal never mounts the target's providers, derives its seed, initializes Coco,
runs migrations or calls a mint. It opens an existing account SQLite file through
an independent connection, enables query-only mode, begins a read transaction,
checks integrity, and reads proof states and operation/quote states. Any unspent
proof refuses, including inflight proofs and every unit. Nonterminal quotes or
operations refuse, with one exception decided on 2026-10-10: the standing
payment request every profile is given (`active`, not single-use) does not
refuse on its own. It holds request details only, and without the exception no
opened profile could ever be removed. A payment taken in on it is an attempt,
and an unfinished attempt refuses; a one-off request that is still open refuses.
Residual risk: a payment delivered over Nostr but not yet taken in by the wallet
has no attempt row and is not seen by the inspection. It stays on relays for as
long as they keep it and can be fetched with the same key, but not matched
automatically, because the request id is deleted with the profile.
Reusable quotes refuse even after an issued observation,
because more payments can arrive; canonical paid/issued accounting must agree.
Unpaid expired quotes also refuse rather than guessing their remote state; unknown tables, schemas, null states, absent files, read or
close failures refuse. The installed Coco adapter's terminal states are the
inspection contract in `profileRemovalStorage`; dependency upgrades must review
that contract. Migration backups refuse because their historical funds cannot
be established safely by inspecting only the live file.

Payment records outside Coco also matter. Secure vault manifests are discovered from the index and deterministic names
supplied by their owners and the store registry; a lost index entry cannot hide
a known payment vault. Current generations are validated with their chunks and
digest, and retained alternate generations are inspected too. Only recursively
empty records may be removed. Provider credentials, tokens, incomplete vaults
and nonempty legacy SDK records refuse: offline inspection cannot establish
provider-held funds. Captured-owner store instances also refuse rather than
racing a retained service. These refusals retain all data and explain the need
to resolve the profile's wallet/payment state first.

## Isolation and failures

Profile blob names come from the registry's profile definitions, including
retired persisted query-cache names. Query cache memory is removed by viewer;
plaintext cache factories register per-pubkey removal. Whitenoise namespaces,
account key helpers, secure vault manifests and SDK namespaces supply their own
storage inventories. No installation-wide wipe or Coco `completeReset` is used.
The Nostr and wallet files use the same account naming as their existing owners.

Deletion steps are awaited sequentially. The wallet file is removed near the end;
the profile list is committed last with an awaited durable write. Failure stops
immediately and leaves the profile listed. The UI names completed categories,
the potentially partial failed category and categories not completed. Idempotent
deletes permit retry; the runtime retains an already-validated secure deletion
plan and acknowledged wallet deletion so a list-write failure can be retried
without recreating a database. These plans hold key names only, never key values.
They are discarded on success.

No new persistence receipt, schema or key is introduced. A process death after
partial secure-vault deletion or wallet deletion loses the runtime receipt;
subsequent removal conservatively refuses unreadable/missing state. It does not
invent an empty wallet. Recovery of that interrupted case requires resolving the
account state; the existing delete-all remains a separate user decision.

Jest checks registry-driven two-profile storage isolation, refusal and retry
behavior, and the separate imported-key confirmation. The JSON scenario enters
and cancels removal without approving deletion. These are bounded JavaScript
checks. iPhone and Android must still validate SQLite close/delete behavior,
SecureStore isolation, action-menu accessibility, cancellation and restart
interruption. No native or real-wallet execution is part of this change.
