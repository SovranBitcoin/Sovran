# iOS Freedom Store release

One command ships a new iOS build to [Freedom Store](https://freedomstore.io)
(the AltStore source):

```bash
bun run release:ios <ADP_ID>
```

`<ADP_ID>` is the **Alternative Distribution Package ID** — a UUID from App Store
Connect → your app → Distribution → Activity → iOS → (a version) → "Alternative
Distribution Package ID":
<https://appstoreconnect.apple.com/apps/6499554529/distribution/activity/ios/versions>

## What it does

Ordered, idempotent phases (each one is safe to re-run):

1. **Preflight** — verifies `gh` auth, ASC credentials, required tools, that both
   sibling repos exist with **clean working trees**, and that the ADP is processed
   and not expired. Fails before changing anything.
2. **Sync fork** — fast-forwards `freedomstore` `main` to `upstream/main`
   (aborts if the fork has diverged).
3. **Download** the ADP into `sovran.money/public/ios/releases/<ADP>/`.
4. **Screenshots** — pulls the version's screenshots from App Store Connect and
   regenerates `src/screenshots.ts`.
5. **Update `altstore-source.json`** by parsing → mutating → serializing (never
   regex), then asserts every version maps to a distinct ADP.
6. **Prune** stale release dirs / screenshots / previews no longer referenced.
7. **Commit + push `sovran.money`** → triggers its deploy.
8. **Deploy gate** — polls the live URLs (content-type aware, so the SPA fallback
   can't fake a 200) until the assets are really served.
9. **Open/refresh the PR** to `freedomstore/freedomstore`. CI passes because the
   URLs are already live.
10. Stops at a green PR. Pass `--merge` to squash-merge to production.

## Flags

| Flag                 | Effect                                                             |
| -------------------- | ------------------------------------------------------------------ |
| `--dry-run`          | Do everything locally; push nothing, open no PR. Prints the diffs. |
| `--no-screenshots`   | Skip App Store Connect screenshot sync.                            |
| `--keep-screenshots` | Reuse existing screenshots (don't pull from ASC).                  |
| `--no-prune`         | Keep stale release/screenshot assets.                              |
| `--merge`            | After CI passes, squash-merge the PR (ships to production).        |
| `--allow-dirty`      | Proceed even if a working tree has unrelated changes.              |

## Setup

- `gh auth login -h github.com` (cross-fork PR rights to `freedomstore/freedomstore`).
- `sovran-app/.env` with `ASC_ISSUER_ID`, `ASC_KEY_ID`, `ASC_PRIVATE_KEY`
  (App Store Connect API key) — only needed for screenshot sync.
- Sibling layout: `sovran-app`, `sovran.money`, `freedomstore` checked out next to
  each other, with `freedomstore` having an `origin` (your fork) and `upstream`
  remote.

## Layout

- `release-ios.mjs` — the orchestrator CLI.
- `release.config.mjs` — all paths, ids, and repo coordinates.
- `lib/` — `adp`, `asc`, `altstore-json`, `screenshots`, `git`, `deploy-gate`,
  `env`. Pure logic is separated from IO so it is unit-testable.
- `lib/__tests__/*.test.mjs` — run with `bun run test:release`.
