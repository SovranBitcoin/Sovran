# Release provenance

Which builds of Sovran could be on a phone, and which commit each was built from. This is the
first artifact of the [persistence release safety](../../../.agents/skills/persistence-release-safety/SKILL.md)
procedure. Rebuild it with:

```sh
python3 .agents/skills/persistence-release-safety/epochs.py builds   # needs `eas login`
python3 .agents/skills/persistence-release-safety/epochs.py diff
```

Last rebuilt 2026-10-10 against candidate `5651d4720` (0.1.4).

## Sources

| Source | What it proves | Covers |
| --- | --- | --- |
| EAS build list (`eas build:list`) | Every build made, its version, build number, date and, when recorded, its commit | 932 builds, 456 of them finished store builds, 2024-04-29 to 2026-09-12 |
| `origin/release-state` (`active.json`, `history/0.1.2.json`) | The commit, build numbers and per-channel confirmation written by the release pipeline | 0.1.2, 0.1.3 |
| Git tags and GitHub releases | The tagged commit; 0.1.3 carries the Play-signed APK and its checksum | `v0.1.0`, `v0.1.3` |
| `app.json` history on `origin/main` | When the version string changed | 0.0.1 onward |

The full list of store builds is [store-builds.tsv](store-builds.tsv); where the durable surface
changed between them is [epoch-diff.txt](epoch-diff.txt).

A **store build** here is any finished build with store distribution, or the signed
`production-apk` profile. Every one of them could have been installed by a tester through
TestFlight or a Play track, so every one counts as shipped. Which of them reached the public
store is not recorded by EAS; see the open questions.

## Confidence

- **exact**: every store build of the version names a commit that is in this repository.
- **bounded**: some builds name a commit here and some do not. The version is the range.
- **inferred**: no build names a commit here. Only the dates are known, so the version is every
  commit on `origin/main` between the first and last build date, and `epochs.py diff` walks
  them all.

## Versions

