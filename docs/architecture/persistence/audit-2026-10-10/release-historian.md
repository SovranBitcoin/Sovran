| Version | Channels it plausibly reached | Commit or inclusive commit range | Confidence | Source of that knowledge | Notes |
|---|---|---|---|---|---|
| 0.0.1 | iOS beta/store possible; Android APK possible | `957eed9ea–b52b7a238`; then `7e2e862e2–d73e31002` | bounded | `957eed9ea:app.json:5`, `b52b7a238:app.json:5`; `7e2e862e2:app.json:5`, `d73e31002:app.json:5` | Two separate runs, with different iOS identifiers. Initial build 182; later build 253 (`957eed9ea:app.json:22`; `323f4f3b0:app.json:22`). |
| 0.0.2 | TestFlight probable; store/APK unconfirmed | `062ddaa4f–e00dbb339` | bounded | `062ddaa4f:app.json:5`, `e00dbb339:app.json:5`; commit `06f521942` says “fix error on testflight,” and `06f521942:app.json:5` identifies 0.0.2 | Builds 1–4; identifier changes within this version (`062ddaa4f:app.json:22,27`; `0d890908f:app.json:22,27`). |
| 0.0.11 | iOS beta/store possible; APK unconfirmed | `b00b93241–531c1f463` | bounded | `b00b93241:app.json:5`, `531c1f463:app.json:5` | Version/config evidence only; no publication receipt found. |
| 0.0.12 | iOS beta/store possible; APK unconfirmed | `f599f03bd–921771305` | bounded | `f599f03bd:app.json:5`, `921771305:app.json:5` | No publication receipt found. |
| 0.0.13 | iOS beta/store possible; APK unconfirmed | `26162bd91–112daa63a` | bounded | `26162bd91:app.json:5`, `112daa63a:app.json:5`; `26162bd91` message: “fix app store connect issues” | Submission-related work does not prove approval or distribution. |
| 0.0.17 | iOS beta/store possible; APK unconfirmed | `47dda63e7–47dda63e7` | bounded | `47dda63e7:app.json:5` | One first-parent source interval; not an exact shipped-build identification. |
| 0.0.18 | iOS beta/store possible; APK unconfirmed | `2163ce642–20f1bf504` | bounded | `2163ce642:app.json:5`, `20f1bf504:app.json:5` | No publication receipt found. |
| 0.0.21 | iOS beta/store possible; APK unconfirmed | `d4aa2a883–6d258ef4d` | bounded | `d4aa2a883:app.json:5`, `6d258ef4d:app.json:5` | No publication receipt found. |
| 0.0.22 | iOS beta/store possible; APK unconfirmed | `52338d434–8ea2cc8b7` | bounded | `52338d434:app.json:5`, `8ea2cc8b7:app.json:5` | No publication receipt found. |
| 0.0.24 | iOS beta/store possible; APK unconfirmed | `a09fe2d54–4ef992d27` | bounded | `a09fe2d54:app.json:5`, `4ef992d27:app.json:5` | Long interval before jump to 0.0.45; retain all persistence changes within it. |
| 0.0.45 | iOS beta/store possible; APK unconfirmed | `bab1c891f–4d4594c66` | bounded | `bab1c891f:app.json:5`, `4d4594c66:app.config.js:21` | Version moves into dynamic configuration (`20c8d015c:app.config.js:21`). |
| 0.0.50 | iOS beta/store possible; internal APK possible | `bba766403–aecd05ebd` | bounded | `bba766403:app.config.js:21`, `aecd05ebd:app.config.js:21`; `8f0242ec0:eas.json:13–27` | **Missing from supplied app.json-derived version table.** |
| 0.0.51 | TestFlight probable; App Store possible; internal APK possible | `b640cda7c–d85f6e2ba` | bounded | `b640cda7c:app.config.js:21`, `d85f6e2ba:app.json:5`; `6ed601855:app.config.js:21–24` | Source explicitly mentions TestFlight; it supplies no build receipt. |
| 0.0.52 | iOS beta/store possible; internal builds possible | `8d56486bf–7da7b5779` | bounded | `8d56486bf:app.json:5`, `7da7b5779:app.json:5` | Remote native numbering applies; local build 1 is not the uploaded build number. |
| 0.0.53 | iOS beta/store possible; internal builds possible | `51f4446f1–9ac4fe5e7` | bounded | `51f4446f1:app.json:5`, `9ac4fe5e7:app.json:5` | No publication receipt found. |
| 0.0.54 | iOS beta/store possible; internal builds possible | `8fb8f6f9d–8fb8f6f9d` | bounded | `8fb8f6f9d:app.json:5` | One first-parent source interval; branch builds remain unexcluded. |
| 0.0.56 | iOS beta/store possible; internal builds possible | `99eb79aaa–fbbaae5c1` | bounded | `99eb79aaa:app.json:5`, `fbbaae5c1:app.json:5` | Main retains 0.0.56 before jumping to 0.0.58. |
| 0.0.57 | iOS beta/store or internal builds possible | `0665148db–79c90c453` on feature-branch history | bounded | `0665148db:app.json:5`, `79c90c453:app.json:5`; `0665148db:eas.json:4,16–24` | **Missing from supplied table.** Found on `origin/feat/transfer-leg-card-refactor`; publication and main inclusion unproven. |
| 0.0.58 | iOS beta/store possible; internal builds possible | `59a27ff7a–fc2f56af5` | bounded | `59a27ff7a:app.json:5`, `fc2f56af5:app.json:5` | Branch version bump also exists at `ce1509703`; actual build source unknown. |
| 0.0.60 | iOS beta/store possible; internal builds possible | `c998c51cf–da0896b63` | bounded | `c998c51cf:app.json:5`, `da0896b63:app.json:5` | No publication receipt found. |
| 0.0.61 | iOS beta/store possible; internal builds possible | `a838d5bc3–7056ecc96` | bounded | `a838d5bc3:app.json:5`, `7056ecc96:app.json:5` | No publication receipt found. |
| 0.0.62 | iOS beta/store possible; internal builds possible | `19388f0e3–19388f0e3` | bounded | `19388f0e3:app.json:5` | One first-parent interval does not exclude builds from its merged development history. |
| 0.0.63 | iOS beta/store possible; internal builds possible | `28bf7713a–90f1326ac` | bounded | `28bf7713a:app.json:5`, `90f1326ac:app.json:5` | No publication receipt found. |
| 0.1.0 | TestFlight supported by documentation; App Store possible; Freedom/APK/Zapstore/Play internal plausible | `88fad9741–eab009126`; tag anchor `d23d07230` | bounded | `88fad9741:app.json:5`, `eab009126:app.json:5`; `v0.1.0:app.json:5`; `88fad9741:README.md:406–412`; `4203ea8ec:RELEASE.md:25–39,51–83,106–142` | `v0.1.0` resolves exactly to `d23d07230`; no attached binary was inspected. Tag does not identify every rebuild. Android was still documented as a development target (`88fad9741:README.md:29`). |
| 0.1.1 | App Store/Freedom plausible; Play internal/APK/Zapstore plausible | `4203ea8ec–37065cf1b` | bounded | `4203ea8ec:app.json:5`, `37065cf1b:app/app.json:5`; `4203ea8ec:RELEASE.md:15–39,51–83,106–142`; `HEAD:release/config.json:10` | Pipeline baseline is 0.1.1; baseline configuration is not a publication receipt. |
| 0.1.2 | EAS builds and App Store Connect upload confirmed; TestFlight possible; public distribution unconfirmed | `148ebd085` | exact | `origin/release-state:history/0.1.2.json:3–26,32–35` | iOS **175**, Android **23**. Retired; channels empty. iOS build remained submitted to ASC. |
| 0.1.3 | **App Store, Google Play, GitHub APK, Zapstore, Freedom Store confirmed in checkpoint** | `d9ad12c4b` | exact | `origin/release-state:active.json:3–64`; `v0.1.3:app/app.json:5` | iOS **176**, Android **24**. Confirmation dates: Sept 12 App Store/APK/Zapstore; Sept 15 Freedom; Sept 18 Play. |
| 0.1.4 candidate | Candidate source only; no checkpoint publication evidence | `5651d4720` = HEAD | exact | `HEAD:app/app.json:5`; `HEAD:release/preparations/0.1.4.md:69–75`; checkpoint remains 0.1.3 at `origin/release-state:active.json:3–4` | Exact candidate commit; no claim that it shipped. |

