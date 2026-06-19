# 0001 — Graceful handling of unresolved routes

- Status: Accepted
- Date: 2026-06-20
- Issue: #212 ("Wallet link resolves to a missing route and throws an error")

## Context

#212 reported that clicking **Wallet** in the drawer ("drop down") menu
navigated to a missing route and threw.

The drawer's Wallet item targeted `/(drawer)/(tabs)/index`. The wallet screen
lives in the `app/(drawer)/(tabs)/index/` folder, and **expo-router collapses an
`index` folder to an empty path segment** — so the wallet's real, mounted route
is the group root `/`, and *no route is mounted at `/(drawer)/(tabs)/index`*.
The typed-routes generator nonetheless emits both `/(drawer)/(tabs)/index` and
the shorthand `/index` as "valid" hrefs, which is why this passed type-check
while failing at runtime: both resolve to `+not-found`. (Verified by resolving
each path against the route tree via `getStateFromPath` — see
`__tests__/walletRouteResolution.test.tsx`.)

Two gaps, fixed together:

1. **The actual bug** — the Wallet link pointed at a path that does not resolve.
2. **Missing graceful degradation** — the issue's *Expected behavior* clause
   ("if the intended route no longer exists, the app should fail gracefully and
   keep the user in a usable state"). There was no expo-router `+not-found`
   catch-all, so the broken link (and any future stale route) stranded the user.

Note: an early hypothesis that the broken link was a custom-scheme deep link
(`sovran://wallet`) was disproved — the source Nostr note merely describes the
repro in prose; no deep-link dispatch is involved.

## Decision

**Fix the link:** point the drawer's Wallet item (and the not-found recovery
button) at `/`, the canonical route that resolves to the wallet via the
`initialRouteName` chain (root → `(drawer)` → `(tabs)` → `index`). `/` is in the
typed `Href` union; the runtime-correct `/(drawer)/(tabs)` is not, so `/` is
preferred over a cast.

**Add the safety net:** an expo-router `+not-found` catch-all (`app/+not-found.tsx`
→ `shared/blocks/NotFoundScreen`) that:

- logs the unresolved path once via the canonical logger (`log.warn('nav.unknown_route', { path })`)
  so a recurring broken link is observable rather than silent; and
- renders a recoverable screen with a single **Go to Wallet** action that calls
  `guardedRouter.replace('/(drawer)/(tabs)/index')` — `replace` (not `push`) so
  the dead route never enters the back stack.

We chose a **recoverable screen** over a silent auto-redirect because the issue
emphasises keeping the user "in a usable state" — an unexplained bounce is more
disorienting than a brief, actionable screen.

This complements, and does not replace, the existing param-level seam: routes
validate their params with `useRouteParams` (Zod → `router.back()`). Unknown
*paths* and invalid *params* are handled by distinct, non-overlapping seams.

We deliberately do **not** add custom URL-scheme dispatch — there is no evidence
it is involved, and adding it would be speculative.

## Consequences

- Any unmatched route now degrades to an actionable screen instead of a dead end.
- Reuses canonical owners only (`guardedRouter`, `log`, shared UI primitives) —
  no new modules, shims, or re-exports.
- If a real broken link is introduced later, `nav.unknown_route` in the logs
  pinpoints the offending path.
