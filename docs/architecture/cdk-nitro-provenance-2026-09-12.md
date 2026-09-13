# CDK Nitro package and build provenance

Verified on 2026-09-12 against Sovran commit `d9ad12c4bde03b609cd90a4487c466b88007a4cb` and its installed dependency. Application code, dependency declarations, and the existing entropy audit were not changed.

**Verdict: the installed package and native binaries match the maintainer's successful GitHub Actions build. No evidence of package substitution or malicious behavior was found in the inspected bridge source and binary indicators. This is a provenance verification and bounded security review, not proof that every transitive dependency or machine instruction is benign.**

The app declares `github:crodas/cdk-nitro#v0.17.3`; Bun resolves it to `3007137`. A fresh upstream clone and GitHub's tag API both resolve that tag to [`300713781f51ab60026d89387def867e5ea1741b`](https://github.com/crodas/cdk-nitro/commit/300713781f51ab60026d89387def867e5ea1741b). All **82 tracked files** matched the installed directory byte-for-byte, including JavaScript, TypeScript, Rust, C++, generated registration code, build configuration, and all native libraries. The only additional installed file was Bun's `.bun-tag` metadata.

The actual builder is the maintainer's **`crodas/cdk` fork of `cashubtc/cdk`**, rather than a workflow in the distribution repository. [Run 31555523511](https://github.com/crodas/cdk/actions/runs/31555523511), manually triggered by `crodas` on August 12, 2026, completed successfully. All nine jobs succeeded: source synchronization, six target builds, XCFramework assembly, and publication. The workflow and checkout used source revision [`d71461c94416ce5b47e6110daf5a4ec32a41e1d6`](https://github.com/crodas/cdk/blob/d71461c94416ce5b47e6110daf5a4ec32a41e1d6/.github/workflows/nitro-publish.yml). The publish log records creation and push of commit `3007137`. The Rust bridge source also matched the monorepo's source at that revision exactly.

Downloaded all **seven retained Actions artifact archives** through GitHub's API. Each archive's SHA-256 matched GitHub's recorded digest. Compared their contents directly with the installed package: all three Android libraries, the iOS device library, both simulator architecture slices, and all five XCFramework files matched. Simulator slices were extracted with `lipo -thin` before comparison. This connects the installed bytes to the build artifacts independently of the unsigned commit's author label.

| Native target | Actions artifact ID | Installed payload SHA-256 |
| --- | --- | --- |
| Android arm64 | 9125905072 | `6af8dbcdae71580394146df058f2ac3ca89dd957c0ec7ec52e9daf8e3a1557ea` |
| Android armv7 | 9125901507 | `9a81919673e1e3f0e95476df6a82a5831b1b9eb56d70bbd1ca04614f071d2ffa` |
| Android x86_64 | 9125897333 | `900b0bdd55b6aa7f5abde9bfc062058dd928386463f8c0b34470dfadc032df32` |
| iOS arm64 device | 9125939913 | `f0c0023d08a31937321a9b23955deb5dd1547257addf97052c0f5e9debf44a6e` |
| iOS arm64 simulator slice | 9125928519 | `2afff7f3d55a4a654485ded19562ef3d0991da9ca74fe3d8940605d7614339fb` |
| iOS x86_64 simulator slice | 9125957688 | `c4e1cd1e0d2956e79817a9d477c0255a21890e9a8b88232dac59003f14fed22d` |
| Combined simulator archive | XCFramework 9125963952 | `7a4b0e4e7a0aec1281692ff86975cf82b37e7d1216ddd8975ee697b79617503f` |

Reviewed the production Rust bridge, C++ adapter, TypeScript adapter, native registration, package scripts, and platform build configuration. The bridge delegates random secrets, deterministic derivation, and blinding to `cashu`; it contains no identified network transport, shell execution, seed logging, seed replacement, or hardcoded recipient. The package has no `preinstall`, `install`, `postinstall`, or `prepare` hook; `prepack` runs the JavaScript builder. Platform builds link the included native libraries. Runtime registration constructs the output creator.

Inspected strings and undefined symbols in all five packaged native files using LLVM tools. No obvious exfiltration endpoint or imports for socket connection, DNS lookup, process execution, or dynamic loading were found. iOS archives reference `CCRandomGenerateBytes`; Android libraries contain ordinary Rust/libc facilities including `syscall`, `open`, `read`, and `write`. These scans cannot exclude direct syscalls, concealed behavior, or malicious cryptographic output. Xcode's older `nm` initially could not parse the Rust LLVM bitcode; the installed Homebrew LLVM tool completed the inspection.

The build logs show real compilation of `cashu 0.17.3`, `rand 0.8.7`, `rand_core 0.6.4`, `rand_chacha 0.3.1`, `getrandom 0.2.17` and `0.4.3`, `bitcoin 0.32.102`, and `secp256k1 0.29.1`. However, every target logged **“Locking 170 packages to latest compatible versions.”** The standalone Rust bridge has no committed `Cargo.lock`, and the workflow builds without `--locked`. The root CDK lockfile is not the standalone bridge's resolved lockfile. Nix provisions the build environment; this does not make the Cargo dependency resolution locked or establish a reproducible binary build.

Remaining assurance gaps:

- No independent source-to-binary rebuild was completed. The verified identity is installed bytes = tagged repository bytes = retained CI artifacts.
- The publish workflow has no Rust/JavaScript test step or signed build-attestation step. Actions use version tags rather than immutable action SHAs; build jobs clone a release branch rather than passing its immutable commit. These are hardening gaps, not evidence of compromise.
- The distribution commit is unsigned and the release tag is lightweight. Artifact-attestation API requests for the Android arm64 payload returned HTTP 404 for both repositories; no attestation was established.
- The app's deterministic startup self-test checks compatibility with cashu-ts, not maliciousness. A targeted implementation could pass fixed test vectors.
- This inspection did not certify a distributed IPA/APK or perform a complete transitive-dependency audit, disassembly review, or runtime exfiltration test.

Recommended next hardening: pin the full dependency commit, retain the standalone build's Cargo lockfile, build with `--locked`, pin CI action/source revisions, add native and adapter tests, publish signed artifact provenance, and independently reproduce the native libraries. Preserve these verified artifacts before GitHub's reported expiry on November 10, 2026 if they will be needed for a later release audit.

Raw downloaded metadata, logs, artifact ZIPs, and comparison JSON are retained locally in `/var/folders/tf/xdnqh2ln3nv7280g886795hw0000gn/T/sovran-cdk-provenance-oakn2uh4`. This is temporary storage. The authoritative remote evidence is the linked run, [artifact metadata](https://api.github.com/repos/crodas/cdk/actions/runs/31555523511/artifacts), immutable source revision, and tagged package commit; the payload hashes above remain in this report.