“Bounded” above describes the **committed source interval**, conditional on builds using that history and version configuration. It does **not** confirm shipment or exclude dirty builds, version overrides, or additional branch builds. Older iOS/APK plausibility comes from available production/preview profiles, not store receipts (`957eed9ea:eas.json:10–21`; `bab1c891f:eas.json:20–34`). For audit coverage, retain merged development history as well as first-parent commits.

The identifier boundary is significant:

- iOS starts as `com.sovran.money` (`957eed9ea:app.json:26`). On **2025-04-24**, `0fa1e397b` changes it to `com.sovranbitcoin`, while still version 0.0.2 (`0fa1e397b:app.json:5,27`).
- Android starts as `com.sovranbitcoin`, temporarily becomes `com.sovran.money` in 0.0.2, then changes back in the same April 24 commit (`957eed9ea:app.json:38`; `062ddaa4f:app.json:40`; `0fa1e397b:app.json:40`).
- Therefore version alone cannot identify the installed app. **Upgrade implication, inferred from those identity changes:** an old `com.sovran.money` installation cannot be assumed to share the new app’s container or accessible secrets. Treat it as a separate installation lineage until signed binaries and entitlements establish otherwise.
- Development/preview later use `com.sovranbitcoin.dev`, another separate lineage (`6ed601855:app.config.js:11,33,41`; `HEAD:app/app.config.js:11,73,88`).

