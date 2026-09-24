# Package patches

Bun applies these at install time; they are registered in the root
`package.json` under `patchedDependencies`. Create or update one with
`bun patch <package>`, edit the prepared files, then `bun patch --commit`, and
inspect the resulting patch and lockfile changes. On every upgrade, check whether
the fix is upstream and whether the import still reaches the patched file.

| Patch | Purpose | Remove when |
| --- | --- | --- |
| `@cashu/coco-core@2.0.0` | Lets a P2PK send be reclaimed by a key that may spend it — the refund key of an expired locktime, or our own on a self-lock. Without it coco refuses every pending P2PK rollback, so a timed lock could be created but never taken back. Guarded by `app/__tests__/cocoCorePatch.test.ts`. | Coco reclaims P2PK sends upstream (PR pending) |
| `@cashu/cashu-ts@5.0.0-rc.4` | Backports NUT-18 `mp` and NUT-26 tag `0x09`, keeping the positional constructor. See [README.cashu-mints-preferred.md](README.cashu-mints-preferred.md). | Coco accepts a cashu-ts release with `mintsPreferred` |
| `@gorhom/bottom-sheet@5.2.14` | Sheet and backdrop default to `accessible={false}` so descendants stay reachable. | Upstream changes the default |
| `expo-router@56.2.11` | Exposes drawer overlay styling in Router's navigation fork. | Upstream exposes it |
| `react-native-screens@4.25.2` | Adjusts Android form-sheet dimming. | Upstream fixes the dimming |
| `heroui-native@1.0.9` | (1) `mountIndex` forwards to gorhom's `index` so sheets open after layout (gorhom #2690, #2719). (2) `useDirectView`/`useScrollableContainer` keep a nested `BottomSheetScrollView` scrollable. (3) Hides the toast measurement clone inline. Guarded by `app/__tests__/herouiNativePatch.test.ts`. | Each hunk: upstream forwards `index`, adopts the container flags, or fixes the clone |
| `expo-modules-jsi@56.0.12` | Replaces `weak let` declarations unsupported by the older Swift toolchain. | Xcode 26.4+ is the minimum |

A successful install doesn't prove a patch landed: inspect the patched files in
the installed version. Never ignore a patch that fails to apply.
