# Sovran Workspace

Checkout that groups the Sovran product repos with local copies of Cashu libraries. Treat **sovran-app** as the default target for edits unless you are told otherwise.

## Product

- **sovran-app** — Expo/React Native wallet: Cashu ecash, Lightning, Nostr identity, NFC, and related UX (includes `colada`).
- **api.sovran.money** — Backend API (Bun, Hono): Cashu, Nostr, Supabase, and eSIM-related routes consumed by the app and admin.
- **sovran.money** — Public marketing site (Vite with SSR/prerender).
- **sovran-admin-panel** — Internal Vite/React dashboard for eSIM catalog, orders, and reconciliation.

## Upstream / libraries

- **cashu-ts** — `@cashu/cashu-ts`: protocol client for Cashu mints.
- **coco** — `@cashu/coco-*` monorepo (sibling checkout): reference for types and behavior. The app does **not** consume this folder directly.
- **coco-cashu-plugin-npc** — Coco plugin bridging NPubCash (NPC) to the wallet.

Use **cashu-ts** and the **coco** checkout as read-only reference unless explicitly asked to change upstream.

**Do NOT edit files inside the `../coco/` or `../cashu-ts/` directories.** These are upstream repos checked out for reference only. If you need to change behavior from these libraries for sovran-app, use patch-package patches in `patches/`.

## Conventions

- **Coco changes for the wallet** — If asked to edit Coco for Sovran, change **`patches/`** (patch-package applies these on install). Do not edit the top-level **`../coco/`** repo unless the task is explicitly upstream work.
- Each top-level folder under `Sovran/` is its **own git repository** — stage and commit from the repo you actually modified (`sovran-app` when you touch patches).

## Push Rules
- You may push freely in sovran-app, sovran-admin-panel, api.sovran.money 
- Never push in minibits_wallet, cashu.me, eNuts, numo, nuts, cashu-ts, coco, or coco-cashu-plugin-npc without asking me first
- Always push to origin, never to other remotes

## Reviewing

Codex will review your output once you are done.

## Audit-fix triggers (mandatory)

When a request matches the audit-fix shape — for example "pick a slice", "ship a (related) cluster (of audit findings)", "pick an audit finding and ship it", "fix audit findings", "improve structural score", or any phrasing that asks you to take open `__audits__/*.json` findings and turn them into a commit — **stop and read `codereview/fix.md` before any other action**, then follow it. That file is the system prompt for `npm run fix`; running the same task without it produces shallow, scope-undisciplined slices.

Non-negotiable from `fix.md`, called out here so they survive even if `fix.md` isn't read end-to-end:

- **Phase 0** — load the Matt Pocock process skills (`zoom-out`, `improve-codebase-architecture`, `diagnose`, `tdd`, `prompt-engineering-patterns`) from `.agents/skills/` before clustering. A required skill missing from disk halts the slice.
- **Phase 1 cross-link** — run `bun run codereview/analyze-structure/index.mjs --llm | sed -n '/^Overall:/,/^# Repo/p'` and `bun run codereview/analyze-structure/index.mjs lookalikes --focus <candidate-file>` before settling on a slice. The Phase 4 plan must cite the structural signal that was folded in (or explicitly say "none" with proof).
- **Phase 1 hunts** — also run the bypass / leak greps (§4.11) and schema-duplication grep (§4.12) every time, regardless of slice.
- **Phase 4 plan** — write the structured brief (Process skills consulted / Domain skills consulted / Cluster / Files modified / Fix approach / Risks / Acceptance gates) before editing.
- **Phase 6 commit** — one commit per slice: the feature commit. Use the §4.6 `update_audit` helper to annotate `completion_status` locally; `__audits__/` is gitignored and untracked, so annotations stay on disk and are not committed.
- **Self-check** — run §8 items 1–13 before the final summary; items 10b (structural cross-link cited) and 13 (process skills loaded) block the slice if missing.

`codereview/audit.md` is the read-only counterpart for producing audits. The same Phase 0 skill load applies.

## Rules

Topical rules live in `__rules__/`. Read the relevant file before writing code that matches the trigger.