Native build numbers also cannot be reconstructed from app.json alone. Auto-increment appears at `3d34a34bd:eas.json:13,17,23`; remote numbering appears at `6d67b2ead:eas.json:4`. The checkpoint’s 0.1.3 builds 176/24 demonstrate the difference from local defaults (`origin/release-state:active.json:15,20`; `HEAD:app/app.json:23,51`).

**Almost certainly never public:** 0.1.2 was superseded with no confirmed channels, after its Android permission blocked release; nevertheless include its uploaded iOS state because TestFlight availability is unresolved (`origin/release-state:history/0.1.2.json:24–35`). 0.1.4 has no publication evidence in the inspected checkpoint and is explicitly candidate preparation (`HEAD:release/preparations/0.1.4.md:69–75`). No other observed version can responsibly be excluded.

**Unknown-build gaps:**

- 0.0.1 → 0.0.11 skips labels **0.0.3–0.0.10**; 0.0.13 → 0.0.17 skips **0.0.14–0.0.16**.
- 0.0.18 → 0.0.21 skips **0.0.19–0.0.20**; 0.0.22 → 0.0.24 skips **0.0.23**.
- 0.0.24 → 0.0.45 skips **0.0.25–0.0.44**; 0.0.45 → 0.0.50 skips **0.0.46–0.0.49**.
- 0.0.54 → 0.0.56 skips **0.0.55**; 0.0.58 → 0.0.60 skips **0.0.59**.
- Main’s 0.0.56 → 0.0.58 gap contains actual **0.0.57 branch source**, so it is not merely a skipped label (`0665148db:app.json:5`; `79c90c453:app.json:5`).

Endpoints are cited in the table. Searching all reachable config histories found no other version labels in those gaps. **Absence from Git does not establish absence from EAS or stores.** Also, the earliest recorded source already says iOS build 182, leaving pre-repository build provenance unresolved (`957eed9ea:app.json:22`).

**High — historical Android signing compatibility remains unresolved.** The older guide expects certificate `AC:8C:26:60:…:56:49`; 0.1.3 records `b598befc…751e59af` (`4203ea8ec:RELEASE.md:98–104`; `origin/release-state:active.json:269`). This is a documentation/checkpoint discrepancy, not proof that incompatible APKs shipped. Obtain historical APKs and signing lineage before assuming those installations can update without uninstalling.

Questions authenticated access would answer:

1. **App Store Connect:** What are every uploaded version/build, upload date, bundle ID, selected release build, public availability dates, and TestFlight distribution dates/groups—including 0.1.2 build 175?
2. **App Store Connect:** Did `com.sovran.money` ever distribute publicly or through TestFlight? Which app records, teams, entitlements and keychain access groups did those binaries use?
3. **App Store Connect:** Which versions produced ADPs, and which packages were actually made available through Freedom Store?
4. **Play Console:** What versionName/versionCode reached each internal, closed, open and production track, with rollout dates? Were there any production releases before the checkpoint’s stated first production release, 0.1.3 (`origin/release-state:active.json:263–265`)?
5. **Play Console:** What signing certificates and rotation lineages applied to every historical artifact, and how do they compare with directly distributed APKs?
6. **EAS:** For every build, what were its source SHA, dirty/VCS status if recorded, profile, application ID, product version, native build number, completion status, artifact and submission result?
7. **EAS/store records:** Were the skipped labels ever built or uploaded, particularly 0.0.25–0.0.44, 0.0.46–0.0.49 and branch-only 0.0.57? Were multiple materially different builds distributed under one version?
8. **EAS/store records:** Can archived binaries resolve missing source provenance, including builds predating `957eed9ea` and APKs potentially signed with the older certificate?

Search coverage: release-state active/history files; local tags; origin/main first-parent configuration and EAS history; all reachable configuration histories; release-related commit messages; historical README/release tooling; CHANGELOG filenames. No application CHANGELOG or older channel-confirmation ledger was found. GitHub release attachments and authenticated provider records were **NOT RUN: unavailable within this read-only source audit**.

**Provenance verdict: INCONCLUSIVE before 0.1.3.** No repository artifacts were updated, as instructed.

