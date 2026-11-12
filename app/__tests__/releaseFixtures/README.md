# Release fixtures

One file per **epoch**: a run of releases that wrote the same things to disk. Each file is the
disk of a used install of that epoch, as data. Two tests read them:

- `../releaseFixtures.test.ts` loads each fixture into in-memory storage and starts the current
  app over it three times. It checks that startup finishes, the phrase is unchanged, every
  account opens with its key, every listed fact is still readable through the current stores,
  no saved blob was turned down or came back as defaults, nothing marked as kept was deleted,
  and a later launch changes nothing.
- `../releaseFixturesCompleteness.test.ts` checks that there is a fixture for every epoch in
  `docs/architecture/persistence/persistence-map.md`, that every version in `store-builds.tsv`
  and the version in `app.json` is claimed by a fixture, and that the newest fixture has a row
  for every persisted store at the version this tree writes. In the newest fixture every store
  that is not a cache must hold something, with a fact that reads it back, or give its reason in
  `defaultRowReasons`: a store added since fails here until it has both.

This is the skipped-epoch upgrade: any release straight to this build. It does not open the
SQLite databases, render anything, or touch a real keychain; those need a device.

## Rules

- **Shapes come from the old source.** Read each store at the fixture's `commit` with
  `git show <commit>:<path>` and cite it beside the row as `path:line@commit`. Never copy a
  shape from the current schema: a fixture written from today's schema cannot fail.
- **A released fixture is frozen.** When a schema changes and a fixture fails, the fixture is
  right and the change needs a migration. `../releaseFixturesFrozen.test.ts` pins the stored
  data of every fixture but the newest by hash (`frozen.ts`); add the line when a fixture stops
  being the newest.
- **Never weaken a check.** A real loss the current app has is recorded in the fixture's
  `knownGaps` with its row in `docs/follow-ups/`. The runner then expects that
  one check to fail, and fails when it starts passing so the entry gets removed.
- Every row the current app reads must hold something the user would miss and a fact that
  reads it back, or be named in `defaultRows`.
- Use the identity in `format.ts`. Nothing here is device data.

## Add an epoch

A release needs a new fixture when it changes what is on disk: a store added, removed, renamed
or re-versioned, a SecureStore key, a database name. Otherwise add its version to the newest
fixture's `versions` and stop.

1. `cd app && WRITE_UPGRADED_DISK=E20-0.1.4:E21-<version> bun run release-fixture:upgrade` starts this
   build three times over the newest fixture and writes what is then on disk to
   `E21-<version>.upgraded.json`: every row, secure value and cache file as this build's own
   code wrote it. Run it only while the release is unreleased; afterwards the file is frozen.
   Two runs differ only in the times the upgrade itself records.
2. Write `E21-<version>.ts` on that file, as `E20-0.1.4.ts` is written on its own: spread the
   upgraded disk, then by hand, from the stores at the release commit, give each field the
   release adds a value and each store it adds a row, with a fact for each. Carry the facts of
   the fixture before it. Set `commit` and `surface`.
   (`WRITE_RELEASE_FIXTURE=E21 bun run release-fixture:new` still writes a skeleton holding
   every store's defaults, for an epoch that cannot be reached by upgrading the one before.)
3. Import the file in `index.ts`, and add the epoch's row to the table in `persistence-map.md`.
4. Run both tests:

   ```sh
   bun run test -- __tests__/releaseFixtures.test.ts --runInBand
   bun run test -- __tests__/releaseFixturesCompleteness.test.ts --runInBand
   ```

To run one fixture while writing it, listed or not:
`RELEASE_FIXTURE_FILE=E21-0.1.5 bun run test -- __tests__/releaseFixtures.test.ts --runInBand`.

The completeness test fails with the missing piece named when a version is bumped, a store
changes, or `epochs.py builds` records a release that no fixture claims.

## Published releases and declarative cases

Run `bun run persistence status` from the repository root for the corpus, or add `--json` for
release/build mappings and the input fields without a direct named assertion. `published.json`
keeps independent Apple history, pipeline channel confirmations, GitHub releases/APKs, and EAS
installable-build evidence. A version may span more than one epoch: all candidates stay visible.
Neither an EAS build nor a GitHub release without an uploaded APK proves Android publication.
Unknown source commits and incomplete public Android history remain named limitations.

`bun run persistence refresh` explicitly reads online sources and updates that local catalog;
it publishes nothing. Review and commit its diff. CI uses the committed evidence offline. A
new observed version without any fixture mapping fails the checks. Historical observations are
retained even if an upstream history page shrinks. If the newest fixture has become installable,
the frozen-data test now requires its hash too; it is no longer editable merely because it is last.

All existing disks run automatically. Additional store cases are data in `cases.json`. A
`preserve` declaration sets those historical saved fields and requires the same values in the
current store **and on disk**, after each of three launches. It does not calculate expectations
by running the migrator. For example:

```json
{
  "id": "restore-pending",
  "epoch": "E19",
  "store": "wallet-lifecycle",
  "source": {
    "commit": "d9ad12c4b",
    "path": "app/shared/stores/global/walletLifecycleStore.ts:36-41",
    "reason": "The released restore record allowed a pending restore with a pre-existing seed."
  },
  "storageKey": "wallet-lifecycle",
  "preserve": {
    "restoreStatus": "pending",
    "seedCreatedAt": null
  }
}
```

Use a new id when adding a case. Profile cases also name `accountIndex`; their scoped source
and destination keys must belong to that account. Set `currentKey` when an old key moves during
upgrade. For nested edits or transformations, the explicit `rows`, `replaces`, `facts` and
`diskFacts` form in `cases.ts` separates raw input from independent expected current values.
A replacement assertion cannot silently remove an unrelated baseline fact or hide a known gap.
All untouched identity, retained-byte, account, defaulting and legacy ecash checks still run.

Start a declaration with
`bun run persistence scaffold --epoch E19 --store wallet-lifecycle --case my-case`.
It prints a template; it changes no fixture and its incomplete source placeholders are rejected.
Add the completed object to `cases.json`, citing the old writer, then run a focused check:

```sh
bun run persistence check --version 0.1.3 --store wallet-lifecycle --case restore-failed --out /tmp/upgrade.json
```

The candidate is the checked-out tree, including a PR targeting the repository's default branch
(`main`). A case is executed once per epoch, not once per build label. Filters that match nothing
fail. The JSON report associates the actual executed cases with published versions/builds and
records candidate/dirty-tree provenance. Failure titles name epoch, case, store, account, field
and launch; expected and actual values come from the real startup result. Legacy fixture-writing
and selection environment variables are refused by this command. A fresh report is staged for
each run so an old passing result cannot be relabelled after a failed process.

Existing `bun run test:upgrade` includes the declarations and release coverage checks alongside
the original release and Coco database tests. The normal CI app suite discovers them too. Raw
field evidence in `status --json` is a guide to missing cases, not a claim that every enum,
boundary or combination is tested. Add meaningful non-default and boundary cases when a store
changes; schema snapshots and generated scaffolds cannot choose the preservation rule for you.
These tests do not replace native backend, keychain or backup/restore verification.
