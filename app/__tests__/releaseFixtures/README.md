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
  for every persisted store at the version this tree writes.

This is the skipped-epoch upgrade: any release straight to this build. It does not open the
SQLite databases, render anything, or touch a real keychain; those need a device.

## Rules

- **Shapes come from the old source.** Read each store at the fixture's `commit` with
  `git show <commit>:<path>` and cite it beside the row as `path:line@commit`. Never copy a
  shape from the current schema: a fixture written from today's schema cannot fail.
- **A released fixture is frozen.** When a schema changes and a fixture fails, the fixture is
  right and the change needs a migration.
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

1. `cd app && WRITE_RELEASE_FIXTURE=E21 bun run release-fixture:new` writes `E21-<version>.ts` from the store
   registry: every persisted store at its current version, holding its defaults.
2. Give the stores a user would miss real values, add a fact for each, and remove them from
   `defaultRows`. Set `commit` and `surface`.
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
