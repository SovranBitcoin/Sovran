# nutpatch

[cashu-ts](https://github.com/cashubtc/cashu-ts) is powerful, especially with v8 web engine
react native + hermes makes cryptography painfully slow.

nutpatch is a hand-written C patch that replaces hot-path crypto operations in cashu-ts,
exposed via [nitromodules](https://github.com/mrousavy/nitro) and C++ bindings.

peace

---

## Using nutpatch in an Expo project

nutpatch is a **Nitro Module**, so it ships native C/C++/Swift code. It cannot run in Expo Go — you need a dev client / bare build with the New Architecture enabled.

> **Heads up — if you're pulling from the upstream `mrousavy/nitro` clone**, two small fixes are required before the package can be consumed as a dependency. See [Patches required on top of upstream](#patches-required-on-top-of-upstream) at the bottom of this doc.

### 1. Add the package

Either drop `packages/nutpatch/` into your repo and link it:

```json
// package.json
"dependencies": {
  "nutpatch": "file:./packages/nutpatch",
  "react-native-nitro-modules": "^0.35.3",
  "@noble/curves": "^2.0.1",
  "@noble/hashes": "^2.0.1"
}
```

…or publish it to a registry and install normally. The peer deps above are required.

### 2. Enable the New Architecture

In `app.json`:

```json
{ "expo": { "newArchEnabled": true } }
```

Nitro only works on Fabric/TurboModules.

### 3. Prebuild & install pods

```bash
npx expo prebuild --clean
cd ios && pod install && cd ..
npx expo run:ios   # or run:android
```

Autolinking is automatic:
- iOS — `NitroNutpatch.podspec` + `react-native.config.js` are picked up by the RN CLI; `pod install` compiles the C++ core and vendored `secp256k1`.
- Android — the same `react-native.config.js` wires the Gradle module in.

No manual `Podfile` or `settings.gradle` edits needed. You **cannot** use Expo Go after this point — rebuild a dev client.

### 4. Call it from JS

All helpers are exported from the package root and internally resolve the native `Crypto` hybrid object on first use:

```ts
import {
  hashToCurve,
  blindMessage,
  unblindSignature,
  createBlindSignature,
  verifyDLEQProof,
} from 'nutpatch'

const B_ = hashToCurve(secretBytes)
const { B_: blinded, r } = blindMessage(secretBytes)
```

If you prefer to grab the hybrid object directly:

```ts
import { NitroModules } from 'react-native-nitro-modules'
const crypto = NitroModules.createHybridObject('Crypto')
crypto.hashToCurve(buf)
```

The name `'Crypto'` comes from `nitro.json` → `autolinking.Crypto`.

### 5. (Optional) Transparent cashu-ts acceleration

nutpatch was built to speed up `@cashu/cashu-ts` without touching call sites. The integration is a two-piece setup:

1. **Patch cashu-ts** so its `hashToCurve` / `blind` / `unblind` / `hashE` / `verifyDleqProof` check a `globalThis.__CASHU_NATIVE` shim and delegate when active. See `sovran-app/patches/@cashu+cashu-ts+3.5.0.patch` for a working reference — apply via [`patch-package`](https://github.com/ds300/patch-package) with a `"postinstall": "patch-package"` script.
2. **Install the shim at boot**, before any cashu-ts call:

   ```ts
   import { NitroModules } from 'react-native-nitro-modules'

   export function initNativeCrypto() {
     try {
       const crypto = NitroModules.createHybridObject('Crypto')
       if (globalThis.__CASHU_NATIVE) {
         globalThis.__CASHU_NATIVE.init(crypto)
       }
     } catch {
       // Expo Go / web / missing native — cashu-ts falls back to JS
     }
   }
   ```

Call `initNativeCrypto()` once during app init (e.g. wallet manager setup). If the native module is unavailable the patched cashu-ts transparently falls back to its JS implementation, so the same code runs everywhere.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot find native module 'Crypto'` | You're on Expo Go, or forgot to rebuild the dev client after adding nutpatch. Run `expo prebuild --clean` + `run:ios`/`run:android`. |
| Build error about `secp256k1` headers | `pod install` didn't run, or `HEADER_SEARCH_PATHS` in the podspec got stripped by a custom Podfile. |
| Nitro complains about the New Architecture | Set `newArchEnabled: true` in `app.json` and prebuild again. |
| cashu-ts still slow | The patch isn't applied (`postinstall` missing), or `initNativeCrypto()` runs after the first cashu-ts call. Move it earlier. |

### Patches required on top of upstream

The version of nutpatch vendored in sovran-app differs from upstream (`mrousavy/nitro`) in two ways that are **required for the package to be consumable as a dependency**. If you're pulling from a fresh upstream clone, apply both before you try to install it.

**1. `NitroNutpatch.podspec` — fix the Nitrogen autolinking load path**

```diff
- load 'nitrogen/generated/ios/NitroNutpatch+autolinking.rb'
+ load File.join(__dir__, 'nitrogen/generated/ios/NitroNutpatch+autolinking.rb')
```

Ruby's `load` resolves relative paths against `$LOAD_PATH`, not against the podspec's own directory. Without `File.join(__dir__, …)`, `pod install` fails with *"cannot load such file"* the moment nutpatch is installed as a dependency instead of being built from inside its own folder.

**2. `package.json` — ship the files consumers actually need**

Upstream's `files` array is missing entries required at install time:

```diff
  "files": [
+   "src",
+   "react-native.config.js",
+   "nitro.json",
    "nitrogen/**/*",
    "android",
    "cpp",
    "ios",
    "*.podspec"
  ]
```

- **`src`** — the package's `"react-native": "src/index"` / `"source": "src/index"` fields point into `src/`. Without it, Metro can't resolve `import … from 'nutpatch'`.
- **`react-native.config.js`** — without it, RN autolinking doesn't see the module and no pods/gradle are added.
- **`nitro.json`** — required for nitrogen regen and debugging.

Yarn v1 symlinks `file:` deps so an in-repo `file:./packages/nutpatch` setup works either way, but any published tarball (or stricter package manager) will break without these entries.

> These two patches are the only upstream deltas relevant to *importing* nutpatch. Sovran's vendored copy also contains runtime bug fixes (thread-safe secp256k1 init via `std::call_once`) and extra methods (`batchUnblind`, `batchDeriveLegacy`) that aren't required to get the module loading — apply those only if you need them.
