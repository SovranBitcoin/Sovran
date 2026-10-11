# Coco wallet databases

One SQLite database per Coco adapter version Sovran has shipped, each written by that old package
from npm. `../cocoDatabaseUpgrade.test.ts` opens every one with the adapter this tree ships, and
through the app's own wallet open path, and checks that the proofs, balances, counters, quotes and
operations written are still there.

- `manifest.json` lists the databases in the order they shipped: package, version, the core it
  shipped with, the releases that carried it, and the file's SHA-256. The last entry must be the
  version in `app/package.json`.
- `<package>@<version>.db` is the database. `<package>@<version>.json` is what the old adapter was
  asked to store; the test asserts from it, never from the current schema.
- `expoSqliteOnNode.ts` stands in for expo-sqlite over Node's built-in SQLite. It needs Node 22.13
  or later and is not the native module: this proves Coco's migrations over real old files, not
  the phone's SQLite, its WAL, or the keychain.

## Rules

- **Written by the old package.** A database written from today's code cannot fail.
- **Frozen once its version has shipped.** The test compares each file with its hash. When a
  database fails after a Coco change, the database is right. Writing one again changes its
  timestamps and so its hash; do it only for a version that has not shipped.
- **Never weaken a check.** Something a migration drops on purpose is asserted as dropped, with
  the migration named, as the keyset reset of migration 015 is.
- Nothing here is a real secret, key, invoice or mint.

## Changing the Coco version

Do this before the bump, while `app/package.json` still names the old version, so the outgoing
version's database is never missing:

1. Check the version being replaced is the last entry of `manifest.json`. If it is not, write it:
   `node app/scripts/make-coco-fixture.mjs <package>@<old version> --releases "<a>; <b>"`.
2. Bump Coco, then write the new version's database from its npm release and name the release
   that will carry it:
   `node app/scripts/make-coco-fixture.mjs @cashu/coco-expo-sqlite@<new version> --releases "<release>"`.
3. Run `cd app && bun run test -- __tests__/cocoDatabaseUpgrade.test.ts --runInBand` and commit
   the `.db`, its `.json` and `manifest.json` with the bump.

The script installs the old adapter and its core into a temporary directory and adds nothing to
any `package.json`. Pass `--core <version>` when the adapter shipped with a core of a different
version. It needs Node 22.18 or later, and prints a harmless warning about the module type of the
shim. If a new Coco changes a repository's write methods the script fails; teach `write` the new
shape there rather than writing rows by hand.

A release that keeps the Coco version adds its name to the last entry's `releases`.

## What the wallet holds

Two mints and three keysets, one of them retired; a counter per keyset; twelve proofs across the
`ready`, `inflight` and `spent` states, one with a DLEQ and one with a witness; mint quotes unpaid,
paid and issued; melt quotes pending and paid. Where the version had them: history entries, a
keyring key, a prepared send holding a reserved proof and a finished send, a pending melt, a
pending mint for the paid quote, and a prepared receive.
