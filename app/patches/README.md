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
| `@cashu/coco-core@0.0.0-nightly-20261120132306-58abfae` | `ops.send.prepare({ offline: true })`: an exact send from stored proofs with no mint request. See [README.coco-offline-send.md](README.coco-offline-send.md). | A published Coco contains [cashubtc/coco#533](https://github.com/cashubtc/coco/pull/533) |
| `expo-modules-jsi@56.0.12` | Replaces `weak let` declarations unsupported by the older Swift toolchain. | Xcode 26.4+ is the minimum |

Library patches are written as upstream changes first. Each one is a commit
against the library's own source, with its tests, kept as one file per future
pull request under `sources/<package>/`; the bun patch is what those commits
compile to. Nothing is added to a bun patch that is not in a source patch.

A successful install doesn't prove a patch landed: inspect the patched files in
the installed version. Never ignore a patch that fails to apply.
