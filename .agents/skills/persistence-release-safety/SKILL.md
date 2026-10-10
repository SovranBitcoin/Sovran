---
name: persistence-release-safety
description: Certify that a release candidate upgrades every durable state a real Sovran install could hold, with nothing lost. Use before a release, after changing a persisted store, SecureStore key, SQLite database, migration, account or provider startup code, or when asked whether existing users are safe, about upgrade safety, data migration, or "will this break users on an older version".
---

# Persistence release safety

This certifies one thing: a phone holding any state an earlier Sovran release could have
written opens the candidate and still has its money, its keys and its data.

It is a procedure with a verdict, not a reading exercise. The verdict is **PASS**, **FAIL** or
**INCONCLUSIVE**, and PASS exists only as a ledger in which every row points at evidence.
Passing unit tests are one kind of evidence; they are not the verdict.

## Rules that do not bend

1. **Never erase, reset or simplify user data to make a check pass.** A store that cannot be
   read is preserved, not replaced. A fix that discards state is a FAIL with a nicer name.
2. **Never weaken, skip or delete a test to get green.** If a test is wrong, say why in the
   ledger and replace it with one that is at least as strict.
3. **Discover; do not remember.** Every list in this procedure is rebuilt from the source at
   the revision in question. Earlier ledgers, memories and this file's examples are leads.
4. **Uncertainty widens the net.** Where the history cannot be proven, test every state that
   could plausibly have existed. Do not pick the likeliest and move on.
5. **Evidence, not conclusions, passes between agents.** A reviewer is given paths, revisions
   and command output. It is never given another agent's verdict to confirm.
6. **No empty cells.** A ledger cell holds evidence, or `NOT RUN: <reason>`. A row with a
   `NOT RUN` in a required column cannot be PASS.
7. **If safety cannot be shown, the answer is INCONCLUSIVE.** Say exactly what is missing and
   who can supply it.
8. Never run destructive or funded scenarios against a real wallet. Old revisions are read
   with `git show` and `git worktree`; never check them out over the working tree.

## Where the record lives

| File | Holds |
| --- | --- |
| `docs/architecture/persistence/release-provenance.md` | Every version, the commit it was built from, how that is known, and a confidence level |
| `docs/architecture/persistence/persistence-map.md` | Every durable thing the app writes, per epoch, and what the candidate does with it |
| `docs/architecture/persistence/evidence-ledger.md` | One row per (epoch, durable thing) and per invariant, with evidence and a verdict |
| `docs/architecture/follow-ups.md` | Anything found and not fixed |

Update these in place. A run that changes none of them did not happen.

## Procedure

Work the phases in order. Each ends with an artifact; do not start the next without it.

### 1. Provenance: what shipped

Rebuild `release-provenance.md`. Sources, strongest first:

1. `origin/release-state` (`active.json`, `history/*.json`): the exact `sourceSha`, build
   numbers and per-channel confirmation written by the release pipeline.
2. Git tags and GitHub releases (`git tag`, `gh release list`), including attached binaries.
3. Version and build-number changes in `app.json` / `app/app.json` along `origin/main`
   first-parent history.
4. Store listings and dates (App Store, Play, the Freedom Store / Zapstore, direct APKs).

Give every version one confidence level:

- **exact**: the pipeline or a tag names the commit.
- **bounded**: the commit is unknown, but it lies between two known commits. Record both ends.
- **inferred**: only a date or a version string is known.

For **bounded** and **inferred** versions the epoch is the whole range: every persistence
change inside it is treated as shipped.

> **To do when access exists.** With App Store Connect, Play Console, EAS or Freedom Store
> access, pull the build list (version, build number, upload date, and the commit where the
> build records one) and narrow every bounded or inferred row. A downloaded binary's JS
> bundle can be matched to a commit by its store names and migration ids. Until then those
> rows stay wide, and the ledger tests the wide range.

### 2. Discovery: what is durable

For the candidate and for one revision per epoch, run:

```sh
sh .agents/skills/persistence-release-safety/surface.sh <rev>
```

It prints raw lines only. From them, and from reading the code they point at, rebuild
`persistence-map.md`. It must cover, and say "none found, searched for X" where empty:

- Persisted stores: name, storage key format (including any account or pubkey suffix),
  version, `migrate`, `partialize`, the schema that reads it, what happens on a failed read.
- AsyncStorage keys written outside a store, including markers, flags and caches.
- SecureStore: key names, options (`keychainService`, accessibility, authentication), what
  each value means, and how it is derived from or into other values.
- SQLite: database file names per account, who owns the schema (Coco, the Nostr cache, the
  app), schema version, and what upgrades it.
- Files in the document and cache directories. MMKV. Anything a native module persists.
- Key and seed derivation: a changed path or account index silently changes whose money and
  identity the same stored phrase opens.
- Native storage module versions per epoch (`bun.lock` / `package.json`): a new major can
  move or re-encode data with no JavaScript change.

An **epoch** is a maximal run of releases with the same durable surface. The surface script
makes the boundaries mechanical: diff its output between neighbouring releases.

### 3. State space: what a phone can hold

For each epoch write down the states a real install could be in, not only the fresh one:

