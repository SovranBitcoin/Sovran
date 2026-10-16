# Native tests and results

[Stories](stories/README.md) describe what a person does. The earlier scenario harness remains
available while its coverage moves to stories ([ADR 0033](../docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md)).
Source belongs beside the runner that owns it; generated evidence belongs in the ignored
`artifacts/` directory.

## One history

Run `bun run e2e:viewer` from `app/` to browse recorded results. Navigation shows tests with
evidence or live queued attempts; unrun authoring definitions stay available to the runners
without creating empty result pages. Both runners leave independent
`artifacts/run-<id>/` folders. A story run separates workers, selected stories and setup evidence;
setup remains inspectable without counting as another passing story. Each report owns its
step pictures, video, timings and warnings. Recordings open paused by default; the Screenshots
tab shows the step pictures. Evidence without a recording opens on its images. Crashed attempts remain failures even when no
report was written.

The viewer reads each format through an adapter; it does not rewrite old events or infer
missing provenance. Story manifests record the runner's repository state, but do not
attest that the installed native binary was built from it; they are never commit baselines. Imported story output has an unknown original run date. Manual reviews
have their own evidence class and never count as automated passes. Original notes remain
beside their screenshots. Recorded stories are browsable here; start new stories through the
story runner, since the viewer's Run action operates the earlier scenario harness.

## Builds are part of the evidence

The [native build owner](press/native-build.ts) keeps development clients separate from
bundled story builds. Bundled builds exclude inherited fixture and timing controls; they
carry their JavaScript and retain structured logging. The source must stay unchanged during
compilation, including sibling workspace code; old caches without that evidence are rebuilt.
Android needs an explicit test-only
Gradle option to connect to its host over loopback. Ordinary Release builds must ignore
that network exception even after a test build, and their JavaScript cache must observe
changes in logging mode. The [Expo plugin](../plugins/withAndroidE2ERunner.js) owns that
boundary. A successful build alone is not a functional or performance result; the remaining
native certification work is tracked in [F156](../../../docs/follow-ups/F156.md).

## Other generated material

`artifacts/native-builds/` owns reusable app binaries. `artifacts/cache/` owns reusable private
test certificates and viewer derivatives. `artifacts/capture/` owns screenshot campaign
checkpoints and their history. Curated publication assets remain in their existing library;
raw story or manual evidence cannot stand in for the required publication attestation.
The repository-root `artifacts/` directory has a separate security-review purpose.

From `app/`, run `bun e2e/results/migrate.ts` once to group output from the older flat layout.
It refuses live runner locks and destination collisions, moves existing bytes without
rewriting their contents, and can be run again. It preserves private test certificates so
existing simulators keep trusting the same authority. Existing scenario run folders stay
where they are. Inspect the shared viewer after migration.

Raw evidence may include sensitive state. The viewer serves only allowlisted files, refuses
symlinks and custody paths, and keeps story/manual runs out of bulk deletion until their
cleanup safety has been assessed. Keep provenance and custody records with their run.