- **Implementing a component that varies by platform or by feature support (Liquid Glass, blur, etc.)** — read [`__rules__/capability-variants.md`](./__rules__/capability-variants.md). Tells you when to use `defineVariants`, when inline `useCapabilities()` is enough, when the sync helpers in `shared/lib/version.ts` are correct, and when a `.ios.tsx`/`.android.tsx` split is the right answer.
- **Sizing UI for screens between iPhone SE and iPad Pro** — read [`__rules__/responsive-scaling.md`](./__rules__/responsive-scaling.md). The three pillars (`useWindowDimensions`, `PixelRatio`, flex/`aspectRatio`) and the anti-patterns to avoid (module-scope `Dimensions.get`, hardcoded reference widths, `borderWidth: 0.5`).
- **Adding a cache around a fetch (HTTP, relay, SQLite, decrypt)** — read [`__rules__/caching.md`](./__rules__/caching.md). When a cache is warranted, where it goes (the single fetch wrapper, not the consumer), the standard shape (Zustand persist + Zod envelope + SWR + LRU), and which caches already exist so you don't re-invent them.
- **Formatting a date, time, or relative timestamp for the user** — read [`__rules__/dates.md`](./__rules__/dates.md). Two functions in `shared/lib/date.ts`: `formatDate(input, style)` for absolute timestamps and `formatRelative(input, style)` for "ago"/day-anchored. Locale is resolved automatically (in-app override → iOS/Android device locale → `'en'`). Never call `.toLocale*String()` directly.
- **Adding or rendering an icon (Iconify glyph, brand SVG, or selection checkmark)** — read [`__rules__/icons.md`](./__rules__/icons.md). Default to `<Icon name="prefix:name" />`; for brand glyphs use the `internal:` namespace at `assets/icons/internal/*.svg` (bundled by `scripts/regenerate-icons.js`). For "is this selected?" UI use `SelectableCheck` instead of authoring another custom checkmark.
- **Picking a non-color style value (spacing, radius, opacity, animation duration, z-index, icon size, shadow, hit slop)** — read [`__rules__/design-tokens.md`](./__rules__/design-tokens.md). Pull from `shared/styles/tokens.ts` (`spacing`, `radius`, `alpha`, `duration`, `zIndex`, `iconSize`, `hitSlop`, `shadow`, `minTouchTarget`). Never pick a magic number — snap to the nearest token, or extend the scale deliberately when ≥2 surfaces will share a new value.
- **Picking a color (theme token, semantic register, brand tint)** — read [`__rules__/colors.md`](./__rules__/colors.md). Each ramp is anchored on a known reference (Apple System Green/Blue/Yellow/Purple, Tailwind red, Bitcoin orange) at the `300` step; semantic tokens (`success` / `danger` / `warning`) flip automatically on theme change. Never hardcode hex values; never pull `green-400` for a primary success surface; never re-introduce neon.
- **Adding a loading spinner, success checkmark, or error/failure animation** — read [`__rules__/status-indicators.md`](./__rules__/status-indicators.md). Always reach for `LoadingIndicator` from `shared/blocks/status` — three phases (`idle` / `loading` / `done`), three results (`success` / `error` / `reverted`). It is the single canonical animated status surface and replaces the deleted `PaymentStatusIcon` / `AnimatedCheckpointDot`. Never author a new stroke-dasharray spinner; never reach for `<ActivityIndicator>`.
- **Adding a new screen to any modal flow (`(settings-flow)`, `(receive-flow)`, `(send-flow)`, `(mint-flow)`, `(split-bill-flow)`, etc.)** — read [`__rules__/flow-screens.md`](./__rules__/flow-screens.md). Four-file pattern: screen component under `features/<feature>/screens/`, barrel export, route file at `app/(<flow>)/<name>.tsx`, registration in the flow's `_layout.tsx`. The `<Screen>` wrapper props depend on layout shape: settings-list screens use `scroll="custom" safeArea`, action screens with footer CTAs use `contentPadding={0} footer={bottomButtons}` (do NOT add `safeArea` to those — the footer mode handles it).
- **Choosing between `Pressable` and `Button` for a tappable surface** — read [`__rules__/buttons.md`](./__rules__/buttons.md). Three primitives: project `Button` (`@/shared/ui/primitives/Button`) for hero CTAs in `<BottomButtons>` footers (string `text`, built-in `loading` spinner); heroui `Button` for in-card actions, segmented chips, and dialog buttons (`<Button.Label>`, `variant={selected ? 'primary' : 'secondary'}` for chips); `Pressable` for label-less surfaces (whole rows, cards, custom-shape hit targets). Never build a custom-styled `Pressable` for what is conceptually a button.
- **Building skeletons for content that will be replaced by async-loaded data (especially threaded/list UIs with content-dependent heights)** — read [`__rules__/thread-skeletons.md`](./__rules__/thread-skeletons.md). The pattern is: ambient `SkeletonLoadingShimmer` during loading, a hidden measurement tree to capture real heights, height-match soft sort onto the first 5 visible slots, then `SkeletonExitReveal` (opacity fade + single bright shimmer pass) to mask any residual shift. Skeletons use very low contrast (`opacity(foreground, 0.07)`); the exit shimmer waits for the in-flight loading shimmer via `msUntilLoadingShimmerPassEnds`. Never skip the exit shimmer in a list where heights vary — the shimmer is the visual cover, not decoration.