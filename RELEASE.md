# Release Guide

This repo uses EAS remote credentials for production Android and iOS builds. Do not create a new Android keystore for release builds unless you are intentionally changing the app signing identity.

## iOS Development Build

Build a development client for iOS:

```sh
bun run build:dev:ios
```

This uses the `development` EAS profile and the dev bundle identifier.

## iOS Production

Build and submit the production iOS app:

```sh
bun run build:ios
```

This runs the production EAS build and uses `--auto-submit` for App Store Connect.

## iOS Freedom Store

Ship a processed iOS Alternative Distribution Package to Freedom Store:

```sh
bun run release:ios <ADP_ID>
```

`<ADP_ID>` is the Alternative Distribution Package ID from App Store Connect:

```text
App Store Connect -> Sovran -> Distribution -> Activity -> iOS -> version -> Alternative Distribution Package ID
```

The script downloads the ADP into `../sovran.money`, updates the AltStore source metadata, waits for the live assets, and opens or refreshes the Freedom Store PR. See `scripts/README.md` for flags such as `--dry-run`, `--merge`, and screenshot controls.

## Android Development Build

Build a development client for Android:

```sh
bun run build:dev:android
```

This uses the `development` EAS profile and the dev package name.

## Android Google Play

Build the production Android App Bundle and submit it to Google Play:

```sh
bun run build:android
```

This runs:

```sh
EAS_NO_VCS=1 eas build -p android --profile production --auto-submit --non-interactive
```

The `production` profile builds an AAB for `com.sovranbitcoin`, uses EAS remote Android credentials, and auto-increments the remote Android `versionCode`.

The current Google Play submit profile targets the internal track first. Keep using internal until the Play Console setup and first manual upload requirements are complete.

## Android APK

Build a production APK for direct install, GitHub Releases, or Zapstore:

```sh
bun run build:android:apk
```

This runs:

```sh
EAS_NO_VCS=1 eas build -p android --profile production-apk --non-interactive
```

Run the Google Play AAB build first, then run the APK build. The AAB profile increments the remote `versionCode`; the APK profile has `autoIncrement: false` so it should reuse that same current `versionCode`.

After the APK build finishes, download the APK from the EAS artifact URL and verify it before publishing:

```sh
aapt dump badging path/to/sovran.apk | rg "package|versionCode|versionName"
apksigner verify --verbose --print-certs path/to/sovran.apk
```

Expected production package:

```text
com.sovranbitcoin
```

Expected Android signing certificate SHA-256:

```text
1F:7F:A5:DD:CB:4A:F4:C2:30:16:CD:AF:1D:89:64:C7:7A:F4:BF:44:10:B5:94:97:81:88:5F:F0:A4:F6:6B:B3
```

For seamless Play Store to direct APK updates, the Play Console app signing certificate must match this same SHA-256. If Google Play uses a different app signing key, Play-installed users will not be able to update to the direct APK without uninstalling first.

## GitHub Releases

Upload the verified APK to the matching GitHub release:

```sh
gh release upload v0.1.0 path/to/sovran.apk --clobber
```

If creating a new release, target the commit that was built by EAS:

```sh
gh release create v0.1.0 path/to/sovran.apk --target <commit-sha> --notes-file <notes-file>
```

Use the same APK for GitHub Releases and Zapstore. Do not rebuild separately for each store.

## Zapstore

Install `zsp` if needed:

```sh
go install github.com/zapstore/zsp@latest
export PATH="$PATH:$HOME/go/bin"
```

Initialize or update Zapstore metadata:

```sh
zsp publish --wizard
```

Commit the generated `zapstore.yaml`.

After the verified APK is attached to the GitHub release, publish to Zapstore:

```sh
zsp publish --quiet zapstore.yaml
```

If using a NIP-46 signer or other non-interactive signer, set `SIGN_WITH` before publishing:

```sh
SIGN_WITH="bunker://..." zsp publish --quiet zapstore.yaml
```

Certificate linking is an identity step and should be handled deliberately. Do not rotate the Android signing key or Zapstore publisher key casually.
