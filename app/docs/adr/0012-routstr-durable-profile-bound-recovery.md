# Durable, profile-bound Routstr recovery

Date: 2026-09-24
Status: Accepted; funded native verification outstanding.

Supersedes the storage, automatic failover and unconditional recovery claims in
[Pay Routstr per request](2026-09-24-routstr-pay-per-request.md).

## Decision

Pay-per-request reduces hosted balances; it does not eliminate money in flight.
A request token remains bearer payment material until settlement is known.
Credentials and recovery tokens belong in profile-bound secure storage. Migrate
legacy plaintext only after a verified secure write, preserve conflicting or
unreadable records, and refuse dispatch when recovery cannot be saved.

The secure vault uses two chunked slots and a manifest registered for account
deletion. The old generation remains readable until the new generation commits.
Only sensitive state enters the vault, so ordinary chat updates do not rewrite
payment secrets. Recovery records cannot be evicted merely to meet a count cap.

Every request owns its original profile, provider and wallet manager. It journals
the token before handing it to the SDK for network dispatch. A late token from
an old profile is saved for that profile, but cannot be sent after a scope change.
The SDK receives only the selected provider's catalog and its canonical URL.
It cannot pay a different provider as an automatic fallback.

SDK token removal is accepted only after successful receipt for that request.
Recovery sweeps make one pass over retained records, without SDK retry timers
or retry-count eviction. Refund failures remain unresolved. A refund 404 can
attempt receipt of the original token; the mint decides whether it is spendable.
Legacy account credentials are sent only to their recorded issuing provider.
Unknown ownership, authentication errors and unfamiliar success responses do
not establish a zero balance. Provider changes archive the old credential.

Chat has a 30-second connection deadline and a 60-second inactivity deadline.
Each stream chunk resets inactivity; there is no fixed total response limit.
Timeouts release the UI but do not declare the payment failed or erase recovery.

## Evidence and limits

Vault tests cover interrupted writes, unreadable storage, plaintext retention,
profile separation and deletion. Payment tests cover delayed persistence,
write failure, profile switches and unsuccessful change receipt. A probe of
the installed SDK established that failed network recovery stops retrying,
while some structured provider errors can still trigger another payment.
This is why provider confinement is required; a blanket claim that every
network error causes duplicate payment would be incorrect.

These checks use synthetic tokens and network responses. They do not prove
live mint recovery, keychain behavior on devices, incremental native streaming
or provider availability. Records without a confirmed settlement may remain
until a future explicit reconciliation mechanism resolves them.
