# 0001 — Graceful handling of unresolved routes

- Status: Accepted
- Date: 2026-06-20
- Issue: #212 ("Wallet link resolves to a missing route and throws an error")

## Context

#212 reported that following a link to the Wallet screen navigated to a
missing route and threw. Investigation of `main` found the opposite: the
drawer Wallet item points at `/(drawer)/(tabs)/index`, which is a real,
type-checked route, and an audit of all 100+ navigation call sites found **zero**
targets that resolve to a missing route. The reported crash does not reproduce.

What the app genuinely lacked was the issue's *Expected behavior* clause: "if
the intended route no longer exists, the app should fail gracefully and keep the
user in a usable state." There was no expo-router `+not-found` catch-all and no
error boundary, so a future stale/renamed route would strand the user.

Note: an early hypothesis that the broken link was a custom-scheme deep link
(`sovran://wallet`) was disproved — the source Nostr note merely describes the
repro in prose; no deep-link dispatch is involved.

## Decision

Add an expo-router `+not-found` catch-all (`app/+not-found.tsx` →
`shared/blocks/NotFoundScreen`) that:

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
