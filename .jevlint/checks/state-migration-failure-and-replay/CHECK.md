Where can a startup migration fail, or run twice, and leave stored data worse than it found it?

Find the migration runners and their completion markers (app/shared/lib/migrations/
globalMigrations.ts, dataMigrations.ts, migrateThenLoad.ts), the gate that opens profile storage
after them, and their tests. Concerns: a failure that is logged and then treated as success, so
stores load defaults and write them to keys the migration was still moving; a marker stamped over
a recorded wallet restore; a migration that is not safe to replay over a current install or over
data it already moved; sources deleted before the destination is confirmed. Correct: the runner
throws on the first failure, the gate keeps storage closed behind a retry screen, a finished
migration keeps its marker, and replaying changes nothing.
