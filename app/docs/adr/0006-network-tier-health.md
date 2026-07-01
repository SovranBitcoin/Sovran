# 6. Live tier-health on the Network settings screen

Date: 2026-06-24
Status: Accepted (observability for the tiered data layer of ADR 0003)

## Context

The Network settings screen (`SettingsNetworkScreen`) configures the three tiers
of the resilient Nostr data layer (ADR 0003): nagg → Primal cache → raw relays.
It carried an enable/disable switch per tier but gave no signal of whether each
source is actually reachable, so a user (or a developer testing fallback) could
not tell a *disabled* tier from a *down* one. The screen had also drifted from
the sibling settings pages — a long intro paragraph and a bespoke `TierToggleCard`
instead of the shared `Section` + `ListGroup` + `Badge` scaffold.

The three tiers expose health very differently:

- **nagg** (we operate it) serves an HTTP `GET /healthz` returning `{ ok: "true",
  … }`.
- **Primal cache** (Primal operates it) has **no** health endpoint — `/healthz`
  returns 404. Its transport is a Nostr WebSocket.
- **raw relays** already have live per-relay connection state from the NDK pool,
  surfaced by `useRelayHealth` (2s poll).

## Decision

Add a composed health layer and render one live `Online / Offline / Checking`
badge per tier, plus a per-tier dim when its toggle is off.

- **Pure probes** in `shared/lib/nostr/tierHealth.ts`:
  - `probeNaggHealth` routes through the canonical `fetchJson` client (timeout,
    URL redaction, zod validation) and reports online iff the body is `{ ok:
    "true" | true }`.
  - `probePrimalHealth` opens the Primal WebSocket, sends a minimal Nostr `REQ`,
    and treats the **first response frame within a timeout** as online — because
    Primal has no `/healthz`, a round-trip is the honest liveness signal. The
    socket is always `CLOSE`d and closed before resolving.
  - `foldRelayStatus` collapses the NDK per-relay map into one tier status.
- **Composed hook** `useNostrTierHealth` exposes a uniform `{ nagg, primal, relay,
  isRefreshing, refresh }`. It reads tier config through the canonical owner
  (`useNostrTierConfig`), probes only while the screen is focused (on focus +
  every 30s), skips disabled tiers, and guards against stale async writes with a
  monotonic run id.
- The screen is rebuilt on the shared settings scaffold and its copy trimmed from
  ~103 words to ~22 (intro paragraph removed; per-tier descriptions one line).
- **Persistence fix**: the three tier toggles were declared in `settingsStore` but
  omitted from `partialize`, so they silently reset to `true` on every launch.
  They are added to `partialize`.

This is observability + presentation only: it reads the existing toggles and the
existing endpoints and never gates the nagg → Primal → relay fallback routing.

## Consequences

- A disabled tier is now visually distinct from an unreachable one, and fallback
  testing (toggle a tier off) is legible.
- Two lightweight network probes run only while the screen is focused, at 30s
  cadence; the relay tier adds no network (in-memory NDK read). Probes stop on
  blur.
- Tier preferences now survive an app restart.
- Probe transports are deliberately separate from the live data-layer connections
  (ADR 0003's facade): the health screen must not interfere with real reads, and a
  per-transport probe keeps each tier's liveness honest.

## Alternatives considered

- **HTTP reachability ping for Primal** (`GET` the host, 200 = up) — rejected; the
  host is fronted by nginx that 200s regardless, so it proves nothing about the
  cache serving Nostr queries. The WebSocket round-trip is the honest signal.
- **Reuse the live data-layer's Primal connection state** — rejected; it couples
  UI health to the facade's internal connections and risks interfering with real
  reads. A self-contained probe keeps the seam clean.
- **Probe disabled tiers too** (so a user previews health before enabling) —
  rejected for battery; a disabled tier is out of the fallback chain, so its
  liveness is moot until re-enabled.
