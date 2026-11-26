# Package patches

Bun applies these at install time; they are registered in the root
`package.json` under `patchedDependencies`. Create or update one with
`bun patch <package>`, edit the prepared files, then `bun patch --commit`, and
inspect the resulting patch and lockfile changes. On every upgrade, check whether
the fix is upstream and whether the import still reaches the patched file.

Only patches the app cannot ship without stay ([ADR 0038](../docs/adr/0038-wave-2-patch-reduction-and-hex-boundaries.md)).
Presentation is styled through public props instead: the drawer keeps its
`sceneStyle` clip and `overlayColor`, and Android form sheets use the stock dim.
The bottom sheets and toasts are the app's own (`shared/ui/composed/Sheet.tsx`,
`shared/ui/composed/ToastHost.tsx`), so they need no patch.

| Patch | Purpose | Remove when |
| --- | --- | --- |
| `@cashu/cashu-ts@5.0.0-rc.4` | Backports NUT-18 `mp` and NUT-26 tag `0x09`, keeping the positional constructor. See [README.cashu-mints-preferred.md](README.cashu-mints-preferred.md). | Coco accepts a cashu-ts release with `mintsPreferred` |
| `expo-modules-jsi@56.0.12` | Replaces `weak let` declarations unsupported by the older Swift toolchain. | Xcode 26.4+ is the minimum |

A successful install doesn't prove a patch landed: inspect the patched files in
the installed version. Never ignore a patch that fails to apply.