- one account and several; imported and derived accounts; the account limit;
- upgraded through several epochs, and skipping epochs (0.0.x straight to the candidate);
- a store at every version it ever had, absent, empty, oversized, and unparseable;
- operations in flight when the app was killed: a send, a receive, a melt, a swap, a
  migration, an account switch, a delete;
- secrets present with stores missing, and stores present with secrets missing (restore from
  a device backup, a keychain that outlived an uninstall on iOS);
- the same state reached on iOS and on Android where they differ.

### 4. Fixtures and tests

Fixtures are built from what the old code actually wrote: take the shape from the old
revision's source, not from the current schema. For each (epoch, durable thing):

- a fixture of the released state, and a test that the candidate reads it with nothing lost;
- every upgrade path, including skipped epochs, ends in the same state as the direct path;
- **cross-store invariants** hold afterwards: every account in the profile list has its keys
  and its databases; nothing belongs to an account that does not exist; the active account's
  stores, secrets and databases agree;
- **Cashu invariants** hold: the balance before equals the balance after; no proof is
  dropped, duplicated or moved between accounts or mints; counters never go backwards; a
  pending operation is still recoverable; the wallet phrase and its derivation are unchanged;
- **fault injection** at every boundary: a read that throws, a write that throws, a full
  disk, a kill between two writes, a migration run twice, a migration interrupted. After
  each, the next launch recovers or stops safely, and a retry repeats nothing harmful;
- **property tests** where the input space is wide: arbitrary old blobs never throw out of
  hydration and never silently become defaults.

Where a real upgrade can be run, run it: install the old build, create state, install the
candidate over it. Record exactly what was installed and how it was signed. An upgrade from
old JavaScript inside the new native build is weaker evidence than a store-signed upgrade;
label it as what it is.

On Android the released binary can be upgraded without the store key: download the release
APK (GitHub release, checksum in `origin/release-state`), build the candidate with
`assembleRelease` and a higher `versionCode`, sign both with the same local keystore
(`apksigner sign`), install the old one, make state, then `adb install -r` the new one.
Data and Keystore entries follow the package, not the certificate. Use an emulator that has
no store-signed copy installed. iOS has no equivalent; it needs TestFlight.

When the old binary is no longer downloadable (EAS artifacts expire), rebuild it: a detached
`git worktree` at the release commit, `bun install --frozen-lockfile`, `git submodule update
--init` for the vendored native sources, `expo prebuild`, `assembleRelease`. Say in the
ledger that it is a rebuild. To carry money through the upgrade without a real wallet, mint
a token from the public test mint (`testnut.cashu.space`, fake payments) and redeem it in
the old build.

### 5. Independent roles

Run these as separate agents (Codex with `codex exec --sandbox read-only`, detached, one
slice each; see the Codex audit slicing notes). Give each the repository, the revisions and
the artifact paths. Do not give one agent another's findings until the verifier step.

| Role | Question it answers | Must return |
| --- | --- | --- |
| Release historian | Which commits shipped, and how sure are we? | Provenance rows with source and confidence |
| Persistence investigator | What do stores, AsyncStorage and SecureStore hold per epoch, and what reads them now? | Map rows with `file:line` at both revisions |
| Coco / SQLite investigator | What databases exist per epoch, and does the candidate open and upgrade each? | Schema and file-name diffs, upgrade path |
| Cashu safety reviewer | Can any upgrade path lose, duplicate or strand ecash or change derivation? | Each invariant with the code that keeps it |
| Adversarial tester | Which state from phase 3 breaks the candidate? | Concrete failing states, or the search done |
| Recovery tester | After each injected fault, what does the user see, and does retry work? | Per fault: screen, next launch, retry result |
| Independent verifier | Is each ledger row's evidence real and sufficient? | Per row: confirmed, or what is missing |

A finding is a candidate until reproduced or traced in the source. A role that reports
"no issues" must list what it searched.

### 6. Resolve loop

For every finding of high severity: write the failing test, fix the code, rerun the test and
the suites it touches, and send the fix back to the role that found it. Repeat until no
high-severity finding is open or one is blocked. A blocked finding is recorded with what
unblocks it, and it makes the verdict INCONCLUSIVE or FAIL, never PASS.

### 7. Ledger and verdict

`evidence-ledger.md` has one row per (epoch, durable thing) and one per invariant:

| Column | Content |
| --- | --- |
| Epoch | Version range and confidence |
| Durable thing | Store, key, database or file |
| Released shape | `file:line` at the old revision |
| Candidate reader | `file:line` at the candidate |
| Fixture / test | Test file and case name |
| Fault cases | Tests, or `NOT RUN: <reason>` |
| Real upgrade | What was installed over what, or `NOT RUN: <reason>` |
| Verifier | Confirmed by which role, on what evidence |
| Verdict | PASS / FAIL / INCONCLUSIVE |

The run's verdict is the worst row. State it in one line at the top of the ledger with the
date and the candidate commit, followed by the list of rows that are not PASS.

## What laziness looks like here

Stop and redo the step if any of these is true:

- a list was copied from an earlier run without rerunning the surface script;
- an epoch was skipped because "it is old" or "nobody is on it" without provenance to say so;
- a fixture was written from the current schema;
- a row cites a test without naming the case, or cites a test that was not run this time;
- a reviewer agreed with a conclusion it was handed;
- the verdict is PASS and a required cell says `NOT RUN`.
