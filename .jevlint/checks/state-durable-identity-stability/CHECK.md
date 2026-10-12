Where are the names and derivations that locate a user's saved data defined, and what pins them against an accidental change?

From the persistence-release-safety skill: a phone holding any state an earlier release wrote
must still open its money, keys and data. Find key and seed derivation paths and account indexes;
SecureStore key names and their options (keychainService, accessibility, authentication);
persisted store names, storage key formats including any account or pubkey suffix, and versions;
SQLite database file names per account. For each, find the fixture or test that fails when it
changes (app/__tests__/releaseFixtures/, app/__tests__/persistenceSurface.test.ts,
app/__tests__/fixtures/persistence-surface.json). A changed path or index silently changes whose
money the same phrase opens, and a renamed key strands what was stored under the old one. A name
with no pinning test is the concern.