| Version | Store builds | Built | Commits named | In this repo | First … last commit | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| 0.0.1 | 164 iOS, 19 Android | 2024-04-29 … 2025-04-30 | 74 | 13 | `eb83c0b965` … `d73e31002e` | bounded (151 builds name no commit here) |
| 0.0.2 | 6 iOS, 0 Android | 2025-04-23 … 2025-04-27 | 5 | 5 | `011e1fb476` … `d46779255f` | exact |
| 0.0.11 | 23 iOS, 0 Android | 2025-04-30 … 2025-05-03 | 7 | 7 | `d73e31002e` … `7327ed3b6b` | exact |
| 0.0.12 | 40 iOS, 0 Android | 2025-05-03 … 2025-05-17 | 5 | 5 | `7327ed3b6b` … `3bc6663dff` | exact |
| 0.0.13 | 3 iOS, 0 Android | 2025-05-17 … 2025-05-22 | 2 | 2 | `3bc6663dff` … `4fb2b47ce1` | exact |
| 0.0.15 | 3 iOS, 0 Android | 2025-05-18 … 2025-05-22 | 2 | 2 | `dfd76b0c87` … `4fb2b47ce1` | exact |
| 0.0.16 | 1 iOS, 0 Android | 2025-05-22 | 1 | 1 | `4fb2b47ce1` | exact |
| 0.0.17 | 2 iOS, 0 Android | 2025-05-23 | 1 | 1 | `112daa63a3` | exact |
| 0.0.18 | 2 iOS, 0 Android | 2025-05-23 … 2025-06-08 | 2 | 2 | `47dda63e7b` … `54d601669e` | exact |
| 0.0.20 | 1 iOS, 0 Android | 2025-06-08 | 1 | 1 | `54d601669e` | exact |
| 0.0.21 | 1 iOS, 0 Android | 2025-06-11 | 1 | 1 | `20f1bf5044` | exact |
| 0.0.22 | 2 iOS, 0 Android | 2025-06-17 | 2 | 2 | `6d258ef4df` … `52338d4343` | exact |
| 0.0.24 | 2 iOS, 0 Android | 2025-06-18 … 2025-07-04 | 2 | 2 | `8ea2cc8b7c` … `0babdbd753` | exact |
| 0.0.25 | 6 iOS, 0 Android | 2025-07-04 … 2025-07-06 | 3 | 3 | `0babdbd753` … `4761d5ba49` | exact |
| 0.0.26 | 3 iOS, 0 Android | 2025-07-18 | 2 | 2 | `ff8f5bbe5a` … `dffd783596` | exact |
| 0.0.27 | 1 iOS, 0 Android | 2025-07-18 | 1 | 1 | `dffd783596` | exact |
| 0.0.28 | 1 iOS, 0 Android | 2025-07-21 | 1 | 1 | `ac32c01529` | exact |
| 0.0.29 | 1 iOS, 0 Android | 2025-07-21 | 1 | 1 | `ac32c01529` | exact |
| 0.0.30 | 1 iOS, 0 Android | 2025-07-21 | 1 | 1 | `04132c7616` | exact |
| 0.0.32 | 1 iOS, 0 Android | 2025-07-21 | 1 | 1 | `fc4d44b7d8` | exact |
| 0.0.33 | 1 iOS, 0 Android | 2025-07-21 | 1 | 1 | `0b85d0bf32` | exact |
| 0.0.34 | 1 iOS, 0 Android | 2025-07-21 | 1 | 1 | `9308263902` | exact |
| 0.0.35 | 1 iOS, 0 Android | 2025-07-22 | 1 | 1 | `5b12af557f` | exact |
| 0.0.37 | 2 iOS, 0 Android | 2025-07-30 | 1 | 1 | `0c82c789df` | exact |
| 0.0.38 | 1 iOS, 0 Android | 2025-07-30 | 1 | 1 | `0c82c789df` | exact |
| 0.0.40 | 1 iOS, 0 Android | 2025-08-01 | 1 | 1 | `5697ea86d3` | exact |
| 0.0.45 | 2 iOS, 0 Android | 2025-10-15 … 2025-11-23 | 2 | 2 | `4ef992d27e` … `ca5fee2493` | exact |
| 0.0.50 | 16 iOS, 0 Android | 2025-11-26 … 2025-11-28 | 10 | 10 | `cbc46114b9` … `aecd05ebdc` | exact |
| 0.0.51 | 18 iOS, 0 Android | 2025-11-28 … 2025-12-11 | 17 | 17 | `aecd05ebdc` … `4722cbb57b` | exact |
| 0.0.52 | 1 iOS, 0 Android | 2025-12-13 | 1 | 1 | `d85f6e2ba7` | exact |
| 0.0.53 | 3 iOS, 0 Android | 2025-12-14 … 2025-12-16 | 1 | 1 | `51f4446f19` | exact |
| 0.0.54 | 1 iOS, 0 Android | 2026-01-04 | 1 | 1 | `8fb8f6f9de` | exact |
| 0.0.55 | 1 iOS, 0 Android | 2026-01-04 | 1 | 1 | `8fb8f6f9de` | exact |
| 0.0.56 | 13 iOS, 0 Android | 2026-01-05 … 2026-02-10 | 2 | 2 | `8fb8f6f9de` … `db56061ec6` | exact |
| 0.0.57 | 3 iOS, 0 Android | 2026-02-10 … 2026-02-15 | 2 | 2 | `db56061ec6` … `2e780f69e5` | exact |
| 0.0.58 | 4 iOS, 0 Android | 2026-02-15 … 2026-02-18 | 3 | 3 | `ce15097039` … `8d9ef44183` | exact |
| 0.0.60 | 5 iOS, 0 Android | 2026-02-18 … 2026-02-27 | 3 | 3 | `8d9ef44183` … `09a13c0a9a` | exact |
| 0.0.61 | 51 iOS, 0 Android | 2026-02-27 … 2026-04-06 | 11 | 11 | `09a13c0a9a` … `8f1a88d186` | bounded (34 builds name no commit here) |
| 0.0.62 | 4 iOS, 0 Android | 2026-04-08 | 0 | 0 | none recorded | inferred (4 builds name no commit here) |
| 0.0.63 | 12 iOS, 0 Android | 2026-04-26 … 2026-05-16 | 0 | 0 | none recorded | inferred (12 builds name no commit here) |
| 0.1.0 | 19 iOS, 3 Android | 2026-05-17 … 2026-06-28 | 0 | 0 | none recorded | inferred (22 builds name no commit here) |
| 0.1.1 | 1 iOS, 5 Android | 2026-06-28 | 0 | 0 | none recorded | inferred (6 builds name no commit here) |
| 0.1.2 | 1 iOS, 1 Android | 2026-09-12 | 1 | 1 | `148ebd085a` | exact |
| 0.1.3 | 1 iOS, 1 Android | 2026-09-12 | 1 | 1 | `d9ad12c4bd` | exact |

