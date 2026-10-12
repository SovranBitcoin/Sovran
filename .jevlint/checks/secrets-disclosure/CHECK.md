Where does secret or bearer wallet material, or decrypted private message content, get written to a sink that should not hold it?

The material: mnemonics, seeds, private keys, Cashu proofs and tokens, auth tokens, decrypted DM
plaintext. The sinks: logs, analytics, error reporting, public relay payloads, AsyncStorage, a
persisted Zustand store or a cache with a storage prefix, and any unauthorized recipient. Find each
write of such a value into such a sink, and where the store's persistence is configured. Not
sinks: rendering a value to the user it belongs to or copying it to their clipboard; parsing,
encoding or validating it; local variables and unpersisted component state; sending a credential
to the service it is for. Logging a length, count, boolean, hash or short prefix is redaction.
Encrypted storage, deliberate backup or export, tests and e2e harnesses, and an operator script
that prints a key it just generated are allowed.
