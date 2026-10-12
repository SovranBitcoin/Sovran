Where can a value that must be unique per use repeat under the same key?

The values: ECDSA or Schnorr signing nonces, AEAD nonces and IVs, Cashu blinding factors, NIP-44
nonces. Find where each is drawn and every use of it. The concern is a value drawn once and used
for two operations; cached, persisted or held in a module-level, closure or component-level
variable across calls; derived deterministically from data that can recur; or carried unchanged
through a retry or re-entry. Re-sending an already-signed event or an already-built encrypted
payload is the correct retry.
