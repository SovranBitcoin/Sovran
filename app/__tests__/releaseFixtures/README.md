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