## What is known beyond the table

- **0.1.3** is the only version with a complete pipeline record: commit `d9ad12c4b`, iOS build
  176 on the App Store (confirmed 2026-09-12) and the Freedom Store (2026-09-15), Android
  build 24 on Google Play (2026-09-18), Zapstore and as a GitHub APK (2026-09-12, SHA-256
  `2fca9101…58a941`, signing certificate `b598befc…1e59af`).
- **0.1.2** was built from `148ebd085` and retired the same day. iOS build 175 was uploaded
  to App Store Connect; the Android bundle never completed Play review.
- **`v0.1.0`** is tagged at `d23d072307` (2026-06-08), but nineteen iOS builds called 0.1.0
  were made between 2026-05-17 and 2026-06-28, and none recorded a commit. The tag is one
  point inside that range, not the release.
- **Android** had store builds only as 0.0.1 (2024-09 to 2025-02, `versionCode` 1) and then
  from 0.1.0 (2026-06-26). Any Android phone that upgrades is on 0.1.0 or later, or on a
  2024 test build.
- **The iOS bundle identifier** was `com.sovran.money` in the first commit of this repository
  and `com.sovranbitcoin` by 0.0.11. An install under the old identifier is a different app
  to iOS and cannot upgrade into the candidate.

## What cannot be read

| Gap | Size | Why | Treated as |
| --- | --- | --- | --- |
| 0.0.1 builds before this repository's first commit (2025-02-03) | 99 builds | The source lived somewhere else | Unknown state. Nothing can be tested. Recorded in the ledger as INCONCLUSIVE unless shown never to have been public |
| 0.0.1 builds after that date whose commit is not here | 52 builds | History was rewritten; the commits no longer exist | The whole of `origin/main` across those dates |
| 0.0.61 (part), 0.0.62, 0.0.63, 0.1.0, 0.1.1 | 78 builds, 2026-03 to 2026-06-28 | Built without a recorded commit | Every first-parent commit on `origin/main` in the window, plus the branches that were live then |

## Open questions, and who can answer them

> **To do when access exists.** Each of these narrows a row above.

1. **App Store Connect**: which build numbers were released to the App Store, and which only
   to TestFlight (internal or external)? TestFlight builds expire after 90 days, so a
   TestFlight-only build older than that can only still be installed if it was never opened
   to update. This would retire most of the 0.0.x rows.
2. **App Store Connect analytics**: active devices per app version. A version with no active
   devices can be dropped from the state space with evidence instead of by assumption.
3. **Play Console**: which `versionCode`s reached production, and the 2024 `versionCode` 1
   builds: internal track only, or public?
4. **Freedom Store and Zapstore**: which versions were listed before the pipeline began
   recording it at 0.1.3? A listed binary can be downloaded and its JavaScript bundle matched
   to a commit by its store names and migration ids.
5. **The earlier repository**: where the source for the 2024 builds lives. Without it, what
   those builds wrote to disk is unknown.
6. **The machine that built 0.0.61 to 0.1.1**: shell history or EAS build logs may name the
   branch each was built from.
