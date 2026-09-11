# Sovran application system conventions

This is the decision guide for implementing Sovran consistently: which existing owner to use, which defaults to follow, which exceptions matter, and which inconsistencies remain to fix.

**Audit date:** 2026-09-10. **Source baseline:** `83f62a4cadcbc56df5820a5459cb44e4099df991`, plus the working tree on `feat/release-pipeline`. Release files and package/configuration files already had uncommitted changes. Those are observations of work in progress, not verified release behavior.

**Scope:** application convention documentation and repository-local contributor skills. No application behavior, runtime dependency, schema, native project, or release workflow was changed. The review inventoried the repository, searched 1,288 first-party implementation files under `app/app`, `app/features`, `app/shared`, `wallet/src`, and `nostr/src`, and inspected the central implementations and representative callers below. Tests, generated code, vendors, scripts, assets, and configuration were inspected separately where relevant. This is a systematic convention audit, not a claim that every line or every runtime path was verified. No live wallet data, secrets, device sessions, or production services were inspected.

## How to use this document

`SYSTEM.md` is the deliberately chosen name for this implementation guide. The existing [architecture overview](docs/architecture/overview.md) explains the package map; existing [ADRs](app/docs/adr) preserve individual decisions. Keep those purposes separate. The organizing idea is a set of cross-cutting concepts with source examples, as described by [arc42](https://docs.arc42.org/section-8/).

Each numbered decision records **Observed**, **Decision**, and **Follow-up** where there is a gap. “Decision” is the recommended project default selected by this audit. It does not mean the implementation is complete or that a new dependency has been installed. Existing behavior remains authoritative when assessing what the app currently does; the decision states what subsequent changes should converge on.

This file is the single app convention reference, including the useful findings, naming dictionary, cleanup method, and edge cases consolidated from `sovran-deslop`. Reading that skill's Markdown is not required to apply these conventions. The contributor chain is [CLAUDE.md](CLAUDE.md) → [AGENTS.md](AGENTS.md) → this guide → the relevant reviewed skill. Per the project owner's instruction, this repository-local setup supersedes the earlier workspace-only installation rule for `sovran-app`. A standalone checkout has the same guide and skill sources as the checkout-family workspace.

Each section links its useful skills. Read [decision 29](#29-project-skills-and-review-policy) for their reviewed scope and exact overrides before applying generic examples. These skills provide methods and references; they do not replace Sovran's decisions, authorize extra actions, or establish what is implemented. Keep app convention changes here. Existing detector scripts remain tooling, not a second specification.

The deslop material includes historical audits, not a current defect census. Its old counts, filenames, claimed absences, research rankings, and unresolved findings were not carried forward as current facts. For example, branded protocol IDs now exist. Rechecked examples are linked below; remaining historical candidates need current evidence before changes. This consolidation changes documentation only and does not run a cleanup pass or alter tooling/baselines.

For a substantial new exception, record the affected decision, exact owner/files, reason the default cannot work, observable behavior, validation, and removal/review trigger. Stable exceptions belong beside the relevant decision; significant changes get an ADR in the existing directory. Update this guide in the same change as a convention change. A growing number of exceptions is a reason to revisit the shared abstraction.

### Quick decision index

| Work | Default owner / decision |
| --- | --- |
| Place code or reuse a helper | [1. Ownership and structure](#1-ownership-and-structure), [22. Reuse and dependencies](#22-reuse-and-dependencies) |
| Add a route, modal, or deep link | [2. Navigation](#2-navigation-and-route-groups) |
| Add a page, list, footer, or inset | [3. Page layout](#3-page-containers-insets-and-keyboards) |
| Style a component | [4. Styling](#4-styling-tokens-and-themes), [5. Icons](#5-icons-and-status-symbols), [6. Platform variants](#6-ios-android-and-capability-variants) |
| Show loading, missing data, or an error | [7. Loading](#7-loading-empty-error-and-skeleton-states), [8. Errors](#8-error-handling-and-user-feedback) |
| Write UI copy or translate it | [9. Localization](#9-localization-and-text-length-contracts), [10. Dates and amounts](#10-dates-time-numbers-and-money) |
| Build accessible inputs and interactions | [11. Accessibility and forms](#11-accessibility-text-input-and-interaction) |
| Store or validate data | [12. State](#12-react-and-zustand-state), [13. Persistence](#13-zod-persistence-and-migrations) |
| Fetch, cache, cancel, or retry | [14. Caches](#14-cache-ownership-and-freshness), [15. Networking](#15-networking-concurrency-and-cancellation) |
| Read or publish Nostr | [16. Reads](#16-nostr-reads-nagg-primal-and-relays), [17. Writes](#17-nostr-publishing-dms-and-state-machines) |
| Implement a payment | [18. Wallet](#18-cashu-wallet-and-payment-state-machines), [19. Identity](#19-identity-private-data-and-profile-lifecycle) |
| Improve speed, battery, startup | [20. Performance](#20-performance-efficiency-and-background-work), [21. Preloading](#21-startup-preloading-prefetching-and-prerendering) |
| Add media, fonts, patches, vendors | [23. Assets](#23-assets-fonts-and-user-media), [24. Patches and vendors](#24-npm-patches-and-vendored-code) |
| Add/change a page, gesture, modal, or demo fixture | [26. Native testability and Mock Mode](#native-page-testability-contract) |
| Change scripts, configuration, release, or checks | [25. Tooling](#25-package-scripts-configuration-and-release), [26. Verification](#26-logging-testing-and-enforcement) |
| Name a function, file, map, or protocol value | [27. Naming and terminology](#27-naming-terminology-and-display-derivation) |
| Consolidate, delete, or standardize code | [28. Cleanup method](#28-cleanup-method-and-evidence) |
| Use, verify, or refresh contributor skills | [29. Project skills](#29-project-skills-and-review-policy) |
| Choose the next fixes | [Follow-up register](#follow-up-register) |

## 1. Ownership and structure

**Reviewed skills:** [codebase-design](skills/codebase-design/SKILL.md) for ownership and interface design. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** the root [package.json](package.json), [wallet/package.json](wallet/package.json), and [nostr/package.json](nostr/package.json) establish four Bun workspaces. `wallet` and `nostr` are private source packages consumed through `workspace:*`. Older references to separate Colada/nagg-ts repositories describe their history, not the current code location.

```text
sovran-app/
├── AGENTS.md, CLAUDE.md      contributor entrypoint and Claude import
├── SYSTEM.md                 this guide
├── skills/                  vetted sources, licenses, manifest, link/check tool
├── .agents/skills/          Codex discovery links into skills/
├── .claude/skills/          Claude discovery links into the same skills/
├── package.json, bun.lock    workspace install, overrides, patch registrations
├── app/                     Expo application package
│   ├── app/                 routes, route groups, layouts, special Router files
│   ├── features/<domain>/   screens and code owned by one product capability
│   ├── shared/
│   │   ├── ui/primitives/   basic visual building blocks
│   │   ├── ui/composed/     reusable composed controls and page layouts
│   │   ├── blocks/          app-wide product surfaces and gates
│   │   ├── hooks/           reusable React behavior
│   │   ├── lib/             named infrastructure/domain boundaries
│   │   ├── providers/       app services and lifecycle integration
│   │   ├── stores/          global/, profile/, runtime/
│   │   └── styles/          design tokens
│   ├── assets/              bundled fonts, icons, images, patterns
│   ├── config/, navigation/ route presentation and navigation helpers
│   ├── modules/, targets/   local native modules and widget target
│   ├── plugins/             repeatable native configuration changes
│   ├── patches/, vendor/   third-party modifications and imported artifacts
│   ├── scripts/, codereview/ developer tools and checks
│   └── __tests__/, e2e/, docs/ tests, JSON scenarios, ADRs
├── wallet/src/              payment machine, operations, copy, React bindings
├── nostr/src/               transport, tier strategies, facade, entity cache
├── docs/                    VitePress product/developer documentation
└── release/                 release tooling under development in this snapshot
```

**Decision:** place code with the owner of its meaning, not merely its TypeScript shape.

| Concern | Owner |
| --- | --- |
| Product screens, navigation, device I/O, active-profile integration | `app/` |
| Payment intent, sequencing, reusable payment operations/actions, payment copy contracts | `wallet/` (the Colada engine) |
| Nostr transport/parsing, reusable tier behavior, normalized entity cache | `nostr/` (the former nagg-ts client) |
| Mint proof operations and wallet database authority | installed Coco packages, integrated by app providers and wallet operations |
| Cashu protocol primitives | installed Cashu SDK, behind wallet/adapter boundaries |
| Server indexing, app-view endpoints, ranking execution | Nagg backend, outside this repository |
| Shared externally published wire contracts | `@sovranbitcoin/schemas` |

The intended import direction is `app → wallet → nostr`, with `app → nostr` also permitted. `wallet` and `nostr` must not import `app`, Expo navigation, or app stores. `wallet/react` is an intentional optional React integration, not permission for native UI in the core.

Keep one-screen helpers private or feature-local. Promote code to `shared` when independent consumers need the same behavior and lifecycle. Use descriptive modules such as `date`, `http/requestSignal`, and `cache`; do not create an undifferentiated `utils.ts` dumping ground. Within a feature, use existing `screens`, `components`, `hooks`, `data`, `lib`, or `stores` folders only when they help navigation; do not scaffold empty layers.

New app imports use `@/…`; within a small module, relative imports are fine. Package consumers use declared exports such as `wallet/react` or `wallet/safeFetch`, not `../../wallet/src/...`. Keep public barrels intentional and small. A public boundary can justify an index; pass-through re-export chains do not.

**Follow-up:** older skill text mentions a top-level `stores/`, `mintInfoCache`, `coco-cashu-core`, and patch-package; the current owners differ. Some app imports also use `assets/icons` while others use `@/assets/icons`. Normalize when touching callers, without unrelated moves.

## 2. Navigation and route groups

**Reviewed skills:** [expo-router](skills/expo-router/SKILL.md) for route mechanics. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [app/app](app/app) holds routes, while feature screens live outside it. [flowLayoutOptions](app/config/flowLayoutOptions.tsx), [modalScreens](app/config/modalScreens.ts), [headerItems](app/navigation/headerItems.tsx), and [routeSchemas](app/shared/lib/nav/routeSchemas.ts) centralize important behavior.

**Decision:** route files validate/interpret params, select the feature screen, and configure navigation. Domain I/O and payment sequencing belong below them. `(group)` names select layout/navigation scope without becoming URL segments; `_layout.tsx` owns a navigator/provider scope. `[param]` introduces a dynamic segment. Special `+` files retain their Router-defined role. Helpers, fixtures, tests, and assets stay outside the route directory. These distinctions follow [Expo Router notation](https://docs.expo.dev/router/basics/notation/).

Choose a route group by presentation and lifecycle, not just by feature name. A profile opened from a card flow and one opened as a modal can legitimately share a feature screen while inheriting different headers/insets. Preserve necessary public deep-link aliases. Do not retain internal aliases solely to avoid updating callers.

Use the existing flow stack builders and `useScreenOptions` for dynamic headers. iOS custom glass header items use `withGlassHeaderItems`; clearing one uses its existing helper. Android sheet framing remains with `AndroidSheetFlowStack`. SDK 56 navigation imports use Expo Router's entry points/fork as recorded in [ADR 0007](app/docs/adr/0007-expo-sdk-56-upgrade.md), rather than adding another React Navigation installation.

Route params are untrusted, serializable identifiers or small navigation context. Parse them at the boundary; do not put secrets, mutable manager objects, or large data blobs in URLs. Re-entry must work without the previous screen's local state. For an entity already in cache, pass its identity and seed the screen from that cache.

If a route has platform-suffixed files, keep a non-platform route entry, as required by [Expo's platform-extension rules](https://docs.expo.dev/router/advanced/platform-specific-modules/). Put most native differences in the component implementation instead.

## 3. Page containers, insets, and keyboards

**Reviewed skills:** [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for native layout review; [expo-router](skills/expo-router/SKILL.md) for native navigation containers. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [Screen](app/shared/ui/composed/Screen.tsx), [useScreenInsets](app/shared/hooks/useScreenInsets.tsx), [List](app/shared/ui/composed/List.tsx), and [ScreenScrollView](app/shared/ui/composed/ScreenScrollView.tsx) already implement a shared geometry contract. The [page-layout audit](docs/architecture/page-layout-audit-2026-09-09.md) maps route-specific owners.

**Decision:** one owner consumes each header, safe-area, tab, footer, and keyboard inset.

| Page | Implement with |
| --- | --- |
| Ordinary scrolling page | `Screen` with default scrolling |
| Page with animated scroll position | `Screen scroll="animated"` |
| Fixed action footer | `Screen footer={<BottomButtons>…</BottomButtons>}` |
| Virtualized full-page list | `Screen scroll="custom"` containing `List screen` |
| Custom full-page scroller | `Screen scroll="custom"` containing `ScreenScrollView` |
| Fixed/manual safe frame | Existing `Screen scroll="custom" safeArea` contract |
| Horizontal/nested strip | Plain nested scroll/list; no `screen` flag |
| Camera, map, chat, anchored thread, pager | Explicit viewport owner; consume shared geometry where appropriate |

Native iOS tabs contribute to the local safe area. Docked JS tabs already shorten the viewport. A root modal is outside the tab provider even when opened from a tab. Read `useScreenInsets()` in the actual page; never add a guessed tab height.

`List screen` and `ScreenScrollView` use manual bottom adjustment. Ordinary `Screen` scrolling uses its existing automatic-inset path. Do not combine automatic bottom adjustment with manual safe-bottom padding. `bottomSpacing` is a design gap, not a substitute for navigation height.

`Screen` measures its footer and publishes clearance to descendants. Consume that context **inside** the Screen subtree. Do not reserve a guessed 120/250-point footer or add safe area again after measuring it. Loading, empty, error, and populated states share the same owner.

Floating controls use the page's remaining bottom inset plus a design gap; reserve their measured height and spacing in the scrollable content. Chat/composer surfaces own measured composer height and keyboard lift. `dockedTabBarHeight` is only for translating window/keyboard coordinates into the shortened viewport.

**Acceptance:** last row visible and tappable, long footer text, footer appearing/disappearing, keyboard shown/hidden, rotation, native/fallback iOS tabs, Android gesture/three-button navigation, and large text. [screenInsets tests](app/__tests__/screenInsets.test.tsx) and [screenLayout tests](app/__tests__/screenLayout.test.tsx) check the contract; they do not prove native layout correctness.

## 4. Styling, tokens, and themes

**Reviewed skills:** [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for Uniwind/token consistency. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [global.css](app/global.css) uses Tailwind 4/Uniwind and HeroUI styles. [tokens](app/shared/styles/tokens.ts), [themeEngine](app/shared/lib/themeEngine.ts), [ThemeProvider](app/shared/providers/ThemeProvider.tsx), and [classNames](app/shared/lib/classNames.ts) are the shared owners. [styling-budget.json](app/styling-budget.json) records existing non-class usage.

**Decision:** use `className` for ordinary static layout and semantic colors. Use `cn` for string/conditional class merging. Keep complete class names discoverable at build time; map variants to complete strings instead of constructing names like `bg-${color}`. Wrap third-party controls with `withUniwind` at the existing import seam when needed, as `List` does.

Use the existing token scale for spacing, radius, opacity, duration, layers, icon size, typography, and touch targets. Match exact spacing; do not approximate a current layout while converting syntax. Use semantic theme colors instead of screen-local palettes. Brand colors and art-directed gradients are explicit exceptions with existing owners.

JavaScript styles remain appropriate for measured geometry, Reanimated worklets, Skia, native module props, SwiftUI modifiers, SVG paint, and navigator options. Use `useThemeColor` or class resolution at that boundary. These are narrow implementation needs, not a parallel styling policy.

**ListRow runtime inset exception (2026-09-11):** an independently tappable trailing
control is a sibling of the main pressable so iOS accessibility exposes both
controls. Its trailing inset follows the existing numeric `paddingHorizontal`
API; retain that one runtime `paddingRight` style. The styling budget adds only
this dynamic site, while fixed flex/alignment use classes. Remove the exception
if the inset API becomes a finite set of class variants. Revalidate the mint
row and its info button on both platforms when changing this layout.

Theme selection is profile-scoped; wallpaper assignment is unit-scoped. Follow [themeStore](app/shared/stores/profile/themeStore.ts) and the theme provider's hydration/transition ordering. Do not add a second “selected theme” state in a screen or mutate CSS registers independently.

**Follow-up:** the baseline search found 134 `StyleSheet.create` matches in 132 first-party files and 674 literal `style={{` matches in 162 files. These are textual search counts, including possible comments and legitimate boundaries, not defect totals. Migrate touched static sites through the existing styling ratchet; review dynamic sites individually. Do not regenerate the budget merely to permit new debt.

## 5. Icons and status symbols

**Reviewed skills:** [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for icon and accessibility consistency. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [assets/icons/index.tsx](app/assets/icons/index.tsx) renders the committed [generated registry](app/assets/icons/generated.json) with `SvgXml`. [regenerate-icons.js](app/scripts/regenerate-icons.js) combines the explicit icon list and local `internal` SVGs. There is also an [IconSymbol](app/shared/ui/primitives/icon-symbol.tsx) native-symbol wrapper.

**Decision:** ordinary app glyphs use the default `Icon` from `@/assets/icons`. Reuse an existing semantic glyph before adding another icon family. Add external names to the registry and run `node scripts/regenerate-icons.js` from `app/`; add custom monochrome brand SVGs under `app/assets/icons/internal/` using `currentColor`. Commit source and generated output together. No runtime icon downloads or new icon library for one glyph.

Native navigator symbol APIs are a valid platform seam; they do not make SF Symbols the default for cross-platform feature content. Multicolor/gradient art may remain a dedicated SVG component. Selection uses [SelectableCheck](app/shared/ui/primitives/SelectableCheck); loading uses [Spinner](app/shared/ui/primitives/Spinner.tsx) or the existing status surface, rather than custom checkmarks and spin loops.

**Acceptance:** generation fails without replacing the registry when a requested icon is missing, names resolve, sizing/color work in both themes, and platform fallback renders. Existing [generation](app/__tests__/iconGeneration.test.ts), [registry](app/__tests__/iconRegistry.test.ts), and [rendering](app/__tests__/iconRendering.test.tsx) tests are the starting points.

## 6. iOS, Android, and capability variants

**Reviewed skills:** [expo-router](skills/expo-router/SKILL.md) for platform navigation; [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for supported native variants. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [capability](app/shared/ui/capability) contains the reactive provider and dispatcher; [version](app/shared/lib/version.ts) provides synchronous checks. Capsule/circle buttons have capability implementations and platform entry points. Current [app.json](app/app.json) requests iOS 16.4 and Android API 26 minimums. These are configured minimums, not a claim of device coverage.

**Decision:** distinguish **capability** from **platform**.

| Difference | Mechanism |
| --- | --- |
| One React branch on glass/blur capability | Reactive capability hook under `CapabilityProvider` |
| Multiple visual implementations by capability | `defineVariants`, shared props, flat fallback |
| Different native primitive or import graph | `.ios` / `.android` entry points, common contract |
| Pure design option | Ordinary variant prop or switch |
| Outside React rendering | Existing synchronous capability helpers |

“Older iOS” means the supported non-glass fallback, not an additional ad hoc OS branch in every screen. Keep unsupported native imports off Android's reachable import graph. A runtime `if` around JSX does not by itself prevent a top-level import from loading.

Glass is decorative when a Pressable owns interaction; avoid competing native/JS touch owners. Capability simulation must rerender React consumers; boot-captured native navigation choices can explicitly require relaunch. Do not introduce fallback shims for unreleased branch-only APIs. Preserve documented compatibility for supported devices and shipped persisted/wire contracts.

**Acceptance:** both platform type checks plus iOS glass, iOS non-glass, Android, reduced motion, and screen-reader operation. Capability mocks supplement real devices; they cannot prove native linking or OS behavior.

## 7. Loading, empty, error, and skeleton states

**Reviewed skills:** [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for state coverage; [sovran-app-copy](skills/sovran-app-copy/SKILL.md) for state messaging. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [ScreenStates](app/shared/ui/composed/ScreenStates.tsx), [EmptyState](app/shared/ui/composed/EmptyState.tsx), [Skeleton](app/shared/ui/primitives/Skeleton.tsx), [Text](app/shared/ui/primitives/Text.tsx), and [SkeletonContentCrossfade](app/shared/ui/composed/SkeletonContentCrossfade.tsx) provide reusable pieces.

**Decision:** every asynchronous surface must distinguish these states:

| Situation | UI contract |
| --- | --- |
| First request, no usable data | Layout-matched skeleton or meaningful progress state |
| Existing data being refreshed | Keep data visible; show a modest refresh indication |
| Confirmed successful result with no items | Empty state with an appropriate next action |
| Failed initial request | Curated error with recovery action |
| Failed refresh/enrichment | Keep usable content; show degraded status where useful |
| Cancelled/superseded work | Stop its loading state; do not overwrite a newer request |
| Payment outcome unknown | Pending/unknown transaction status, not a generic empty state |

Skeletons preserve the eventual row's padding, text metrics, media aspect ratio, and inset owner. Reuse the real row shell where practical. `Text loading/placeholder/fallback` supports stable geometry; placeholder wording must not become misleading accessible content. Readiness is based on usable data, not completion of every optional profile/image request.

Do not blank a cached list on focus, impose arbitrary minimum skeleton delays, mount multiple full lists to crossfade, or pulse forever after a failed request. Stop visual animation when inactive; honor reduced motion. The static Android E2E skeleton is an intentional automation exception, not evidence that production pulse behavior was tested.

**Follow-up:** [facadeFeedClient](app/features/feed/data/facadeFeedClient.ts) maps several exhausted-tier failures to empty results. This clears loading, but loses the distinction between an empty result and unavailable data. Evolve the adapter result contract and UI together; do not simply restore a throw that leaves seeded thread screens loading indefinitely.

## 8. Error handling and user feedback

**Reviewed skills:** [sovran-app-copy](skills/sovran-app-copy/SKILL.md) for source-aware wording; [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) for original failure investigation. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [shared/lib/errors](app/shared/lib/errors/README.md) is the central upstream-error presentation boundary. `describeError(error, service)` returns a stable `{ id, text }`; [popup](app/shared/lib/popup) accepts a `failure` object. This currently maps to English copy, not multilingual translations.

**Decision:** preserve structured errors until the presentation boundary. New fallible application/service APIs use the established `neverthrow` result style when defining a new contract. Adapt exception-based SDKs at their boundary and preserve `cause`, status, code, and service. Do not rewrite established promise/throw APIs wholesale merely for syntax consistency. Unexpected render failures need a scoped error boundary; it does not replace async error handling.

```ts
// Existing API. Choose service from the operation being performed.
staticPopup('send-message-failed', {
  failure: { service: 'routstr', error },
});

// Existing API for inline presentation.
const { id, text } = describeError(error, 'nagg');
```

| Failure | Owner and presentation |
| --- | --- |
| Invalid user input | Feature/domain validation; translated field-level message |
| SDK, mint, relay, Nagg, or Routstr failure | `ServiceFailure` / shared source-aware catalog |
| Known payment progress/outcome | Wallet machine and operation state; domain copy |
| Screen cannot render | Scoped render boundary with safe fallback and redacted diagnostic |
| Cancellation caused by navigation | Lifecycle handling; normally no alarming popup |

Only interpret Cashu numeric codes in a Cashu operation. Neither a bare code nor English prose identifies CDK versus Nutshell. Unknown values and mixed failures get a curated generic message. Do not expose raw server details, Zod issue dumps, stack traces, token-bearing URLs, or arbitrary `error.message` in UI.

Display IDs/text must never decide retry, balance, refund, proof state, or payment recovery. A timeout does not establish that money moved or did not move. Logs retain sanitized diagnostic structure; user copy can change independently.

Use a toast for brief nonblocking feedback, inline state for a recoverable local problem, and a sheet/dialog when the user must choose or read a substantive explanation. One operation should not generate repeated alerts from every layer.

**Follow-up:** [ClaimUsernameScreen](app/features/onboarding/screens/ClaimUsernameScreen.tsx#L348) and [SettingsScreen](app/features/settings/screens/SettingsScreen.tsx#L236) still place raw exception messages in native alerts. [Colada provider](app/features/send/providers/Colada.tsx#L571) has a string-only deep-link failure popup. Trace each source and route it through the appropriate catalog; do not classify every `.message` access as a UI leak, since many are diagnostics.

## 9. Localization and text-length contracts

**Reviewed skills:** [sovran-app-copy](skills/sovran-app-copy/SKILL.md) for translation and truncation contracts. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** the app has no installed app-wide i18n runtime in [app/package.json](app/package.json). `Text`/`UntranslatedText` are presentation primitives, not translation engines. English literals exist in shared controls and features. Errors have stable IDs. [wallet copy](wallet/src/copy/resolve.ts) has its own keyed templates and English default catalog; [wallet reason formatting](wallet/src/formatting/locales.ts) separately contains English, Arabic, and German dictionaries. This is partial infrastructure, not full multilingual app support.

**Decision — new implementation required:** adopt one app locale authority and **Lingui with build-time compiled ICU catalogs**. Use explicit semantic IDs, `@lingui/core` and `@lingui/react` for rendering, and extraction/compilation as development tooling. Compile catalog artifacts before Metro bundling rather than adding an on-the-fly PO transformer initially. Lingui documents React Native support, React locale subscriptions, and imperative translation for native dialogs in its [React Native guide](https://lingui.dev/tutorials/react-native); ICU handles grammatical plurals/selects rather than English-only interpolation rules ([message format](https://lingui.dev/guides/message-format)).

This dependency is justified by plural grammar, extraction, missing-message validation, and consistent React updates. A homemade dictionary/regex engine would make us maintain those behaviors. Do not introduce a second runtime for wallet strings. Keep the wallet core independent of React/i18n packages: integrate through its copy resolver/locale seams, extending that contract in `wallet` where necessary. Exact package versions, Babel integration, and required `Intl` APIs must be verified on the installed Expo/Hermes stack during implementation. Do not blindly install polyfills based on an older tutorial.

Use `expo-localization` as the native locale/preference adapter when implementing this feature; it is also not currently installed. Recheck device preferences on Android foreground as described by [Expo localization](https://docs.expo.dev/guides/localization/). Bundle supported catalogs for offline use. A missing language must not block opening the wallet or reading an error.

### Locale and message ownership

- Store an explicit language mode: `system` or a supported BCP-47 tag. Migrate the current `language: 'en'` carefully: current date code treats it as system default, while wallet copy treats it as English. Do not pretend existing data tells us which meaning the user intended. Preserve the current system-date behavior for legacy defaults and document that migration choice.
- Resolve app language from explicit choice, then supported device language, then English. Preserve regional number/date preferences through the same locale service. Keep currency/unit selection separate from language. Locale changes update headers, popups, dates, and wallet presentation, not just visible text children. Account-independent language remains a global preference.
- Author messages by domain, extract them into a centrally managed locale catalog, and expose a typed message-ID contract. Proposed locations: `app/shared/lib/i18n/` for integration and `app/locales/` for catalogs and layout metadata. These directories are not implemented by this document.
- Use IDs such as `errors.cashu.timeout.short`, `errors.cashu.timeout.full`, and `settings.network.title`. IDs name meaning, not English wording or file paths. Share a message only when meaning, context, and grammatical use match. “Open” as a verb and “open” as a status need not share a key.
- Translate complete sentences with named, typed parameters. Use ICU plurals/selects and translator comments. Do not concatenate sentence fragments or substitute English `s` endings.
- Translate service-error IDs, not upstream prose. Preserve curated safety meaning across languages. Keep user posts, DMs, display names, invoices, protocol identifiers, mint URLs, and model names literal. User-content translation, if added, is a separate opt-in feature with attribution and privacy rules.
- Keep logs, test IDs, protocol values, and machine discriminants language-independent. Never persist rendered translations as authoritative state. Native permission text and store metadata have separate build-time localization surfaces and must be included in the catalog workflow.

### Text has a layout contract, not just a string key

For each constrained message, record its surface, parameter bounds, preferred line count, overflow behavior, and optional editorial grapheme budget. Include screenshots/context for translators. A character budget is an early warning, not proof of fit: translated lengths, glyph widths, and font metrics vary ([W3C text expansion guidance](https://www.w3.org/International/articles/article-text-size.en)).

| Surface | Selected default | If it does not fit |
| --- | --- | --- |
| Tab label / compact header action | Short label, normally one line | Approved short variant; move secondary wording to the destination or menu |
| Primary action | Short verb phrase; one line preferred | Allow control/layout growth or a stacked action layout; no reduced tap target |
| Header title | Short title; one line preferred | Short variant plus full screen heading if necessary |
| Toast | Short summary, target two lines | Open an accessible full explanation; do not cut recovery instructions |
| Error/recovery/permission explanation | Full message, wrapping and scrolling | Grow/reflow the surface; never silently truncate critical meaning |
| Name/post/list preview | Ellipsis is allowed where clearly a preview | Full value remains reachable and copy/share uses the original |
| Amount, destination, fee, payment status | Exact and unambiguous | Reflow or show a full detail surface; do not shorten away a unit or significant digit |

Provide deliberately authored `.short` and `.full` variants where needed. Do not generate the short version with `slice`, remove words algorithmically, disable font scaling, or switch the UI to English merely because a translation is long. For example, a proposed compact timeout message can say “Payment status unknown”; the full version explains where to check before another payment. Both convey uncertainty.

Keep the full accessible name/description available even when a visual label is abbreviated. Avoid duplicate announcements of nested translated text. Use logical start/end spacing for RTL, isolate literal LTR identifiers where necessary, and mirror directional affordances without mirroring brand marks or QR codes.

**Acceptance for the implementation:** extraction and catalog completeness, typed parameter parity, valid ICU, no unresolved IDs, supported-locale fallbacks, plural edge cases, explicit/system language migration, cold offline launch, English plus a long-text pseudolocale, Arabic/RTL and CJK samples, smallest supported layouts, iPad, and largest supported accessibility text sizes. Measure rendered lines/overflow on native surfaces. Do not claim this validation already exists.

### Truncation, abbreviation, and overflow

**Observed:** [strings.ts](app/shared/lib/strings.ts) exposes `truncateMiddle(str, n)`, keeping `n` UTF-16 code units at each end. It inserts three periods despite its comment showing an ellipsis glyph, does not count that marker in its threshold, and can make a just-over-threshold string longer. Callers choose different values. [DetectedActionRow](app/features/send/components/DetectedActionRow.tsx) has a separate asymmetric helper; many text surfaces rely on `numberOfLines`. [CopyableValue](app/shared/ui/composed/CopyableValue.tsx) already separates the full `value` from its optional `display`, but does not itself implement the complete layout/accessibility policy below.

**Decision:** choose shortening by content meaning and surface, never a global character limit. First remove redundant copy or allow layout to grow; then choose an approved short translation or deliberate preview. Truncation is presentation only. Keep the full original for copy, QR, signing, submission, navigation, identity comparison, and storage.

| Content / surface | Default overflow behavior | Full-value access / exception |
| --- | --- | --- |
| Names, row titles, ordinary compact labels | Single-line tail/end ellipsis when the row is intentionally fixed; allow wrapping in detail views | Full name in accessible presentation/detail; do not manually slice natural-language text |
| Navigation title | Native title behavior; short semantic title if needed | Put essential full context in the screen; do not make the header the only place to verify a recipient |
| Body copy, instructions, validation, payment/recovery warnings | Wrap and grow; scroll the enclosing screen if needed | Never silently cut the consequence, cause, amount, or recovery action |
| Button/tab/segment labels | Approved translated short variant, then responsive layout | Do not ellipsize the action into ambiguity or disable font scaling to fit it |
| Public keys, event IDs, transaction hashes, addresses in compact summaries | Middle abbreviation preserving identifying start and end | Full selectable/detail view; copy the original; abbreviation alone is not recipient verification |
| Filesystem paths / breadcrumbs | Leading/head abbreviation only when the terminal filename is the task's useful identity | Keep relevant parent scope elsewhere and expose full path; otherwise abbreviate interior segments |
| Filenames | Middle abbreviation of the basename, retaining the extension | Full name in details; do not hide which file type will open |
| Mint/relay URLs or security-sensitive origins | Parse and display the meaningful host/origin; wrap it before shortening a path/query | Never crop a host so a different domain looks trusted; full endpoint on inspection; redact credentials separately |
| Email / Lightning address | Keep the domain visible; abbreviate an overlong local part in the middle if required | Preserve full address in detail/copy; do not shorten the authority with generic tail ellipsis |
| Notes, DM previews, descriptions | Deliberate two/three-line tail preview chosen by the component | Open/expand to the full content; do not truncate the stored message or pretend the preview is complete |
| Invoices, ecash, payment-request payloads | Prefer a semantic label/summary with reveal/copy/QR, or a middle-abbreviated encoded value where useful | Never treat a partial bearer payload as safe to log or expose; reveal/AX follows its privacy policy |
| Amounts, units, fees, totals, balances being confirmed | Show the complete authoritative value and unit; adapt layout | Compact `1.2k` style is only for explicitly approximate social metrics, never spend authorization |
| Editable input | Preserve the complete draft; use native input scrolling/wrapping | Input/protocol length validation is separate from visual truncation; do not mutate text while typing just to fit |

**Layout versus length:** `numberOfLines` with `ellipsizeMode="tail"` is the normal native width-aware preview. Use head/middle native ellipsis only on a tested single-line surface. React Native documents that Android multiline truncation works correctly only with `tail` ([Text documentation](https://reactnative.dev/docs/text#ellipsizemode)). Constrain the text lane and allow it to shrink while preserving adjacent icons/actions; adding `numberOfLines` to an unconstrained row is not sufficient. Avoid truncating twice, such as a manually abbreviated ID inside another tail-clamped text node.

For deterministic encoded-ID display, converge on named profiles in the existing string owner: **compact** keeps 8 characters at each end, **detail** keeps 12 at each end, with one `…` marker. Those are 17/25 displayed characters for long ASCII IDs, including the marker. Keep a value intact if it already fits or abbreviation would not shorten it. Preserve format/network prefixes; a distinct content format can justify an explicit asymmetric profile. These are chosen defaults for future consolidation, not changes to the current helper or proof that a value fits every font/window. Do not reuse these numeric budgets for translated names or prose.

An explicit total-length API must name its unit and include the ellipsis in the budget. For user-authored text, truncate at grapheme boundaries, preserving emoji sequences and combining marks; `.slice`, UTF-16 length, and code-point iteration are not equivalent to visible characters. Verify `Intl.Segmenter` on supported Hermes/OS targets before using it; native line truncation avoids adding a segmentation dependency for ordinary labels. Protocol limits may count bytes or code points instead; validate the specified representation and never confuse that limit with visual fit.

Use the single ellipsis glyph for app-authored abbreviation. Preserve unmodified user/protocol content. Do not strip bidi controls or normalize arbitrary signed content as a rendering shortcut; apply appropriate presentation isolation and test mixed RTL/LTR text. Head/tail mean logical content order, not a hard-coded left/right crop.

Accessible names must communicate the useful full label or a clear “view/copy full value” action where reading a long encoded payload would be unusable. Do not put masked secrets or private message content into accessibility labels that bypass the visible privacy state. Copy controls use the full underlying value and announce a localized confirmation. Hover-only tooltips do not provide full-value access on mobile.

**Acceptance for consolidation:** exact-budget and just-over-budget values, empty/short strings, asymmetric format prefixes, emoji/combining sequences, RTL mixed with IDs, longest localized labels, largest supported text sizes, and minimum window widths. Verify Android single/multiline behavior and supported iOS variants, and confirm that copied/signed/QR content remains byte-identical to the original. Record surface exceptions beside their owner. The current helper, duplicate implementation, and callers remain follow-up work.

## 10. Dates, time, numbers, and money

**Reviewed skills:** [sovran-app-copy](skills/sovran-app-copy/SKILL.md) for locale-aware display; [sovran-zod](skills/sovran-zod/SKILL.md) for input representation checks. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [date.ts](app/shared/lib/date.ts) owns `formatDate`, `formatRelative`, and `formatRelativeUnixSeconds`. [displayValue](app/shared/lib/format/displayValue.ts), [cashu/amount](app/shared/lib/cashu/amount.ts), and [wallet formatting](wallet/src/formatting) contain distinct presentation/conversion responsibilities.

**Decision:** app date displays use the existing named styles:

| Function | Current style vocabulary |
| --- | --- |
| `formatDate` | `time`, `short-date`, `long-date`, `short-date-time`, `iso` |
| `formatRelative` | `verbose`, `compact`, `chat-bubble`, `conversation-list` |
| `formatRelativeUnixSeconds` | Adapter for Nostr-style seconds into compact relative display |

Use epoch milliseconds for app clock arithmetic and cache metadata; Nostr `created_at` uses seconds. Name boundary variables `...Ms`/`...Seconds` and convert once. Use a monotonic clock for elapsed-performance measurements and an absolute clock for timestamps/expiry. Store raw time, not localized labels. For actual ISO/RFC3339 serialization use an explicit UTC serialization path, not a UI date style.

**Confirmed gaps:** the current `iso` style is an en-US numeric display with seconds, **not ISO 8601**, and does not explicitly fix a timezone. `chat-bubble` labels “Yesterday” using elapsed 24/48-hour windows, whereas `conversation-list` compares calendar dates. Compact/relative strings contain English literals; the locale resolver reads settings imperatively and treats `'en'` as system preference. Converge on the locale service in decision 9, local-calendar yesterday semantics, and a clearly named debug display distinct from serialization. Test midnight, daylight-saving changes, future/invalid timestamps, and locale switching before changing consumers.

Use existing amount/unit formatting for display; do not scatter `toFixed`, currency symbols, or locale-default number formatting through rows. Keep mint/unit identity with each monetary value. Protocol amounts use the SDK's exact representation; do not introduce floating-point BTC conversions into payment decisions. Parsing must reject invalid, negative, fractional where forbidden, and out-of-range values at the domain boundary. Display rounding must never silently change the amount executed.

**Follow-up:** `amountToNumber` currently warns but returns unsafe bigint conversions, maps unparseable strings to zero, and `toSafeSatAmount` truncates fractions. Those helpers are not strict payment validators. Audit their callers before tightening them and keep display fallback separate from authorization to transact.

## 11. Accessibility, text input, and interaction

**Reviewed skills:** [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for native accessibility; [sovran-app-copy](skills/sovran-app-copy/SKILL.md) for labels and recovery. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** shared [Text](app/shared/ui/primitives/Text.tsx), [Button](app/shared/ui/primitives/Button.tsx), [ButtonHandler](app/shared/ui/composed/ButtonHandler.tsx), and [ScreenStates](app/shared/ui/composed/ScreenStates.tsx) provide common behavior, but do not establish full accessibility coverage.

**Decision:** reuse shared controls for typography, press feedback, loading/disabled behavior, touch target, and accessible state. App text normally uses Oxygen; existing Overpass amount typography remains intentional. Keep platform/system fallback fonts for scripts the bundled fonts do not cover. Avoid assigning font families in individual screens.

Give icon-only actions an accessible name. Expose busy/disabled/selected/expanded state, meaningful errors, and sensible focus after a sheet opens/closes. Decorative skeletons, duplicate crossfade content, and hidden layout text should not become extra screen-reader content. Platform accessibility behavior differs, so verify VoiceOver and TalkBack rather than assuming one prop has identical effects ([React Native accessibility](https://reactnative.dev/docs/accessibility)).

Keep user-editable form drafts local unless they must survive navigation. Validate with the owning schema/parser at submit, and add field-level feedback after interaction where helpful. A decimal keyboard is an input aid, not validation. Keep the raw draft string separate from the validated amount; locale separators and intermediate values must not be coerced into a spend.

Use one submit owner and the machine's busy/availability contract to prevent double submission. Do not rely only on debounce. Keep focus, selection, return-key behavior, paste, autofill, and keyboard dismissal deliberate. Clipboard, camera, NFC, photo, location, and signer permissions are requested in context and include denied/unavailable states. Do not request unrelated permissions at boot.

**Follow-up:** define shared localized field-error and constrained-text APIs during localization work. Add focused screen-reader/large-text cases to the existing design-system scenarios; no new form library is justified solely to standardize labels.

## 12. React and Zustand state

**Reviewed skills:** [sovran-zustand](skills/sovran-zustand/SKILL.md) for store and selector changes. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** shared stores are grouped under [global](app/shared/stores/global), [profile](app/shared/stores/profile), and [runtime](app/shared/stores/runtime). Feature-specific stores also exist. Some files in `global`, such as metadata cache infrastructure, still use profile-scoped persistence; directory names alone do not prove scope.

**Decision:** choose state by authority and lifetime:

| Data | Default |
| --- | --- |
| One component's interaction/draft | React local state |
| Computable UI value | Derive from source state; do not persist a duplicate |
| Cross-screen app preferences | Global Zustand store |
| Identity-owned history/preferences/cache | Profile-scoped store or the existing domain database |
| Temporary popup/progress/navigation context | Runtime store, cleared at its lifecycle boundary |
| Proofs, quote/operation truth, balances | Coco/database and wallet subscriptions, not a parallel screen store |
| Nostr entities | Facade entity cache; screen-specific ordering may be a query result |
| Multi-step asynchronous workflow | Owning domain machine/session, not independent booleans in several screens |

Subscribe to the smallest state needed: `useSettingsStore(s => s.language)`. For a selector returning several values, use stable output or Zustand's `useShallow` when shallow equality is the intended contract. Do not create new array/object/function fallbacks on every store snapshot. Zustand 5 explicitly tightens selector stability expectations ([migration guide](https://zustand.docs.pmnd.rs/reference/migrations/migrating-to-v5)).

Use immutable updates and preserve unchanged references. Store actions own state transitions; components do not mutate store collections in place. `getState()` is appropriate in event handlers/service callbacks, not as a substitute for a reactive render subscription. Use `subscribeWithSelector` for external listeners only when useful, and always return teardown.

Keep functions, manager instances, signals, promises, and transient loading state out of persisted data. Avoid effects that continuously copy one store into another; a documented persistence mirror or adapter is different from a second authority.

Prefer explicit phase unions for new workflows when they rule out impossible combinations. Do not add XState or another state library just to standardize syntax: the current wallet and Nostr session modules already provide domain owners.

### State shape and freshness invariants

Make relationships structural when several fields must change together. Prefer an optional `audit: { ...payload, checkedAtMs }` group over independent `auditState`, `auditCount`, and `auditAt` fields whose consistency depends on comments. Define what counts as a completed empty result; a fresh timestamp must never accidentally certify a payload that was dropped. Grouping persisted fields is a schema migration, not a cosmetic cleanup.

Preserve meaningful `0`, `false`, and empty strings. A truthy spread such as `...(value ? { value } : {})` is wrong when these are valid results; use the field's explicit absent-value rule. Missing, null, empty, and zero must have deliberate meanings across mapper, writer, and reader. Do not stamp one field unconditionally because today's endpoint happens to return it.

Normalize wire data in the owning boundary mapper before a store update. Put staleness policy in one owner used by both readers and writers. Read the clock once per transition; pass `nowMs` or an injected clock into freshness calculations so their tests do not depend on ambient time. Avoid an undocumented mutating eviction helper inside an otherwise immutable update; make its ownership and composition explicit.

When reviewing a store, check whether timestamps/counts/flags certify other fields, whether nullish handling agrees, whether repeated field prefixes represent one group, and whether a writer knows too much about readers' internal skip logic. Do not create a universal grouping helper unless real callers share these semantics.

## 13. Zod, persistence, and migrations

**Reviewed skills:** [sovran-zod](skills/sovran-zod/SKILL.md) for schema and migration review; [sovran-zustand](skills/sovran-zustand/SKILL.md) for hydration. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [persistConfig](app/shared/lib/persist/persistConfig.ts) registers schemas/versions and installs [createMergeWithSchema](app/shared/lib/persist/createMergeWithSchema.ts). The merge returns current defaults if the persisted object fails validation. [settingsStore](app/shared/stores/global/settingsStore.ts) already uses field-level tolerance for many presentational settings. Root overrides resolve Zod 4.4.3 in this snapshot.

**Decision:** validate once at each untrusted boundary: network, relay envelope, route, storage, native callback, import/QR, and configuration. Infer types from the schema where the schema is authoritative; do not maintain a second handwritten wire shape. Hoist schemas out of render/hot loops. Use synchronous parsing unless a refinement actually requires async work.

Choose unknown-key policy deliberately: `z.strictObject` rejects extras, `z.object` strips them, and `z.looseObject` retains them. Prefer bounded, forward-compatible upstream envelopes and explicit local contracts. `optional`, `nullable`, `default`, and `catch` have different meanings; do not substitute one for another to silence type errors. These are Zod 4 semantics ([Zod API](https://zod.dev/api)).

For shared network contracts, fix `@sovranbitcoin/schemas` and the consumers together. A temporary local extension needs the producer mismatch, affected versions, tests, and removal condition. Do not loosen a schema until it stops finding malformed input. `safeParse` success checks structure, not a Nostr signature or payment authorization.

For persisted stores use `persistConfig`, an explicit scope, data-only `partialize`, and a schema that accepts what that projection writes. Hydration must happen after required global migrations and identity selection. Post-hydration hooks observe readiness/apply effects; they do not replace merge validation.

**Durable-data rule:** renaming, removing, or tightening persisted fields/enums is a migration review even if the setting is “dev only.” Use tolerant field parsing for noncritical presentational values, or a version bump with a migration for values that must be preserved. `.default` handles missing values; `.catch` handles invalid present values. Never use a permissive fallback to turn invalid money, credentials, trust, or security policy into an apparently valid state.

An enum fallback must preserve meaning: an unknown speaker role must not become `assistant`, and unknown consent must not become acceptance. Prefer a real neutral/unknown member for disposable presentation. Critical records require explicit recovery or rejection; per-entry rejection is acceptable only where the owner can safely discard that entry, never as a generic funds-recovery policy. An outer object's default does not protect an invalid nested enum.

Review imported schema constants as well as files under `stores/`. A hand-maintained snapshot registry can miss newly persisted stores; validate registry completeness against actual `persistConfig` call sites. When replacing Zod v3 idioms, preserve acceptance and unknown-key behavior rather than merely making syntax look modern.

Zustand invokes migration for an incoming version; it does not automatically run a sequence of historical migrations for us ([persistence documentation](https://zustand.docs.pmnd.rs/reference/integrations/persisting-store-data)). Test every supported source version, omitted/invalid values, and malformed storage. Cosmetic schema edits must preserve terms acceptance, onboarding, and unrelated preferences.

Required existing starting points: [persist round-trip](app/__tests__/persistRoundTrip.test.ts), [schema drift](app/__tests__/persistSchemaDrift.test.ts), [enum tolerance](app/__tests__/persistedEnumTolerance.test.ts), and [settings resilience](app/__tests__/settingsStorePersistResilience.test.ts). They are evidence for the paths they test, not a universal corruption-recovery guarantee.

**Follow-up:** generic merge rejection still falls back to defaults. Critical stores need a deliberate recovery/preservation path rather than treating corrupted identity/funds data like disposable cache. [apiClient](app/shared/lib/apiClient.ts) also contains explicit local relaxations of external profile/auditor schemas; reconcile them against the producer and installed shared schema before deletion.

## 14. Cache ownership and freshness

**Reviewed skills:** [sovran-zustand](skills/sovran-zustand/SKILL.md) for cache state and ordering; [codebase-design](skills/codebase-design/SKILL.md) for one cache owner. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [createQueryCacheStore](app/shared/lib/cache/createQueryCacheStore.ts) supplies profile-scoped persisted envelopes, freshness, entry caps, and in-flight deduplication. [buildNostrDataLayer](app/shared/lib/nostr/buildNostrDataLayer.ts) owns the shared facade and profile snapshot mirror. [NostrNDKProvider](app/shared/providers/NostrNDKProvider.tsx) separately integrates NDK's SQLite relay-event cache.

Current cache choices are intentionally different: [home-feed page 0](app/features/feed/data/feedCache.ts) is memory-only with a two-minute freshness window and 12-key cap; [notifications page 0](app/features/feed/data/notificationsCache.ts) is memory-only with a one-minute window and eight-key cap. Their Map-containing payloads are not JSON-persisted; pagination stays ephemeral. [Mint changes](app/features/mint/data/mintChangesCache.ts) is a persisted host-scoped fetch with a 30-minute window. Retain these distinctions unless a measured requirement changes them.

**Decision:** cache at the source boundary with one authoritative owner per data kind. Query order/pagination, normalized entities, SDK databases, and image caches are different layers; do not make them competing copies of the same truth.

| Data | Owner and policy |
| --- | --- |
| Nostr display entities | Facade entity cache; shared by feed/thread/profile consumers |
| Query result/order/cursor | Existing feature query cache with viewer/config-aware key |
| Profile boot snapshot | Debounced persistence mirror of facade data, not an independent profile authority |
| Raw relay-event caching | NDK SQLite where that transport is used |
| Mint/proof/quote state | Coco persistent database and operation APIs |
| Mint metadata/catalog display | Existing metadata/fetch cache; not spendability evidence |
| HTTP image bytes | `expo-image` cache plus shared prefetch scheduler |
| DM decrypt results | Explicit private, profile-scoped cache; see decision 19 |

Every cache needs a key, scope, freshness policy, capacity, invalidation trigger, failure policy, and owner. Keys include all inputs that affect results: viewer, endpoint/tier config where relevant, filters, ordering, and cursor. Host-wide caching is allowed only when results do not depend on identity or authorization.

Return usable cached data before background revalidation; retain it on transient refresh failure. Use explicit fresh checks for payment-critical decisions. A metadata TTL is not a guarantee that a quote is valid or proofs are unspent. Preserve provenance/fetched time and expose degraded/stale state when it affects a decision.

Persist bounded envelopes, validate opaque payloads when reading, and evict/refetch invalid cache entries without resetting unrelated stores. Do not call the current `fetchedAt`-based eviction a true access-based LRU: it ranks write/fetch age. Select a different policy only if an actual workload needs it.

**Confirmed implementation gap to test:** `createQueryCacheStore.run` permits overlapping `force` requests and writes each completion without a generation check. An older request can therefore replace a newer result if they share a key. Its current `clear()` does not invalidate an in-flight completion. Add a deterministic out-of-order test, invalidate generations on clear/scope changes, and verify the caller's identity before committing. Storage-key scoping alone does not prevent stale asynchronous writes.

The inspected `run` consumer is [useMintChanges](app/features/mint/hooks/useMintChanges.ts), whose cache is host-scoped. Its signal checks occur after the factory has written the result. This establishes a helper-level ordering weakness, not a demonstrated cross-profile leak or payment-state corruption. Home-feed/notification consumers also write entries directly and need their own lifecycle review.

**Follow-up:** comments still mention a `useCachedQuery` consumer that is not present at the advertised shared-hook location. Document the actual current feature consumers before proposing another general cache hook. Do not add TanStack Query or another cache layer as a cosmetic cleanup.

## 15. Networking, concurrency, and cancellation

**Reviewed skills:** [codebase-design](skills/codebase-design/SKILL.md) for request ownership; [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) for network failure reproduction. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [apiClient](app/shared/lib/apiClient.ts) wraps app/backend calls; [requestSignal](app/shared/lib/http/requestSignal.ts) composes controls for exception-style APIs; [wallet/safeFetch](wallet/src/safeFetch.ts) bounds external wallet calls; [nostr/transport](nostr/src/transport.ts) owns Nagg transport. These different boundaries are legitimate.

**Decision:** route requests through their domain transport. Screens should not each recreate HTTP parsing, timeout, logging, authentication, and retry handling. Keep the original service identity when adapting errors. Model “offline,” “backend unavailable,” “one mint unavailable,” “cancelled,” “rate limited,” and “schema invalid” separately.

Use caller cancellation plus a bounded per-request deadline. The app signal helper currently defaults to 10 seconds and the wallet helper to 15 seconds; these are different boundary defaults, not values to unify blindly. A screen leaving may cancel optional reads, but cannot establish that an already-submitted financial operation stopped remotely.

Protect every late continuation with the owner/scope/request generation that started it. A cancelled request that still resolves must not update the next profile or a newer search. Debounce typing, deduplicate identical reads, bound fan-out, and cap pagination. For cursor loops, require progress and tolerate duplicate/empty filtered pages without looping forever.

Retry only when the owner knows it is safe. Safe reads can use bounded backoff with jitter and `Retry-After`; validation/auth failures normally need a changed input or user action. Publishing the same signed Nostr event is different from creating another signed event. Payment retries reconcile persisted operation/quote/proof state before any new spend attempt. A mint-wide cooldown must not starve an unrelated healthy operation.

Expected background failures have a handler; `void promise` does not contain a rejection. Always dispose subscriptions/timers and detach abort listeners where the implementation supports it. Keep upload and streaming deadlines distinct from short request defaults.

**Follow-up:** inspect direct `fetch` sites individually, including composer media handling, Routstr, Blossom, and NIP-11. They are not all violations: some are the intended protocol seams. Test boundedness, cleanup, and partial failure rather than consolidating everything into one giant HTTP helper.

## 16. Nostr reads, Nagg, Primal, and relays

**Reviewed skills:** [domain-modeling](skills/domain-modeling/SKILL.md) for protocol vocabulary; [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) for fallback investigation. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [buildNostrDataLayer](app/shared/lib/nostr/buildNostrDataLayer.ts) memoizes the facade by profile and tier configuration. [data-layer](nostr/src/facade/data-layer.ts), [strategy](nostr/src/facade/strategy.ts), [tiers](nostr/src/tiers), and [facadeFeedClient](app/features/feed/data/facadeFeedClient.ts) implement the app's read path.

**Decision:** app features consume the facade/feature adapter. Default source order is enabled **Nagg → Primal → raw relay**, skipping unsupported surfaces. Explicitly disabled tiers stay disabled. Preserve attempt/source metadata for diagnostics and degraded UI. Each tier owns its protocol quirks; screens do not implement their own fallback chain.

Use optimized app-view endpoints for product views. Generic GraphQL remains for generic operations/recipes when necessary. Backend indexing and ranking execution stay server-side; product mapping belongs in the typed client/app seam. New reusable transport/recipe behavior belongs in this repo's `nostr` package, not a fresh screen-local client or an obsolete sibling import.

Ingest all successful paths into the same entity cache. Known content should render before optional enrichment. Keep already-applied posts if author/stats enrichment fails. Profile feed root-note filtering must advance through reply-only pages with cursor progress guards; it must not assume a filtered empty page means the author has no posts. Start with the existing [profile fallback tests](nostr/__tests__/profile-feed-fallback.test.ts).

Nostr event structure, event-ID calculation, signature, and kind-specific interpretation are separate checks. Preserve the raw signed event; derive display data separately. Never mutate signed content and still present it as verified. NIP-01 defines the signed event and wire timestamp in seconds ([NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)). For accelerated app-view data, record whether authenticity is locally verified or trusted from the service; schema parsing alone is not cryptographic verification.

**Follow-up:** audit which consumers still need Nagg-only fast paths versus the facade, and retain only paths with a concrete capability/performance reason. The failure-to-empty conversion noted in decision 7 is the first result-contract fix. Also review facade rebuild disposal and profile snapshot flush ordering with late in-flight reads before claiming all teardown races are closed.

## 17. Nostr publishing, DMs, and state machines

**Reviewed skills:** [domain-modeling](skills/domain-modeling/SKILL.md) for state meaning; [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) for delivery/lifecycle failures. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [publishEvent](app/shared/lib/nostr/publish/publishEvent.ts) provides signed-event deduplication, per-relay results, and bounded fan-out/retries. [ownContentStore](app/shared/stores/profile/ownContentStore.ts) tracks local content. Nostr [notification sessions](nostr/src/facade/session) and live tier contracts own read/subscription lifecycle. There is no reason to force these into the wallet machine.

**Decision:** publish through the existing publish boundary, with app signer/relay policy supplied by its owner. Optimistic local display, signed, relay-accepted, failed, and reconciled are distinct facts. Do not show “delivered to recipient” merely because a relay accepted an event. Retry the same signed event where appropriate, rather than accidentally creating duplicates with new timestamps/IDs.

Represent each long-lived interaction as an explicit domain session: identity/config, phase, in-flight work, acknowledgement, retry/backoff, and disposal. Use typed events/transitions and expose a stable UI projection. This is a design contract, not a requirement to rename current internal state fields or adopt a new machine library.

Live `dmLiveSubscribe` and `notificationsLiveSubscribe` return unsubscribe functions; the [strategy contract](nostr/src/facade/strategy.ts) explicitly says they do not auto-reconnect. Where loss matters, pair the stream with the existing bounded catch-up/poll mechanism, deduplicate by event identity, and resume from a cursor. Do not assume a reconnect resumes a previous request.

DM decryption stays on the client. Nagg transports ciphertext/envelopes; it must not receive private keys or decrypt messages. Use the existing signer and NIP-04/NIP-17/Marmot-specific boundaries; do not reinterpret one protocol's acknowledgements or encryption state as another's. Public social metadata, direct messages, and payment-request delivery need different storage/retention policies even when all use Nostr.

**Acceptance:** no signer, denied signing, zero relays, mixed relay outcomes, timeout after one acceptance, duplicate publish calls, offline/reconnect, unmount, profile switch, and late delivery. Tests must distinguish accepted, delivered, redeemed, and settled instead of collapsing them into “success.”

## 18. Cashu, wallet, and payment state machines

**Reviewed skills:** [codebase-design](skills/codebase-design/SKILL.md) for wallet interfaces; [domain-modeling](skills/domain-modeling/SKILL.md) for payment states; [tdd](skills/tdd/SKILL.md) for behavioral regressions. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [wallet machine](wallet/src/machine), [screen actions](wallet/src/screen-actions), [operations](wallet/src/operations), [SovranColadaProvider](app/features/send/providers/Colada.tsx), and [CocoProvider](app/shared/providers/CocoProvider.tsx) form the main seam. [STATE_MACHINE.md](wallet/docs/STATE_MACHINE.md) records flow steps and known gaps; use its source links and current code, because some introductory ownership wording predates the current package integrations.

**Decision:** keep payment sequencing in `wallet`, financial operation authority in Coco/its database, and app presentation/native adapters in `app`. A screen invokes a bound action or machine event; it does not recreate proof selection, mint/melt/swap, retry, or history reconciliation.

Use precise vocabulary: proofs are spendable records; a token is an encoded transfer container; minting issues ecash, melting redeems through a payment rail, swapping replaces proofs. Mint quote creation, invoice payment, ecash issuance, token sharing, recipient redemption, and final settlement are different events. The SDK/state machine owns their transitions. For example, NUT-07 distinguishes unspent, pending, and spent proof states ([NUT-07](https://github.com/cashubtc/nuts/blob/main/07.md)); a spinner or HTTP result does not supersede them.

Root entry to Send, Receive, scan, NFC, mint selection, or Nearby payment starts from the intended context via [clearPaymentContext](app/shared/stores/runtime/clearPaymentContext.ts). Preserve an entered amount when changing mint still refers to the same intent. Avoid stale recipient, amount, unit, or mint from a previous flow. Use operation IDs and generation guards, already present in the machine, rather than booleans spread across screens.

Cancellation of UI work invalidates stale screen updates; it does not erase an already-committed operation or assume a refund. Recovery resumes/reconciles persisted records. Keep offline exact-proof operations offline when their contract requires it. Do not add a “fresh metadata” fetch that blocks a valid offline send.

Treat QR, NFC, payment requests, and public mesh as separate delivery contexts. NFC's intentional automatic resolution does not authorize skipping confirmation elsewhere. A public mesh recipient-locked transfer must never silently degrade to an unlocked bearer token. Encryption/delivery status does not prove redemption.

**Follow-up:** the app provider still overrides some default operations to obtain real persisted history IDs and app enrichment. Move reusable behavior to `wallet` only after comparing contracts, not merely to reduce file length. Preserve installed SDK types and test the actual version; direct Cashu SDK usage can be legitimate inside protocol adapters, but is not the UI default.

**Acceptance:** double tap, concurrent resolve, back/re-entry, profile switch, mint change, pending outcomes, interruption after commit, retry/recovery, P2PK constraints, fees/units, and offline flows. Use wallet flow/property/integration tests; device tests are required for native crypto/NFC/BLE behavior. Passing fixture tests does not establish live mint settlement.

## 19. Identity, private data, and profile lifecycle

**Reviewed skills:** [sovran-zod](skills/sovran-zod/SKILL.md) for durable-data boundaries; [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) for isolation failures. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [profileScopedStorage](app/shared/lib/cashu/profileScopedStorage.ts) waits for migration/profile hydration and creates pubkey-scoped keys. [app root](app/app/_layout.tsx) composes account-scoped providers; [appRestart](app/shared/lib/profile/appRestart.ts) supplies restart integration. Native modules and caches have their own scope boundaries.

**Decision:** classify data before choosing persistence.

| Class | Policy |
| --- | --- |
| Mnemonic/private/signing keys and equivalent credentials | Existing secure-storage/key-service boundary; never general Zustand/AsyncStorage, URLs, logs, or fixtures |
| Financial authority (proofs/quotes/operation recovery) | Existing wallet database, exact scope and migration discipline |
| Private messages and sensitive activity | Explicit profile isolation, retention, and protection-at-rest policy |
| Public metadata | Bounded cache; scope by viewer whenever results depend on identity |
| Temporary UI state | Memory; clear at the relevant operation/profile boundary |

Use the existing native cryptographic entropy path; do not add `Math.random` fallbacks or create ad hoc crypto. Feature code asks the signer/manager for an operation; it does not copy private material into convenience stores. Keep development seed/mock behavior explicitly gated and isolated from real persistent data.

On profile switch, stop old owner callbacks, settle/close manager resources in their established order, cancel optional reads, evict private in-memory state, and restart/remount as the current profile workflow requires. A remount does not necessarily stop a native singleton. Pass profile scope across native boundaries. Delayed writes must target the captured owner or be rejected, not resolve “current profile” after awaiting unrelated work.

Use [openExternalUrl](app/shared/lib/url.ts) for untrusted outbound links. Enforce scheme/domain rules at the relevant boundary, including image URLs and deep-link inputs. QR payloads and clipboard content remain untrusted until parsed.

**Confirmed privacy gap:** [nip04Cache](app/shared/lib/nostr/nip04Cache.ts) persists decrypted strings through [createPubkeyScopedCache](app/shared/lib/cache/createPubkeyScopedCache.ts), whose storage is AsyncStorage. Profile scoping is not encryption at rest. The selected target is memory-only plaintext caching by default; any durable decrypted-message cache needs an explicit encrypted storage and retention design. Migrate/remove only those cache keys safely; do not confuse them with authoritative message or wallet records. This audit did not inspect stored user data or verify device backup protection.

## 20. Performance, efficiency, and background work

**Reviewed skills:** [react-native-best-practices](skills/react-native-best-practices/SKILL.md) for measured native performance. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** React Compiler is enabled in [app.json](app/app.json), with a [bailout baseline](app/react-compiler-bailouts.json). [useVisualActivityEffect](app/shared/hooks/useVisualActivityEffect.ts) observes screen/app activity even when a screen is frozen. [bundle budgets](app/bundle-size-budget.json) and the [thermal investigation](docs/architecture/thermal-investigation-2026-09-09.md) provide existing measurement context.

**Decision:** optimize against an observed cost and preserve behavior. Record device, build mode, scenario, source SHA, and metric before/after. Development logs and simulator timings do not establish production battery or frame performance. React Native explicitly recommends release builds for performance evaluation ([performance guide](https://reactnative.dev/docs/performance)).

| Pattern to avoid | Preferred behavior |
| --- | --- |
| Fetch/decrypt/parse or serialize large objects in render | Move work to its data boundary; derive small render inputs |
| One profile/stats request per row | Batch through existing entity/profile owners |
| Whole-store subscriptions for a single field | Narrow stable selectors |
| Long data arrays inside a same-axis ScrollView | Shared virtualized `List`; preserve intentional specialized owners |
| A timer or animation per hidden row | Shared clock/activity owner, plus row viewability where needed |
| Updating React state every animation frame | Reanimated/shared-value work at the animation seam |
| Re-sorting/reparsing whole feeds on each event | Incremental indexed updates and stable entity identities |
| Persisting/logging a full object on every progress tick | Bounded, coalesced projections and disabled-level fast paths |
| Unlimited network/image prefetch fan-out | Dedupe, concurrency/queue limits, and cancellation |
| Retrying one failure in a way that stalls unrelated payments | Operation-specific policy and explicit degraded state |

New ordinary component code relies on React Compiler unless a measured hot path or external identity contract requires explicit memoization. Keep existing `useMemo`/`useCallback` until a targeted change verifies removal. React's guidance makes the same distinction between new code and existing memoization ([Compiler introduction](https://react.dev/learn/react-compiler/introduction)). Memoization cannot replace lifecycle correctness or make mutable state safe.

For removal, inspect compiler results for each touched file: zero compiled functions or any skipped function means keep the memo until coverage is understood. An aggregate pass can omit throwing files and does not prove stable dependency identity. Compare `react-hooks/exhaustive-deps` warnings, not just lint errors; removal must not increase them. Do not replace a memoized dependency with a new render-scoped function in an effect's dependency array.

Effect/focus-effect dependencies, provider values, component-producing functions, list/navigation/gesture library inputs, and signer/payment callbacks require explicit identity and runtime evidence. Keep a memo backed by a recorded measurement unless that measurement is repeated. If removal is valid, prefer a plain expression or module-level pure function; replacing it with an immediately invoked function only changes syntax. Explain retained detector exceptions beside the code and update stale caller comments as well as the edited file.

Use `useVisualActivityEffect` for screen-scoped ongoing visual work. Freezing React rendering does not guarantee that timers, native callbacks, subscriptions, or animations stop. Completed indicators stop scheduling frames. Respect reduced motion and low-power behavior. Screen focus is not row visibility; expensive offscreen video/animation needs a row-specific gate.

Keep transport delivery/reconciliation alive when its product contract requires it. Leaving Nearby can stop expensive discovery UI while preserving intended BLE delivery and an in-flight payment. Do not tie a shared service's lifetime to whichever screen first mounted it.

**Follow-up:** establish measured budgets for cold-start interactivity, navigation, scroll jank, idle CPU/network, memory, and power on representative supported devices. Existing bundle limits are enforceable; runtime targets are not measured by this audit. The prior thermal document records source candidates and changes, not a proven battery improvement. Its removed Coco backoff patch must not be reintroduced as generic “efficiency” without isolation/responsiveness tests.

## 21. Startup, preloading, prefetching, and prerendering

**Reviewed skills:** [react-native-best-practices](skills/react-native-best-practices/SKILL.md) for startup measurement; [expo-router](skills/expo-router/SKILL.md) for route prefetch mechanics. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [index.js](app/index.js) loads [shim.js](app/shim.js) before Router; native crypto/bootstrap assertions are deliberate. [root layout](app/app/_layout.tsx), [InitializationProvider](app/shared/providers/InitializationProvider.tsx), [useDeferredMount](app/shared/hooks/useDeferredMount.ts), and the feed tab's first-focus gate separate first paint from heavier work. [imageCache](app/shared/lib/imageCache.ts) gates prefetch on boot completion and limits active requests to four with a 512-URL success set.

**Decision:** distinguish four techniques:

| Technique | Use |
| --- | --- |
| Bootstrap prerequisite | Crypto, essential fonts/config, migrations/identity required for safe use |
| Data prefetch | Warm the existing cache for a likely next action |
| Deferred component mount | Render a cheap safe frame, then initialize expensive optional content |
| Route prerender/static rendering | Explicit navigation/web feature; not a generic data-cache strategy |

Keep critical secure bootstrap checks before consumers. Do not lazy-load an entropy provider after key generation becomes possible. Optional Nostr enrichment, image warming, and nonessential services must not delay wallet first paint. Initial readiness, wallet readiness, and background enrichment are separate states.

Prefer seeding thread/profile content from the shared entity cache over mounting hidden screens. `Screen` defers content by default; a seeded thread or immediate-focus input can explicitly opt out. The current `InteractionManager` helper does not guarantee waiting for a native stack slide to finish; do not treat its timing as a protocol guarantee.

Prefetch likely, bounded data after critical boot work. Reuse in-flight requests and allow optional work to be abandoned. Avoid prefetching every tab, page, avatar, or video on launch. Eagerly mounted native tabs need a deliberate first-focus gate around heavy feature work. Cached read permission does not authorize signing, minting, tracking location, or requesting permissions during prefetch.

Expo Router prefetch can mount a screen and run effects, with navigation restrictions; inspect the screen before enabling it ([navigation/prefetch documentation](https://docs.expo.dev/router/basics/navigation/)). Do not pre-render payment execution routes with side effects. Expo static rendering is a web build concern, separate from native startup ([static rendering](https://docs.expo.dev/router/web/static-rendering/)). Do not add web prerender architecture to fix native navigation latency.

**Follow-up:** the image scheduler bounds active requests and completed URL retention, but its waiting queue is not explicitly capped and it has no caller cancellation. Add queue/generation limits and test boot-gate failure/abandonment before calling all prefetch work bounded. Native imports, `inlineRequires`, font loading, and provider ordering need Metro/native validation when changed.

## 22. Reuse and dependencies

**Reviewed skills:** [codebase-design](skills/codebase-design/SKILL.md) for reuse decisions; [react-native-best-practices](skills/react-native-best-practices/SKILL.md) for dependency/bundle cost. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [Metro configuration](app/metro.config.js) deliberately pins shared dependency identities and excludes an unused NDK wallet import surface. [requestSignal](app/shared/lib/http/requestSignal.ts) uses the `wallet/safeFetch` subpath to avoid making the whole payment engine reachable. The repo already has `neverthrow`, Zod, Zustand, Uniwind, and domain libraries.

**Decision:** reuse a behavior because its contract is the same, not because two snippets look similar. Before extracting, compare meaning, error behavior, side effects, profile scope, lifecycle, platform capability, and expected change rate. A useful shared module hides a coherent responsibility behind a small interface. A generic helper with many flags can create more coupling than the duplicated lines removed.

Start with deletion: can an obsolete path disappear, or can an existing owner already do the work? An extraction must remove knowledge from callers, not move complexity behind pass-through files or manufacture a better architecture score. Prefer an in-process function/module to a new service or injection framework unless the boundary warrants one. A one-implementation adapter is a review signal, not grounds to erase security, native, persistence, or protocol isolation. Testability matters, but exporting an otherwise private helper just for a unit test is not sufficient justification.

For a consolidation, read every sibling caller and size the interface to their actual needs, including accessibility, test IDs, errors, and lifecycle. Reject a merge that requires caller-specific behavior flags or combines unrelated responsibilities. A telemetry-only discriminator can be an explicit exception if it cannot change behavior. Compare at least one simpler alternative before inventing a new shared interface. Record rejected merges and their reasons so the same misleading similarity is not repeatedly proposed.

Prefer the existing canonical owner. A helper used only inside one file can stay private there; shared placement needs genuine cross-file reuse or an established boundary responsibility. Before moving exports, inspect hand-listed `jest.mock` factories. Adding `jest.requireActual` indiscriminately can reintroduce native or persisted-store dependencies the mock intentionally cuts. Pure formatters should accept their inputs instead of transitively loading a persisted store.

Prefer, in order: an existing project owner, a built-in runtime API that is verified on supported devices, a small local function for genuinely simple logic, then an external package when its maintained behavior justifies the cost. Do not hand-roll cryptography, protocol codecs, or international plural rules to reduce dependency count.

Every proposed dependency should explain:

1. The exact capability and why existing code/runtime cannot supply it adequately.
2. Runtime versus development-only use, native code/permissions, and supported-platform compatibility.
3. Transitive bundle/startup cost, singleton/peer requirements, maintenance/security history, and license.
4. Which module owns the import, how it is tested, and what would allow removal.

Use narrow supported subpaths and `import type` for type-only needs. Do not import a whole runtime library through a barrel for one type or helper. Do not create wrapper modules that merely rename an API unless the seam centralizes policy, compatibility, or testing. Never rely on an undeclared transitive dependency just because hoisting makes it available locally.

Do not add a date library for existing date styles, an icon runtime for one glyph, a second cache/state system for one screen, or a class helper already replaced by `cn`. Dependency count alone is not the metric: one maintained parser can be safer and smaller than several local substitutes.

**Acceptance:** lockfile/manifest agree; peer identities and Metro imports are correct on both platforms; required native build passes; focused behavior and bundle budget remain valid. Existing resolver exceptions need removal triggers and regression tests, not automatic deletion during cleanup.

Measure dependency removal by distinct resolved package/version identities as well as lockfile entries: hoisting can move entries without removing an artifact, and removing a direct dependency may leave its transitive copy. A package's `expo-` prefix does not establish Expo ownership. Preserve native restart behavior, animated QR/fountain coding, bootstrap `TextDecoder`, cryptographic implementations, and deterministic display-name behavior until equivalent behavior is verified. A replacement renderer needs real glyph/mask/color/fallback/size comparison; mocks of the old dependency cannot establish equivalence.

## 23. Assets, fonts, and user media

**Reviewed skills:** [react-native-best-practices](skills/react-native-best-practices/SKILL.md) for native assets and image cost; [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) for font/media behavior. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [assets](app/assets) holds bundled resources; [useFonts](app/shared/hooks/useFonts.ts) statically lists font faces; [Image](app/shared/ui/primitives/Image.tsx) defaults to cover, memory/disk caching, and a one-second transition. [imageCache](app/shared/lib/imageCache.ts) owns prefetch. [theme](app/shared/lib/theme) and [media](app/shared/lib/nostr/media) own wallpaper selection and uploads.

**Decision:** separate bundled product assets, generated assets, downloaded cache, and user-owned media.

| Asset | Policy |
| --- | --- |
| Product icon/font/image | Static import/require from a known bundle path; source/license recorded |
| Generated icon registry | Source manifest/SVG plus deterministic generator; commit required artifact |
| Wallpaper/media download | Cache/file owner handles location, retention, and fallback |
| User upload | Existing normalization/upload service owns progress, cancellation, MIME/size rules, and remote descriptor |
| Native widget/app icon/splash | Native target/config owner; changes may require a new binary |

Keep essential boot/offline assets bundled. Do not construct dynamic `require()` paths that Metro cannot enumerate. Size images for their purpose, preserve aspect ratio to avoid layout shift, and release media resources offscreen. Normal photographs, avatars, wallpapers, and QR codes do not necessarily need the same transition: the current one-second wallpaper-friendly default should be explicitly overridden where it delays a dense row or machine-readable image.

`expo-image` is the image rendering/cache foundation. Use the shared wrapper where its defaults fit; direct use is legitimate at specialized rendering seams with explicit policy. Use `recyclingKey` or equivalent identity handling where recycled cells can otherwise show a prior item's image. Do not reimplement downloading and caching inside every image component.

Use HTTP(S) restrictions for untrusted remote images and explicit approved paths for local assets. Respect privacy for fetched avatars/URLs and media caches. Upload only on an intentional user action; preserve the original owned-blob descriptor for cancellation/deletion. User-visible media status distinguishes local, uploading, uploaded, published, failed, and deleted.

Fonts load centrally. Mona Sans uses PostScript names for the native glass module. `LuckiestGuy-Subset` only includes glyphs for its current demo words; it must not be used for arbitrary translations. Record licenses and subset sources/commands. Non-Latin locale coverage must be checked on device, not inferred from Latin screenshots.

**Asset naming and ownership:** use lowercase kebab-case for project-owned named
assets and folders. Prefer purpose owners (`brand`, `demo`, `fonts`) over a generic
`images` bucket. Within a generated asset family, editable inputs live in `source/`
and derived exports in `generated/`; generated SVGs are `artwork.svg`, never
mislabelled as source files. Keep `README.md` and `index.html` at the family root;
put machine-generated inventories in `generated/manifest.json`, with paths
relative to that family root. Scripts live under repository-root `scripts/`.
Do not keep duplicate aliases or superseded originals after updating all callers.

**Brand artwork convention:** the [canonical symbol](app/assets/brand/source/symbol.svg)
is the sole S geometry used by all layouts. The [wordmark source](app/assets/brand/source/wordmark.svg)
is lettering only. A `wordmark-lockup` combines S and lettering; a
`version-lockup` combines S and version text. The separately padded native layout
is `android-adaptive-icon`. The [layout specification](app/assets/brand/source/brand.json)
and generator derive every output from these canonical inputs.

Paths follow `app/assets/brand/generated/<layout>/<colorway>/<width>x<height>.png`.
Colorway names always describe **foreground-on-background**:

| Colorway | Meaning |
| --- | --- |
| `black-on-light` | Near-black S/text on the light gradient |
| `white-on-dark` | White S/text on the dark gradient |
| `black-on-transparent` | Near-black S/text with alpha background |
| `white-on-transparent` | White S/text with alpha background |

Never name a brand variant just `light`, `dark`, `t`, or an active app-theme name:
those confuse foreground color with background or theme. Use ASCII `x` between
both actual pixel dimensions: `512x512.png` for a symbol, `512x192.png` for the
wide lockup. Available widths are **16, 32, 64, 128, 256, 512, 1024 and 2048**.
Symbols/version lockups are square; wordmark lockups retain 8:3. Render every PNG
directly from the optimized SVG; never enlarge a raster logo source.

Use Bézier ink bounds for exact center alignment and spacing; use uniform scales
so every S has identical proportions. Version artwork reads `app/app.json`'s
`expo.version` and outlines the bundled font, avoiding installed-font differences.
SVGO multipass optimization must pass raster comparisons; smaller bytes do not
justify changing the curves. Preserve alpha for transparent variants and opaque
backgrounds for app/widget icons. Expo/native config selects concrete files and
owns native platform-size generation. Android uses `brand/generated/android-adaptive-icon/black-on-transparent/1024x1024.png`,
a separate padded export of the same S; tests keep all visible pixels inside the
central 66/108 circular safe zone. Native icon/splash changes need a new binary.

`bun run assets:generate`, `assets:check`, `assets:brand` and `assets:test` work
from the root or `app/`. The [brand generator](scripts/brand-assets.mjs) records
source hashes, version, geometry and output hashes in its generated manifest.
The install hook regenerates before Expo prebuild; EAS and release checks reject
stale artwork. Commit source and generated output together so regeneration does
not dirty the release checkout. See [the brand guide](app/assets/brand/README.md).

**Measured asset-budget update (2026-09-11):** the requested offline demo PNGs
add 14,893,736 bundled bytes; standardized branding/other assets add 22,997 bytes.
Linux release exports total 16,708,149 bytes on iOS and 17,670,455 on Android.
`bundle-size-budget.json` adds exactly that 14,916,733-byte product increase to
each prior asset ceiling, retaining original headroom and reference measurements.
JavaScript ceilings are unchanged. Source originals are not bundled. Future
fixture additions or alternative formats need a new measured review; splitting
demo media from production builds remains a possible size optimization.

**Verified raster platform exception (2026-09-11):** libvips 8.17.3 / Sharp 0.34.5
on macOS ARM and Linux x64 differ in 217 of 589,824 decoded channel values
(maximum difference 2/255) for only
`demo/43baaf0c28e6cfb195b17ee083e19eb3a4afdfac54d9b6baf170270ed193e34c/image@3x.png`.
Disabling SIMD does not remove the difference. Its `equivalentExportHashes` in
`app/assets/manifest.json` pins both inspected PNG hashes; the saved and freshly
rendered file must each match one of those hashes. Source identity/dimensions
remain checked, all other outputs require exact bytes, and release publication
always preserves the committed bytes and hashes. No general image tolerance is
allowed. Recheck/remove this exception when the source, sizing recipe or renderer
changes. Both platform checks passed with this bounded exception.

**Store feature graphics:** [the composition](marketing/feature-graphic/source/composition.json)
selects four native screenshots per platform; [the generator](scripts/feature-graphic.mjs)
uses those retained inputs plus canonical branding and bundled fonts. Keep these
marketing files outside the runtime asset bundle. Use platform identifiers `ios`
and `android` consistently: screenshot inputs are
`source/screenshots/<platform>/<screen-name>.png`, outputs are
`generated/<platform>/1024x500.png`. Drop capture-order prefixes from retained
inputs; the composition declares ordering and preserves the original run ID and
byte hashes. Export 1024×500 opaque RGB PNGs
under 15 MB; preserve screenshot proportions, trim only system chrome, and verify
complete text and all four panels visually. Use Android artwork for Google Play;
the iPhone companion is a marketing banner, not an App Store screenshot format.
`assets:generate`/`assets:check` include these files; `assets:feature` regenerates
only the banners. Do not retain redundant intermediate artwork or superseded
originals once canonical generation inputs are established.

**Scope and exceptions:** this is a project convention, not a platform-mandated
folder layout. Native resource tools own their generated names. Keep upstream
font filenames/PostScript identities, semantic icon IDs, public-media hash IDs,
and immutable e2e run artifacts under their existing owners. Metro runtime raster
families retain standard `image.png`, `image@2x.png`, `image@3x.png` names; do not
apply fixed export dimensions to those density-resolved imports.

**Demo raster convention:** existing public photos and fictional portraits retain
one immutable `source.*` plus purpose-sized `image.png`, `image@2x.png` and
`image@3x.png` runtime families. Those are source-limited media, not the vector
brand export library. Their [manifest](app/assets/manifest.json) and
[generator](scripts/assets.mjs) preserve provenance and prevent silent upscaling.
Runtime callers use literal imports; unused original/export files are not imported.

Public demo originals retain their signed-event source URLs and byte hashes;
`file` points to the retained original and `renderFile` to its PNG family. Demo
animations use a documented first frame for repeatable screenshots. This policy
does not convert live user media, rasterize scalable UI icons/patterns or alter
font files. See the
[asset guide](app/assets/README.md) for sizes, ownership and regeneration.

**Follow-up:** historical brand/font license records and downloaded-cache retention
still need review. The raster inventory records unknown provenance honestly;
it does not establish third-party license grants. Review image transitions by
surface separately. Keep one original rather than duplicating source bytes.

## 24. npm patches and vendored code

**Reviewed skills:** [code-review](skills/code-review/SKILL.md) for patch requirements versus implementation. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** root [patchedDependencies](package.json) registers five [Bun patches](app/patches). The repo also has [Marmot vendored output](app/vendor/marmot-ts), [BitChat submodules](.gitmodules), and native patch/copy scripts. These are different supply paths and need different rules.

**Decision:** package-manager patches use **Bun's native patch workflow**, not patch-package. Prepare the exact package with `bun patch`, modify the prepared files, then use `bun patch --commit` and inspect the generated manifest/lock changes. Preserve the root workspace's patch registration and `app/patches` convention. Bun documents install-time application and version-associated patch registration in its [patch guide](https://bun.com/docs/pm/cli/patch). Do not edit installed files without a reproducible committed patch.

For every patch record package/version, affected platform, problem/reproduction, upstream issue or rationale, test, and removal trigger. An upgrade must check whether the fix is upstream and whether the import actually reaches the patched file. SDK 56's Expo Router fork is a concrete case where patching the old package would do nothing.

| Current patch | Source-inspected purpose |
| --- | --- |
| `@gorhom/bottom-sheet@5.2.14` | Set sheet/backdrop `accessible` defaults to false; verify descendants and dismissal remain accessible |
| `expo-router@56.2.11` | Expose drawer overlay styling in Router's navigation fork |
| `react-native-screens@4.25.2` | Android form-sheet dimming adjustment |
| `heroui-native@1.0.4` | Sheet interaction/scroll-container and related local fixes |
| `expo-modules-jsi@56.0.12` | Replace unsupported `weak let` declarations for the older local Swift toolchain; review removal when Xcode 26.4+ is the minimum |

Patch source/runtime/type declarations as required by the package's actual resolution; do not assume only `src/` is used. Install from a clean disposable checkout with the lockfile and test that all required patches apply. Do not “fix” a patch failure by ignoring it. Do not run install/update tools merely to validate this documentation.

Successful installation is not proof of correct patch contents. Inspect the resulting patched files against the intended change, including removed/replaced lines and the actual installed version; stale filenames and permissive hunk application can hide a mismatch. Keep patch paths package-relative. Finish install/postinstall before Metro exports: concurrent relinking can invalidate the resolver's active paths. After a verified relocation-related resolution failure, rebuild with a cleared Metro cache rather than changing unrelated imports.

Vendored code must retain upstream source URL, immutable revision, license/notice, source selection, build tool/command, local modifications, generated outputs, and refresh instructions. Use an adjacent provenance document or machine-readable manifest; avoid hand-editing generated `dist`. Run vendor updates explicitly, not from a normal install fetching upstream HEAD. A vendor README's upstream claims are not evidence of Sovran compatibility or a security review.

The BitChat scripts intentionally patch iOS vendor input and copy selected Android source. Preserve their anchor/idempotence checks, pinned revision handling, and exact platform tests. A missing optional vendor checkout can be acceptable for a JS-only job; a native build must fail if required sources are missing. Do not treat ignored dirty submodule state as proof that modifications were reproduced correctly.

**Confirmed Marmot gaps:** [vendor-marmot-ts.sh](app/scripts/vendor-marmot-ts.sh) resolves its source to `sovran-app/marmot-ts`, which is absent in this checkout. It copies `dist`, package metadata, and optional license/README files without recording an exact source SHA in an adjacent Sovran provenance file. Correct source selection, make license/provenance mandatory, stage/validate output before replacement, and verify rebuild reproducibility in a separate change. The current vendored README labels the library alpha; production readiness must be assessed independently.

## 25. Package scripts, configuration, and release

**Reviewed skills:** [expo-router](skills/expo-router/SKILL.md) for version-specific navigation configuration; [code-review](skills/code-review/SKILL.md) for configuration changes. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** root [package.json](package.json) pins Bun 1.3.5, workspaces, singleton overrides, and patches. App [package.json](app/package.json) owns platform commands. [Metro](app/metro.config.js), [Babel](app/babel.config.js), [TypeScript](app/tsconfig.json), [Android TypeScript](app/tsconfig.android.json), [ESLint](app/eslint.config.js), [app.json](app/app.json), [app.config.js](app/app.config.js), and [eas.json](app/eas.json) have distinct responsibilities.

**Decision:** install at the workspace root with Bun and one committed `bun.lock`. Declare a dependency in the package that imports it. Overrides are documented compatibility/singleton constraints, not a way to hide unsatisfied peer contracts.

Metro/Babel/TS resolution must agree. Keep `@/` aliases, platform suffixes, workspace subpaths, singleton identities, Uniwind resolution, and worklet transforms aligned. Do not add a second explicit Reanimated/worklets transform when the Expo preset already supplies it. The separate Android type pass is required because the main config resolves iOS variants.

Use `app.json` for stable declarative config, `app.config.js` for intentional build-profile composition, EAS config for build profiles, plugins for generated native changes, and local modules for native behavior. Avoid manual changes in generated `ios`/`android` projects that disappear on prebuild. Plugin execution must be repeatable and scoped. Permissions, native dependencies, entitlements, or runtime compatibility changes require a rebuilt binary; JavaScript delivery cannot make an old native binary contain new code.

Public build variables are not secret storage. Validate required configuration at its boundary, distinguish development/preview/production, and make production failure explicit instead of falling back to a developer endpoint. Do not print secret values while diagnosing config. Keep ignored environments, credentials, databases, and generated build artifacts out of commits and audit documents.

Scripts need a clear name, working directory, required inputs, outputs, side effects, and exit status. Read-only checks must not silently refresh dependencies, rewrite a budget, delete native projects, or submit a release. Generators should stage results and replace output only after validation. Use Node/Bun/Python/shell according to the tool's existing implementation; do not add a runtime for a trivial task.

**Confirmed portability gap:** `dev` and `dev:wda` reference `app/scripts/dev.sh` and `app/scripts/start-wda.sh`. Those files exist locally but are explicitly ignored and absent from the Git index. A clean checkout cannot rely on them. Commit portable secret-free launchers, or make the local prerequisite explicit and provide a tracked default command. Do not copy local machine configuration into the repository without reviewing it.

**CI dependency contract:** merge/release validation installs the committed lockfile with `bun install --frozen-lockfile --backend=copyfile`. [setup-sovran](.github/actions/setup-sovran/action.yml) defaults to this path. Refreshing external packages requires an explicit `refresh-sovran-externals: true` compatibility run; it must not replace the locked merge gates. PR tests include the release controller/archive tests and the JSON-native harness contracts. Install hooks may regenerate artwork, so CI also rejects changes to committed brand outputs after installation.

**Release boundary:** [release/README.md](release/README.md) owns the pipeline contract and activation checklist. The bootstrap merge is version `0.1.1`; automatic publication starts only above that baseline after activation. Keep `app/app.json`, root and app package versions in sync, regenerate assets before review, and keep builds pinned to the reviewed source SHA. The release controller publishes the same verified Play universal APK to GitHub and Zapstore. Signing continuity with existing installs and rotated/quantum-ready Play keys requires real APK and device evidence; an equal package name or a configured fingerprint does not prove it. Version artwork is copied from that source SHA to immutable `sovran.money/releases/<version>/artwork/` URLs, with every deployed file hash checked. App Store review and Freedom catalog review remain external gates. Read-only checks never build, submit, publish or change GitHub settings. Ordinary development build scripts can refresh dependencies and remove native projects; inspect their effects before running them.

## 26. Logging, testing, and enforcement

**Reviewed skills:** [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) for reproducible diagnostics; [tdd](skills/tdd/SKILL.md) for behavior tests; [code-review](skills/code-review/SKILL.md) for independent review. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [logger](app/shared/lib/logger.ts) and [log-doctor](app/codereview/log-doctor/OVERVIEW.md) provide scoped diagnostics; [CI](.github/workflows/ci.yml) runs workspace tests as a blocking step, with formatting/structural signals advisory. This differs from older ADR wording saying tests are nonblocking. Other workflows cover lint, both platform type checks, styling, glass headers, Compiler, and bundle size.

**Decision:** use registered scoped loggers with stable event names, severity, operation correlation, counts/timings, and redacted structured errors. Keep raw payloads, private keys, bearer ecash, full invoices, DMs, and credential-bearing URLs out of logs. Disabled logging should avoid constructing expensive metadata. Do not log every successful render/conversion or enable global debug tracing for routine operation.

Before inspecting app logs, run log-doctor's redaction check and use a bounded relevant time/namespace slice. Do not read or copy the entire large log by default. Release source maps and build identifiers support diagnostics; friendly error text is not the diagnostic record.

Test behavior at the owner: pure parser/transition cases in `wallet` or `nostr`, React integration/persistence contracts in app Jest, native user journeys in the existing JSON E2E harness. Favor boundary failures, interruption/re-entry, lifecycle ordering, and data preservation over tests that simply repeat implementation details. Mocks do not prove native entropy, relay availability, rendered safe areas, or settlement.

### Native page testability contract

**Decision (2026-09-11):** every application page and every supported user action
must be operable by the JSON-native harness on iPhone and Android. This is an
implementation requirement, not a statement that the existing suite already
covers every route. Screenshots alone establish neither interaction coverage nor
payment correctness. React Native's [testing guidance](https://reactnative.dev/docs/testing-overview)
separates component checks from native end-to-end behavior; Android's
[UI Automator guidance](https://developer.android.com/training/testing/other-components/ui-automator)
supports state-based synchronization and semantic element discovery.

Use the existing owners: [JSON architecture](app/docs/testing-json-native-adr.md),
[scenario schema](app/e2e/schema/scenario.ts), [canonical pages](app/e2e/schema/pages.ts),
[capabilities](app/e2e/schema/capabilities.ts), [coverage ledger](app/docs/testing-coverage-ledger.md),
[route aliases](app/e2e/schema/page-routes.ts), and [native drivers](app/e2e/drivers). Keep runtime proof with the run manifest,
source fingerprint, events, redacted accessibility tree and relevant images.
Do not introduce a second framework or an app-state mutation shortcut to make a
UI journey pass.

For every new or changed route, reusable interaction, or modal:

1. Identify its canonical page, real entry action, readiness signal and exit/back
   path. Include aliases opened from history, a deep link, a drawer or another
   modal when their navigation/lifecycle differs. Register a new captured page
   in `CANONICAL_PAGES`, map every route alias in `PAGE_ROUTES`, and include its scenario in the appropriate suite. The route-inventory test rejects an unregistered route.
2. Put a stable semantic `testID` on each actionable control: tabs, rows, header
   icons, menu items, switches, sliders, text inputs and footer actions. Use
   public entity identity for repeated rows, not array position or localized
   text. Never put a seed, invoice, bearer token or private message into an ID.
   An ID must reach the native node that receives the interaction.
3. Preserve human accessibility: meaningful labels/roles and selected, disabled,
   busy and expanded state. Icon-only header actions need an accessibility label
   as well as an ID. Do not make a whole row accessible if that collapses its
   independently actionable trailing button. A hidden evidence probe is not an
   accessible replacement for the actual control.
4. Expose state that has no suitable visible native node with the existing
   [E2EAccessibilityProbe](app/shared/lib/e2e/E2EAccessibilityProbe.tsx), mounted
   **inside the active sheet/screen**. Reuse existing action-menu and transaction
   probes. A root probe can be occluded by a modal. Source `testID` presence is
   only a candidate until the native tree and a real action confirm it.
5. Add or update the smallest scenario that enters, operates and exits the
   affected surface. Copy a proven transition; wait for destination/state rather
   than arbitrary sleeps. Retry only safe, idempotent taps. Never replay sends,
   publishes, deletes, text insertion, or blind coordinates in a retry loop.
6. Validate JSON and run focused owner tests first, then the affected native
   journey on **both** platforms. A fake-driver pass checks orchestration only.
   Record unavailable hardware/capabilities as explicit gaps with a reason;
   never silently drop a platform or equate one platform's pass with the other.

| Interaction | Required observable behavior |
| --- | --- |
| Tap / long press / nested row button | Correct action exactly once; disabled/busy state blocks duplicates; nested action does not trigger the parent |
| Vertical or horizontal scroll | Offscreen content and the final action are reachable; pinned headers/footers do not cover tap targets; pagination terminates and preserves position |
| Swipe / drag / slider | Native gesture changes the intended state; cancellation and threshold behavior are checked; preserve a supported accessible alternative |
| Modal / sheet / popup | Open, operate, cancel, close, reopen; iOS swipe/back and Android back behave correctly; focus/taps return to the underlying screen |
| Text input / keyboard | Native typing, replacement, paste where supported, submit and dismissal; keyboard does not obscure the active control or footer |
| Async content | Distinct loading, populated, empty and failed states; refresh/retry, late results and stale profile/session completion cannot show the wrong data |
| Navigation / lifecycle | Entry, back, re-entry, background/foreground and relaunch where state survives; no leaked listener or previous-flow amount/mint/context |
| Sensitive / external actions | Use the existing owned-device/funded-lane contract; bounded test funds and cleanup; demo data cannot authorize a real operation |

Use screenshot review to catch clipping, occlusion, stale pages and bad safe areas;
use native assertions to establish behavior. Coordinate taps are a documented
last resort with measured current-device evidence, not reusable defaults. Prefer
fixing the shared control's native exposure so every caller benefits. Keep
animations at the app's supported settings; disabling Android animation scales
can change Reanimated/reduced-motion behavior and invalidate the test.

**Inventory:** the 2026-09-11 source pass catalogued all 111 route entries across
82 routed page identities, adding 51 names missing from the screenshot registry.
[The generated inventory](app/docs/testing-page-testability.md) separates iPhone
and Android authored journeys and marks gaps. Regenerate with `bun run e2e:pages`
from `app/`; native pass evidence is deliberately not inferred from this report.

### Mock Mode and screenshot fixtures

**Owner:** [settingsStore.mockMode](app/shared/stores/global/settingsStore.ts) is
the sole reactive mode selector. [mockDataStore](app/shared/stores/runtime/mockDataStore.ts)
holds wallet/contact fixtures and display-only per-mint balances; [mockPresentationData](app/shared/stores/runtime/mockPresentationData.ts)
holds feed, notification and AI presentation data. These are runtime-only data,
selected at the render/read boundary. The persisted boolean remains compatible
with older settings; no terms/onboarding/preferences are reset by this change.

**Invariants:**

The separate failure toggles (`mockOffline`, `mockFailSend`, and similar fault
controls) retain their own settings; disabling presentation Mock Mode does not
reset those fault scenarios.

- Never inject fixtures into Coco proofs/quotes, live transaction stores, Nostr
  entity caches, query caches, relay transport, or durable AI conversations.
  Temporarily skipping a persistence write is insufficient: a later ordinary
  mutation or delayed entity-cache mirror can persist the entire polluted state.
- Enabling twice is harmless. Disabling immediately selects live data, including
  already-mounted screens. Mode changes dispose isolated feed/notification
  instances; a late completion cannot repopulate a demo surface or live cache.
  No hydration callback re-injects fixtures. Demo DM messages have separate local
  state and are never merged with live server history or optimistic echoes. Local demo AI replies never call a
  provider and are discarded when the mode is turned off.
- Fixture social cards/notifications are read-only; they do not publish, zap,
  follow, or open fabricated event identities as real conversations. Mock Mode
  is a presentation mode, not a universal fake wallet or a settlement test.
  Public contact profiles retain their real public identities and reviewed avatars.
  Fictional chat contacts use distinct synthetic identifiers and generated portraits,
  with no signer, payment address or verification claim. Never attribute invented
  private messages to a real public key. Mock Contacts replaces private rows and
  disables DM queries; it must not merge real conversations into the gallery.
  Fictional conversations never publish or offer payment actions, even after
  disabling Mock Mode while the conversation is mounted. Send recents are
  presentation-only and never written to the recent-people store.
- A shared component renders fixture data using the same layout as live data.
  Keep fixtures small and representative, with stable identities, coherent
  amounts/states, non-secret content and bounded relative timestamps. Do not
  fabricate cryptographic proofs, claimed verification or successful payments.
- Upgrade cleanup removes only identifiable old demo entries. For historical
  fixtures that reused public keys, match fixture content before deleting
  metadata; a key match alone must not erase newer genuine profile data.
- Test enable → enable → disable, disable → hydration/late completion, and
  re-enable. Assert live data is preserved, no fixtures enter persistence or
  entity ingestion, and mounted readers return to live data. Include mode-off
  native assertions in the capture journey. Owner regression:
  [mockModeIsolation.test.ts](app/__tests__/mockModeIsolation.test.ts).

**Public snapshot (2026-09-11):** the header/drawer can display the reviewed
`kelbie` npub through `usePresentationPubkey`; this must never replace
`NostrKeysProvider`, account keys, signing identity or wallet receive addresses.
The [public demo snapshot](app/docs/testing-public-demo.md) supplies selected
follow-graph posts, genuine public notifications and metadata at the read boundary.
Retain original signed content/timestamps and record unsigned aggregate provenance;
do not invent authors, endorsements or counts. Bundle only reviewed public images.
Resolve bundled feed media at the scoped render boundary without rewriting signed
event URLs. Capture readiness must include visible image loading. Document generated
fictional portraits separately from authentic public profile images.
Disabling Mock Mode must restore the real account's name/picture as well as its
history/feed. A public snapshot may replace the live metadata of an allowlisted
contact for presentation, but never its private conversation or persisted record.

**Store capture exception:** `app/e2e/suites/store-screenshots.json` takes a
fourteen-page review gallery per phone using `--evidence screenshots --no-record`.
Named captures, failure evidence and final-state proof remain; automatic
per-action PNGs and optional database dumps are omitted. App Store/Freedom ZIPs
select ten images and Google Play/Zapstore ZIPs select eight; the full gallery is
for review, not an instruction to upload fourteen images to a capped listing.
Every new screenshot needs populated, readable content and visual review on each
platform. Workflow and runtime limits belong in
[the store screenshot review](app/docs/testing-store-screenshots.md).

**Default mints:** [defaultMints.ts](app/shared/lib/cashu/defaultMints.ts) lists
Minibits (`https://mint.minibits.cash/Bitcoin`) first, followed by macadamia,
antifiat and Cuba Bitcoin. [initializeDefaultMints](app/shared/lib/cashu/initializeDefaultMints.ts)
attempts all four and selects Minibits on a fresh profile only after successful
trust initialization; an existing user selection is preserved. Network/TLS
failure must never be disguised by adding a fake trusted record or bypassing
certificate checks. Demo balances are not proof that a live mint was added.

### Commands and working directories

These are a verification menu for subsequent implementation, **not a claim that they were run for this document**. Select checks appropriate to the touched behavior; review mutation/live-funding flags before running E2E.

| Directory | Command | Purpose |
| --- | --- | --- |
| Repo root | `bun run type-check` | All workspace type checks; app includes iOS and Android |
| Repo root | `bun run test` | Workspace test scripts, including wallet/Nostr Vitest and app Jest |
| Repo root | `bun run knip` | Unused-file/dependency/export signals |
| `app/` | `bun run test -- <test-file> --runInBand` | Focused app Jest; do not pass Jest flags to root workspace tests |
| `wallet/` or `nostr/` | `bun run test -- <test-file>` | Focused package Vitest |
| `app/` | `bun run lint` | App ESLint |
| `app/` | `bun run pretty:check` | Existing code/config format check; its glob does not cover this Markdown file |
| `app/` | `bun run check:styling` | Styling ratchet |
| `app/` | `bun run check:glass-headers` | Native header integration rule |
| `app/` | `bun run check:react-compiler` | Compiler coverage/bailout ratchet |
| `app/` | `bun run test:design-system` | Existing UI inventory/scenario snapshots |
| `app/` | `bun run e2e:validate` | Validate JSON scenario definitions |
| `app/` | `bun run analyze-structure` | Architecture signals; not proof that a refactor is correct |
| Repo root | `bun run docs:build` | VitePress docs when that site changes |
| Repo root | `git diff --check` | Whitespace check |

For changed native/config/patch/import behavior, include both Metro platform bundles and appropriate native builds. For visible changes, inspect actual renders on relevant platforms and large-text/RTL/fallback states. For payment/cache changes, include late completion, duplicate submission, source failure, and profile-switch tests. Use existing E2E fixtures deliberately; never run destructive reset or funded scenarios against a real wallet casually.

Budgets and suppression files are records of known exceptions. Changes to them require a concrete reason and evidence; increasing a threshold is not a performance fix. Add mechanical checks for new conventions when they are reliable: e.g. translation completeness/parameter parity, vendor provenance, and locked CI. Review qualitative rules such as good abstraction boundaries rather than pretending a grep can decide them.

## 27. Naming, terminology, and display derivation

**Reviewed skills:** [domain-modeling](skills/domain-modeling/SKILL.md) for domain vocabulary; [codebase-design](skills/codebase-design/SKILL.md) for interface naming. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Observed:** [protocolIds](app/shared/lib/protocolIds.ts) already owns branded Nostr/P2PK identifiers, shared schemas, and conversions. [transactionPresentation](app/features/transactions/lib/transactionPresentation.ts) demonstrates exhaustive lookup tables; [feedEmptyStates](app/features/feed/lib/feedEmptyStates.ts), [feedRows](app/features/feed/lib/feedRows.ts), and [useFeedRows](app/features/feed/hooks/useFeedRows.ts) provide presentation owners. These are useful patterns, not claims that every existing export already follows the vocabulary below or that their English copy is localization-ready.

**Decision:** names communicate domain, operation, representation, and units. Prefer a searchable canonical term over synonyms. Apply these defaults to new code and coherent naming changes; preserve externally specified names at SDK/wire/native boundaries and migrate durable keys deliberately.

### Identifier and file vocabulary

| Concern | Convention |
| --- | --- |
| Components, classes, types | `PascalCase`; no type/Hungarian prefixes |
| Functions, variables, props | `camelCase`; use meaningful singular/plural names |
| Acronyms | Treat as words: `HttpClient`, `parseUrl`, `NfcAdapter`; preserve external spelling at boundaries |
| Constants | `SCREAMING_SNAKE_CASE` for immutable module constants; `const` alone does not make an object immutable |
| Booleans | Unambiguous predicates such as `isDisabled`, `hasBalance`, `canSend`, `shouldRetry` |
| Events and hooks | Callback prop `onSend`; implementation `handleSend`; `use*` denotes a React hook |
| Components and hooks | `PaymentRow.tsx`, `usePaymentRows.ts`; filename matches the main named export |
| Pure logic | Domain-named `camelCase.ts`, such as `mintFees.ts`; no new `utils.ts`/`helpers.ts` dumping grounds |
| Entry/config files | Preserve Expo/platform/package-required filenames; use `index` for a real directory entry or public exports, not hidden unrelated business logic |
| Lookups | `<WHAT>_BY_<DISCRIMINANT>`: `ICON_BY_STATUS`; `_CONFIG` means settings, not any arbitrary map |
| Boundary modules | `Adapter` translates to an owned interface; `Client` owns remote access; `Bridge` crosses JS/native or process boundaries |

Avoid unexplained abbreviations, `Helper`/`Wrapper` catch-all names, and redundant context already supplied by a class/module. Short loop variables are fine in tiny local scopes. The unused-parameter convention or an external interface can justify an underscore; it is not a general naming style.

| Verb | Meaning in new app-owned APIs |
| --- | --- |
| `get` | Synchronous local access, no I/O |
| `fetch` | Asynchronous network/process read |
| `load` | Asynchronous local persistence read into memory |
| `build` | Pure assembly of rows, requests, or other data |
| `create` | Create an instance, resource, or key; avoid ambiguous `make` |
| `format` | Value to display string; locale/options are inputs |
| `parse` | Encoded text to structure; use `to`/`from` for representation conversion |
| `extract` | Take a meaningful subpart |
| `resolve` | Choose among alternatives to obtain a final value |
| `normalize` | Convert supported variants to a canonical boundary representation |
| `ensure` | Idempotently establish a condition |
| `mark`, `set`, `reset` | Change status, assign, restore initial state respectively |
| `remove`, `delete` | Remove a collection member, erase durable existence respectively |
| `compute` | Pure numeric/geometric calculation |
| `derive` | Reserve for cryptographic derivation in new shared helpers |
| `select` | Reserve for store selectors in new shared helpers |

These last two reservations prevent ambiguous display helpers; they do not require changing established machine commands, SDK methods, or user-facing “select” actions merely to satisfy a prefix search. Naming does not replace a typed effect/error contract.

Use `createdAtMs`/`expiresAtSeconds` for numeric instants, `...On` for calendar-only dates, and explicit units for durations (`timeoutMs`, `ttlDays`). Prefer `Seconds` over introducing another `Sec` spelling; existing protocol `created_at` is mapped at its boundary. Use `amountSat`, `amountMsat`, or `amountFiatMinor`; a generic `amount` is acceptable when its unit travels in the same typed object. `as const` gives compile-time literal/readonly information, not runtime deep freezing.

### Protocol dictionary

Use explicit domain/role names when a value crosses a boundary. Short names are fine inside an already unambiguous SDK-shaped record; do not introduce a generic `pubkey`, `secret`, `token`, `quote`, or `lock` parameter that can mean several protocols.

| Meaning | Canonical app name or family | Keep distinct from |
| --- | --- | --- |
| Nostr identity key in hex | `nostrPubkeyHex`, `viewerNostrPubkeyHex`, `peerNostrPubkeyHex` | Event ID, Noise key, compressed Cashu key |
| Nostr display/input encoding | `nostrNpub`, `nostrNprofile`, `nostrNevent`, `nostrNaddr` | Raw key/event fields inside Nostr events |
| Nostr event identifier | `nostrEventId` | Author key even though both are 64-hex strings |
| Signing secret versus encoded secret | `nostrSecretKeyHex`, `nostrNsec` | Proof secret or pairing secret |
| Wallet recovery phrase | `walletMnemonic` | Proof secret; do not call every secret a seed |
| NIP-46 roles | `nip46ClientPubkey`, `nip46RemoteSignerPubkey`, `nip46UserPubkey`, `nip46PairingSecret` | Transport/signer identity versus user identity |
| Cashu spending-condition key | `cashuP2pkPubkey`, `cashuP2pkSecretKey` | Mint keyset key or unrelated private key |
| Mint amount-signing key and keyset | `mintKeysetPubkey`, `mintKeysetId` | Mint's Nostr contact/operator identity |
| Mint contact/operator identity | `mintContactNostrPubkeyHex`, `mintOperatorNostrPubkeyHex` | Mint signing keys |
| Cashu proof material | `cashuProof`, `proofSecret`, `proofY`, `nut10Secret` | Private signing key, serialized token, invoice preimage |
| Encoded transferable ecash | `cashuTokenEncoded` | Auth token, individual proof, payment request |
| Mint/melt operation quote | `mintQuoteId`, `meltQuoteId` | History ID, Nostr request ID; retain mint/operation scope |
| Cashu payment request | `cashuPaymentRequestCreq`, `cashuPaymentRequestDecoded`, `cashuPaymentRequestLink` | BOLT-11 invoice or request-link metadata |
| Lightning payment data | `lnInvoiceBolt11`, `lnPaymentHash`, `lnPaymentPreimage`, `lnurlPayAddress` | Cashu `creq` or an onchain address |
| Onchain destination/transaction | `btcOnchainAddress`, `btcTxid` | Lightning invoice or Nostr event ID |
| Cashu lock | `cashuP2pkLock`, `p2pkLocktimeSeconds` | UI lock or concurrency mutex |
| Wallet identity scope | `walletProfile*` | Kind-0 display metadata (`nostrMetadata*`) |
| Mint identity versus display | `mintUrl`, `mintHostDisplay`, `mintName` | Host-only display is not a canonical cache/operation key |
| Nearby transport identity | `blePeerId`, `bitchatNoisePubkeyHex`, `dmPeerNostrPubkeyHex` | Shape or string length cannot establish key provenance |
| Identicon/name seed | `identitySeed` or `identitySeedHex` when actually hex | Display-only input must not become a signing/recipient key |

Nostr bech32 encodings belong to display/input/sharing rather than core event fields ([NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md)). A Cashu proof's `secret` is a message signed by the mint, not a private signing key; encoded tokens bundle proofs ([NUT-00](https://github.com/cashubtc/nuts/blob/main/00.md)). Keep these distinctions when translating UI wording as well as when naming code.

Reuse `protocolIds` rather than creating parallel regexes or prefix manipulation. Its construction path requires lowercase Nostr hex; its persisted-read schemas deliberately accept historical mixed case. Its Nostr-to-P2PK bridge produces the identity-lock `02` form, while the reverse bridge accepts both `02` and `03`. General P2PK inputs must not reject valid `03` keys ([NUT-11](https://github.com/cashubtc/nuts/blob/main/11.md)). These helpers validate encoding shape, not point validity, ownership, or signatures. A Noise key with the same shape cannot become a Nostr key merely by passing a regex.

Brands prevent accidental assignment after a trusted construction boundary; assertions alone establish neither provenance nor runtime validity. Extend the existing owner for additional real ID boundaries, not a speculative parallel brand framework. Changing only a TypeScript brand does not change serialization; tightening the corresponding runtime schema can still break persisted reads and requires decision 13.

For destinations supporting several protocols, use a discriminated union with protocol-specific fields instead of a string that callers repeatedly sniff. Preserve SDK/wire field names inside their boundary model and adapt to app vocabulary once. Keep quote lookups scoped to mint and operation kind; do not assume arbitrary IDs are globally unique. Do not mechanically rewrite externally defined or persisted discriminant strings to match identifier style.

**Current examples needing care:** [DM pagination](app/features/payments/data/dmPagination.ts) accepts several timestamp representations and computes cursors from envelope timestamps; changing it requires producer and cursor-contract evidence. [peerProfile](app/features/nearPay/lib/peerProfile.ts) intentionally falls back across identity kinds for identicons/names; that fallback is display policy, not proof that all values are interchangeable keys. Earlier deslop reports about absent branding and duplicated key bridges are historical, not instructions to recreate implementations that now exist.

### Four presentation forms

| Need | Form and owner |
| --- | --- |
| Discriminant to icon/message/style descriptor | Exhaustive `..._BY_...` table with `as const satisfies Record<Discriminant, Value>` |
| Value to text | Pure `format<Noun><Aspect>` with explicit locale/time/options |
| State to rows/items/sections/frames | Pure `build<Noun>Rows`/`Items`/`Sections`/`Frames` |
| React subscription/theme/identity required | Thin `use<Noun>Rows` shell around the meaningful pure core |

Put reusable derivation in the feature's `lib/` or the lowest shared owner; JSX belongs in the relevant component/block. Keep truly small, single-use expressions local. Large switches or nested ternaries in screens are review signals, not reasons to extract every expression. A helper serving one file need not become a public API just to get its own test.

For localization, tables carry typed message descriptors/IDs and parameters rather than cached English labels. Resolve text at the presentation boundary with the active locale and the full/short layout variant from decision 9. Do not persist translated row labels or make payment state depend on display copy.

### Placement and rename review

Check shared-to-feature imports, unrelated feature-to-feature imports, deep imports bypassing a meaningful public boundary, UI buried under `lib`, independent hooks/stores outside their owning folders, non-screen files in `screens`, and extra pass-through route tiers. Large routes/screens are signals to inspect responsibility, not line-count targets. Component-private types/helpers can stay colocated; native variants and genuine package entries remain valid. Do not add barrels, relocate files, or expose internals simply to improve a detector score. Decision 1 determines ownership.

Rename one semantic cluster at a time: include callers, types, tests, mocks, and current comments; type-check and search the old spelling. Remaining matches must be accounted for as external contracts, persisted fields, historical documents, or an explicitly retained distinct meaning. Never perform a text replacement across every `pubkey`, `profile`, or `paymentRequest`: split different meanings first. Add new domain distinctions to this dictionary in the same change.

## 28. Cleanup method and evidence

**Reviewed skills:** [improve-codebase-architecture](skills/improve-codebase-architecture/SKILL.md) for requested architecture surveys; [codebase-design](skills/codebase-design/SKILL.md) for consolidation; [code-review](skills/code-review/SKILL.md) for change review. Apply [decision 29's scope and overrides](#29-project-skills-and-review-policy).

**Decision:** a cleanup removes unnecessary implementation or competing conventions while preserving observable behavior. A lower detector count is supporting evidence, not the objective by itself. This section incorporates the deslop workflow; no separate playbook is needed. Use it for an authorized code-cleanup pass, not as a reason to turn a documentation edit or small fix into a repository-wide refactor.

### Work one coherent cluster

1. Record the child repository, branch, source revision, dirty files, scope, and relevant before-state. Preserve unrelated edits. Run a fresh scoped census before claiming a reduction; historical counts do not establish today's baseline.
2. Inventory lexical clones, naming/value collisions, structural signals, unused candidates, and the actual canonical owners. Examine same-file duplication first. Optional semantic shortlisting complements lexical detection; open both full implementations before accepting a match.
3. Search beyond reported pairs for all sibling bodies/callers. Compare inputs, outputs, errors, side effects, data scope, lifecycle, platform behavior, and expected change. Apply decision 22's deletion/interface gate. Reject superficial similarities explicitly.
4. Change the smallest complete cluster. Review touched code for naming, terminology, state shape, presentation, compatibility, and placement as well as the original issue. Fix in-scope findings or record a precise reason and follow-up; an opened file does not authorize unrelated schema/security changes.
5. Search the structural body again across the affected repository/packages. A consolidation is complete when the old implementation has no unexplained survivors, including the original site. Retest the public behavior and update callers/mocks/comments together.
6. Run the relevant decision 26 checks and record actual results. Review the diff independently before accepting a substantive cleanup. Fix confirmed regressions, then repeat the affected checks. Only after validation record the lower baseline and rerun comparison mode.

For independent review, supply the actual diff and pre-change source with a concrete attack list: changed export/mocks, dropped props, callback identity, pending/unknown states, persisted acceptance, duplicate submission, cancellation, late writes, profile changes, and platform fallbacks as relevant. Record confirmed defects, plausible concerns with their resolution/revisit trigger, and tested/refuted hypotheses. A generic approval without examined failure paths is not evidence. If an independent reviewer is unavailable, report that validation gap rather than claiming an adversarial pass.

Test the shared contract where a consolidation moves responsibility. Preserve relevant regression coverage and remove obsolete implementation-specific tests with the old owner. Add meaningful missing coverage when behavior has no existing check; do not write tests that only restate a lookup or wrapper. For consequential claims about a test, temporarily break the claimed mechanism and verify the intended assertion fails, restoring only the deliberate edit. A suite that fails to load or reports zero assertions did not test the code. Reproduce unrelated failures against an isolated baseline before labeling them pre-existing.

### What to hunt and what to preserve

| Candidate | Required distinction before fixing |
| --- | --- |
| Whole-store subscriptions / unstable fallbacks | Narrow reactive selector versus legitimate imperative handler read |
| `any`, double assertions, fabricated tuples | Fix the boundary type and runtime guarantee; a callee's assertion is not validation |
| `@ts-ignore` | Prefer a narrowly justified `@ts-expect-error` for a verified platform/type gap; do not merely hide the same defect |
| Empty `catch`, `void promise` | Explicit harmless best effort versus an unhandled rejection or swallowed payment failure |
| JSON stringify/parse cloning | Immutable projection or supported clone semantics; preserve Dates, Maps, bigint, and absent values where applicable |
| Parsing/sorting in render or every row | Validate/normalize at ingress and derive incrementally; do not weaken boundary validation |
| FlatList/custom list use | Existing specialized behavior versus the shared list seam; inspect alternate import sources too |
| List migration | Stable keys, heterogeneous `getItemType`, recycled state, anchoring, refresh/pagination, keyboard and content insets; source prop parity alone is insufficient |
| Old FlashList/Reanimated APIs | Verify the installed version and actual no-op/deprecation; do not copy historical v1 props or mechanically replace working animation APIs |
| Timers/listeners/animations | Owner teardown, cancellation, focus/app/row activity; lexical add/remove counts do not prove cleanup |
| Manual memoization | Decision 20's per-file compiler and runtime evidence; never a bulk deletion |
| Unused exports/files/dependencies | Production, test, script, native, dynamic route, asset, and bootstrap reachability before deletion |
| Repeated numeric/style literals | Shared semantics versus coincidentally equal values; preserve measured/native geometry |

The existing [facadePageMaps](app/features/feed/data/facadePageMaps.ts) is a concrete shared enrichment mapper producing fresh maps. A thread adapter merging into already seeded content has a different contract; similar field names do not justify replacing it with a fresh-map builder. Apply the same distinction to QR buttons, feed versus notification rows, horizontal versus vertical layout primitives, and deferred callbacks: superficial resemblance is not equivalence.

### Removing obsolete compatibility

Look for both sides of old compatibility: fallbacks, `typeof`/array checks, parse-and-retain-raw branches, version guards, aliases, optional/union/preprocess schemas, dual writes, constant rollout flags, old-endpoint retries, legacy normalizers, and unused overloads. A `legacy` comment is a lead, not proof the behavior is dead.

Identify who can still produce each variant: current callers, deployed external producers, every supported persisted version, native platform versions, pinned dependencies, and rollout state. An absent writer in this checkout cannot prove a remote or old installed app stopped writing it. Preserve legitimate alternatives such as display-name fallbacks, accessibility-label fallbacks, live transport unions, supported older iOS behavior, and tolerant persisted reads.

Once compatibility evidence permits contraction, stop obsolete dual writes, normalize/migrate at the owned boundary, tighten the internal model, and remove dependent reader branches as one coherent change. Keep supported historical input at the boundary where needed. If the meaning or rollout is uncertain, record the uncertainty; do not infer safety from passing TypeScript.

### Existing tools and their limits

The helper executables currently live in the workspace's `skills/sovran-deslop`, outside this child repository. They remain reusable tooling; their Markdown is not required by this guide. Their paths are inspected here, but the commands were not run for this documentation consolidation. Do not create a parallel app script for an existing detector. App-owned scripts should be wired into an actual package/CI workflow.

All rows below use **`sovran-app/app` as cwd**, except the root Knip command in decision 26. The `../../skills` prefix reaches the workspace skill directory.

| Purpose | Command |
| --- | --- |
| Full app census | `bash ../../skills/sovran-deslop/scripts/deslop-census.sh` |
| Structural scan of a touched file | `bunx --bun @ast-grep/cli scan -c ../../skills/sovran-deslop/sgconfig.yml path/to/file.tsx` |
| Naming inventory | `node ../../skills/sovran-deslop/scripts/identifier-census.mjs --summary` |
| Identifier/value collisions | `node codereview/lookalikes/index.mjs --json` |
| Local shortlist, without an embedding service | `bun ../../skills/sovran-deslop/scripts/semantic-clones.ts --provider local` |
| Per-file compiler evidence | `node ../../skills/sovran-deslop/scripts/react-compiler-file-audit.mjs path/to/file.tsx` |
| Compare ratchet including lexical clones | `bun ../../skills/sovran-deslop/scripts/ratchet.ts --jscpd-report ../../skills/sovran-deslop/reports/census-YYYY-MM-DD/jscpd` |

Replace file/date placeholders with the actual changed files and report. Full census writes reports and runs its comparison gate; do not use `--update-baseline` to make a failing pass appear clean. `--quick` skips lookalikes and Knip. Neither mode runs semantic shortlisting. The local shortlist is lexical similarity, not proof of semantic/Type-4 clone detection. Any remote embedding run needs an explicitly selected provider and appropriate source-sharing authorization; `auto` can use available credentials. Never print credentials.

**Coverage limitation:** the current census/ratchet scan app subtrees (`app`, `features`, `shared`, `navigation`, `config`, where present); they do not cover the sibling `wallet/src` and `nostr/src` packages. Individual detectors also exclude different test/generated/native/vendor surfaces. Report the scan roots, extensions, exclusions, tool failures, and revision with counts. Extend a future scoped investigation to the actual owners rather than claiming the app census proves whole-monorepo cleanliness.

Default Knip includes tests, which can keep an otherwise unused implementation reachable. For a production-only investigation, start from the real root config in a scratch copy, mark verified production `entry`/`project` patterns with `!`, preserve Metro/bootstrap/route/platform/script roots, and inspect exported entry members in the private packages where relevant. Run `bunx knip --production --config <scratch-config>` from the repo root. Treat results as candidates and retain the normal run; unmarked custom patterns can produce misleading mass warnings ([Knip production mode](https://knip.dev/features/production-mode)).

### Evidence and ratchet rules

- Track duplication, suppressions, type escapes, styling debt, compiler coverage, applicable bundle budgets, and actual runtime cost independently. Do not trade a security/behavior regression for fewer lines or a better composite score. React Doctor/architecture scores are advisory; keep a performance audit distinct from a deletion pass.
- Missing, stale, malformed, skipped, or failed measurements mean **unknown**, not zero. The current census can continue after detector errors, and the ratchet can skip an absent jscpd report or tolerate unreadable count inputs. Inspect artifacts and logs before accepting its exit code. Never overwrite a baseline with a partial measurement.
- Before claiming a rule is zero, search its raw pattern without the rule's exclusions. Audit extensions, generic/namespace syntax, alternate import sources, and imported schema reachability. Count `fixed / suppressed / remaining`; moving a file outside scan scope is not a fix.
- A justified target-state `@ts-expect-error` or necessary documented platform exception is not new behavioral debt simply because a raw comment counter rises. Classify such changes explicitly and correct the metric in a separately justified tooling change; do not silently increase all budgets or disable the rule. Existing raw counters do not make this distinction automatically.
- Every suppression names the rule and reason. Put an ast-grep directive immediately above its match, with explanation positioned so the directive remains effective; verify it on that file. Keep exceptions visible beside their owner and in relevant change evidence.
- Use real before/after reports from comparable scope. Record reduced baselines only after valid checks, with all measured categories present, then rerun gate mode. A cost declared in one pass stays tracked until resolved. A falling global total cannot conceal an unfixed named cluster.
- Record the change, canonical owner, removed sites, rejected candidates, exceptions, commands/results/assertion counts, review disposition, and measurement scope in durable review evidence. A link to an untracked local ledger alone is insufficient. Keep reusable convention decisions and unresolved decision-level findings in this document; retain run artifacts separately.

This guide does not authorize committing or pushing. When a code-cleanup commit is requested, stage only the intended files in the child repo, use the current non-main branch unless directed otherwise, and include the load-bearing evidence in the commit/PR. Do not use broad staging or destructive reset commands to reproduce a skill example.

**Follow-up:** naming convergence is incremental. The old skill's findings queue is a source of candidates to revalidate, not a list of known current bugs. Tool coverage and artifact-completeness limitations above are real limitations of the inspected scripts and must be accounted for until the tooling is updated.

## 29. Project skills and review policy

**Decision:** ship a small, reviewed skill library with the repository. Source folders live in [skills/](skills), and the real `.agents/skills` and `.claude/skills` directories contain per-skill relative symlinks into them. [CLAUDE.md](CLAUDE.md) imports [AGENTS.md](AGENTS.md), which routes here. Skill contents, supporting references/assets, licenses, provenance, and links are all repository files; no global install, sibling repository, or download is needed to read them after checkout.

This layout follows [Codex's repository skill discovery](https://developers.openai.com/codex/skills) and [Claude's project skills and symlink support](https://code.claude.com/docs/en/skills). Restart an existing session if its discovery cache does not see newly added directories; new sessions discover them. Personal/enterprise configuration can still override or disable skills, so prefer this guide's exact file links when similarly named global skills exist. Installation is not proof that a particular client invoked a skill.

### What was reviewed and installed

Review date: **2026-09-10**. [sources.json](skills/sources.json) records immutable Git SHAs, upstream paths, source-file SHA-256 hashes, licenses, local additions/adaptations, and repository-star snapshots. Stars belong to entire repositories, not individual skills, and are a shortlist signal rather than a quality or safety rating.

| Source repository | Stars when checked | Result for Sovran |
| --- | --- | --- |
| [Matt Pocock](https://github.com/mattpocock/skills) | 258,476 | Seven engineering/design skills; strong interface and behavior-testing methods, with local workflow mappings below |
| [Impeccable](https://github.com/pbakaus/impeccable) | 67,030 | Selected copy/native-review ideas adapted into two owned skills; full launcher package not installed |
| [Vercel agent skills](https://github.com/vercel-labs/agent-skills) | 31,032 | React Native, composition, and writing entrypoints reviewed; not installed because of overlap and the specific conflicts below |
| [Expo](https://github.com/expo/skills) | 2,514 | Router skill installed for routing mechanisms; broad native-UI/new-project defaults not adopted |
| [Callstack](https://github.com/callstackincubator/agent-skills) | 1,642 | Native performance skill installed for measurement, profiling, memory, bundle, and list investigations |
| [Gentleman Skills](https://github.com/Gentleman-Programming/Gentleman-Skills) | 650 | Zod/Zustand recipes reviewed; replaced by project-authored workflows based on primary API docs and our persistence contract |

The review read installed entrypoints, key linked references, executable/agent metadata, source layout, licenses, and project conflicts. It also read the Impeccable playbooks named in the adaptation manifest. It did not run every sample, validate every linked upstream article, or establish that a skill improves model performance on a benchmark. The next update must be reviewed again; popularity does not bypass that step.

One optional “Related Skills” link in Callstack's `native-platform-setup.md` points to its separate `upgrading-react-native` package, which is not installed. For this Expo app, use the [official Expo upgrade walkthrough](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) and target-SDK release notes instead. Example `src/ordering/CONTEXT.md` links in Matt's glossary template are illustrative placeholders, not missing project dependencies. Core references for the selected workflows are bundled locally.

| Installed skill | Useful scope | Sovran-specific application |
| --- | --- | --- |
| [codebase-design](skills/codebase-design/SKILL.md) | Matt's deep modules, interfaces, deletion test, alternative designs | Decisions 1/22/28 govern actual ownership and safe consolidation; its bundled design-it-twice reference replaces a separate duplicate skill |
| [improve-codebase-architecture](skills/improve-codebase-architecture/SKILL.md) | Scoped architecture survey and comparison report | Use when an architecture review is requested; do not start a repository-wide interview during a small fix |
| [domain-modeling](skills/domain-modeling/SKILL.md) | Resolve overloaded domain terms and meaningful ADRs | Write the domain dictionary in decision 27 and decisions here; existing ADR home is `app/docs/adr` |
| [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) | Reproducible failure signal, minimized case, hypotheses, regression | Native/E2E/protocol fixtures and redacted logs; browser examples apply only to web surfaces |
| [tdd](skills/tdd/SKILL.md) | Behavior-first tests and small red/green slices | Use established public contracts and correct workspace runner; no blanket test requirement for copy-only edits |
| [code-review](skills/code-review/SKILL.md) | Independent standards-versus-requirements review | Standards source is SYSTEM.md; user task/linked issue is the requirement source; include intended working-tree changes when reviewing WIP |
| [grilling](skills/grilling/SKILL.md) | Explore unresolved consequential design decisions | Use only for an intended interview; ask one concise decision at a time through the available question tool |
| [expo-router](skills/expo-router/SKILL.md) | Route groups, stack/tab/sheet/link/header mechanics | Existing Expo version, route map, page containers, and platform capabilities govern implementation |
| [react-native-best-practices](skills/react-native-best-practices/SKILL.md) | Callstack's measured React/native/bundle performance workflow | Apply the relevant reference only; retain Sovran's Compiler, cache, bootstrap, and dependency rules |
| [sovran-zod](skills/sovran-zod/SKILL.md) | Input/output contracts, safe parsing, durable schema evolution | Owned workflow grounded in decisions 13/27 and official Zod docs; no web-form scaffolding |
| [sovran-zustand](skills/sovran-zustand/SKILL.md) | Native store scope, selectors, hydration, async ordering | Owned workflow grounded in decisions 12–14 and official Zustand docs |
| [sovran-app-copy](skills/sovran-app-copy/SKILL.md) | In-app actions/errors/empty states, translation and truncation | Native adaptation of Impeccable copy principles; preserve payment truth and shared catalog semantics |
| [sovran-native-ui-review](skills/sovran-native-ui-review/SKILL.md) | Native UI consistency, task clarity, accessibility and edge cases | Native adaptation of selected Impeccable guidance through existing Sovran tokens/components |

### Explicit adaptations and rejected defaults

These decisions override conflicting examples in the imported skills. Read them before applying a skill, including one auto-selected by an agent.

- **Matt's document names:** `CONTEXT.md` means this guide's domain dictionary for this project; do not create another glossary. `docs/adr` maps to `app/docs/adr`. Architectural terminology helps reasoning; it does not require replacing React's word “component” or every use of “boundary.” A single adapter can still protect a real native/security/persistence contract. Preserve meaningful regression coverage when replacing shallow tests.
- **Matt's workflow assumptions:** no mandatory setup wizard, issue-tracker configuration, or new documentation hierarchy. For code review, use the supplied task/issue and correct diff scope; the upstream three-dot committed diff alone misses staged, unstaged, and untracked WIP. Established interfaces and authorized scope satisfy routine test planning; do not repeatedly request permission for existing seams. Interviews keep the project's one-question-at-a-time policy, not the upstream multi-question frontier format. Use available agent tools where a workflow calls for delegation; if unavailable, report that review limitation rather than inventing a completed independent review. A review does not authorize creating issues, committing, or contacting anyone.
- **Expo Router:** preserve PascalCase component filenames and required special route names. The skill's “no special characters” sentence does not override `(groups)`, `[params]`, `_layout`, or special Router files. Some reference examples still use older native-tab APIs; inspect installed declarations before copying. Do not add frequent link previews to payment routes, duplicate safe-area adjustment, replace the icon registry, or change navigation to match a starter example. Do not run its external feedback command without explicit authorization to send that message.
- **Callstack:** use the app's Expo/Metro commands and native development build, not a bare React Native bundle recipe or assumed Expo Go compatibility. DevTools/manual profilers are available alternatives to optional `agent-device`/inspector packages; do not install those automatically. The atomic-state examples are not a reason to add Jotai or remove Zustand because Compiler is enabled. Verify APIs against installed versions, retain measured memos, preserve crypto/Intl/bootstrap requirements, and follow decision 21 before preloading anything. Remote chunk delivery and beta Compiler setup are not selected app architecture.
- **Impeccable:** its task-focused `operate`, copy, native audit, and edge-case review principles are useful. The full 4.3.1 package runs a context launcher that can download a binary and supports hooks/additional product/design documents. That machinery is outside this installation. The two owned adaptations have no launcher, scripts, hooks, or automatic handoffs. They preserve Sovran's fonts, tokens, icon registry, component owners, and supported-platform exceptions rather than requiring SF Symbols/system fonts everywhere. Native verification replaces web DOM/CSS/200%-zoom recipes. Generic HTTP-status copy, “always show a specific error,” and decorative novelty do not override source-aware errors or wallet uncertainty.
- **Generic Zod/Zustand tutorials:** the reviewed Zod entrypoint mixes migration claims with still-supported syntax, generic coercion, nondeterministic defaults, and browser form examples; it does not cover Sovran's whole-blob persistence hazard. The Zustand entrypoint includes a whole-store introductory subscription, browser-default persistence, and an async action without HTTP status/cancellation/order handling. Those are poor defaults here even though later sections contain useful selector advice. The owned workflows use primary documentation and the actual project owners instead.
- **Other broad packs:** Vercel's native entrypoint recommends blanket item memoization, `Gesture.Tap` in place of presses, and new UI packages, overlapping our narrower choices. Its composition skill is useful in principle, but Matt's interface method and existing component decisions already cover the need. Its writing skill targets Vercel editorial voice, not wallet microcopy. Expo's new-project structure skill explicitly excludes existing apps; its broad UI skill rejects Tailwind/Uniwind and assumes component/font/color choices that conflict with this app. Generic web CSS/Next.js/landing-page packs are not installed just because they are popular. App-store marketing copy is a separate task from in-app instructions and payment messages.

No imported skill is the authority on Nostr signatures, Cashu settlement, key custody, or persisted recovery. Protocol sections link modeling/diagnosis methods where useful; their actual domain rules remain the source-backed decisions here. Do not install a social-posting Nostr automation skill as if it reviewed transport or wallet correctness.

### Reproducible installation and updates

From the repository root:

```sh
python3 skills/manage.py check
python3 skills/manage.py link
```

`check` verifies entrypoints, manifest names, pinned upstream file hashes, license presence, and both discovery link trees. `link` validates the sources first, creates missing links, and refuses to overwrite ordinary files or unexpected links; it does not delete unrelated contributor skills. Both use only the Python standard library and work without `node_modules` or network. Git must preserve symlinks for zero-setup discovery; on a checkout that materializes links as text files, enable symlink support and restore the repository links before use. The checker reports that mismatch instead of overwriting it.

To refresh an upstream skill, fetch its new immutable revision into a scratch directory, inspect the diff and referenced resources, reconsider its conflicts/permissions/license, then replace only the approved source folder. Preserve full required reference/asset closure and the upstream license, update `sources.json` hashes/provenance and this review table, and rerun the checker. Do not use a floating global `skills update`, package postinstall download, or a symlink outside this repository as the contributor installation. Do not hand-edit upstream files to hide conflicts; keep project adaptations explicit here or as clearly attributed owned skills.

When adding a skill, require a concrete uncovered task, precise trigger, usable offline instructions, compatibility with installed Expo/React Native/Zod/Zustand, a clear source/license, and inspection of scripts, hooks, command substitution, remote downloads, and external mutation instructions. Popularity alone is insufficient. Reuse an existing skill if it already supplies the method. Behavioral usefulness still needs observation on real tasks; file-hash verification does not establish advice quality.

The original deslop census executables in decision 28 are **optional workspace tooling**, not part of this standalone skill installation. In a standalone checkout, use the repository's normal checks plus scoped source/clone investigation; report unavailable census coverage rather than claiming a full census passed. Do not recreate a dependency on the contributor's personal workspace to make the guide usable.

## Exceptions that should survive a consistency pass

| Exception | Why it exists | Boundary / review condition |
| --- | --- | --- |
| Thread/chat/transaction specialized list owners | Anchoring, bottom-stick, animation, or sheet injection | Preserve shared inset contract and focused list tests; do not force plain `List` if it loses behavior |
| Native versus docked tab geometry | Different viewport ownership | Shared inset provider decides; screens do not duplicate OS arithmetic |
| Native SF Symbols and multicolor SVG art | Navigator/native API or genuinely multicolor artwork | Ordinary feature icons still use the registry |
| JS styles at native/animated/measured seams | Class strings cannot express every runtime consumer | Keep exception at the owning seam and within the styling ratchet |
| Flat/blur/glass implementations | Different supported capabilities and native imports | Shared props; fallback remains functional |
| `Screen deferContent={false}` for seeded/immediate content | Prevents blank first frame or delayed input focus | Use only when first-frame behavior requires it |
| Wallet transport timeout differs from app timeout | Different request semantics | Validate user responsiveness; no arbitrary global unification |
| NDK cache, facade entities, query pages, Coco DB | Different data/protocol authorities | Explicit ingress/mirror relationship, no competing authority |
| Optional background delivery after screen exit | Mesh/DM/payment completion contract | Stop discovery/visual overhead separately from transport work |
| Existing manual memoization | Compiler output and external subscription identity | Change only with targeted evidence |
| SDK-native errors and established throw APIs | Existing library/control-flow contract | Adapt at boundaries; never drive logic with translated prose |
| Private synchronous decrypt cache timing | Existing early-read behavior | Timing is legitimate; unencrypted durable plaintext is a gap to fix |

## Follow-up register

The order below prioritizes data correctness/privacy, then cross-cutting contracts, then presentation/tooling cleanup. “Confirmed” means the source behavior was inspected; it does not claim a reproduced production incident. “Review” means the risk requires tracing/testing before a fix. No item was implemented in this audit.

| ID | Priority / evidence | Follow-up and owner | Done when |
| --- | --- | --- | --- |
| F01 | High, confirmed helper behavior | Add request generations/invalidation to [query cache](app/shared/lib/cache/createQueryCacheStore.ts); audit scope capture with [profile storage](app/shared/lib/cashu/profileScopedStorage.ts) | Older forced read cannot overwrite newer data; clear/profile change rejects late writes; deterministic regressions pass |
| F02 | High, confirmed storage choice | Remove durable plaintext from [NIP-04 cache](app/shared/lib/nostr/nip04Cache.ts), or implement an explicitly justified encrypted/retained private-cache design | Safe cache migration, offline behavior, profile isolation, and plaintext-at-rest tests/documentation |
| F03 | High, review of confirmed conversion behavior | Separate display coercion from strict amount validation in [cashu/amount](app/shared/lib/cashu/amount.ts) | Invalid/unsafe/fractional values cannot authorize a spend; all affected callers classified |
| F04 | High, confirmed presentation bypass | Route [username claim](app/features/onboarding/screens/ClaimUsernameScreen.tsx#L348), [export alert](app/features/settings/screens/SettingsScreen.tsx#L236), and [deep-link error](app/features/send/providers/Colada.tsx#L571) through source-aware presentation | No raw upstream detail reaches those surfaces; original error preserved; classification tests cover unknown values |
| F05 | High, review | Define critical-store behavior on [merge rejection](app/shared/lib/persist/createMergeWithSchema.ts) | Corruption cannot silently initialize/overwrite authoritative identity or funds state; unaffected preferences preserved |
| F06 | Medium, confirmed result collapse | Preserve failure/degraded metadata through [facadeFeedClient](app/features/feed/data/facadeFeedClient.ts) | Empty, failed initial load, failed refresh, and seeded thread states remain distinct and terminate loading |
| F07 | Medium, new shared capability | Implement decision 9's locale service, compiled catalogs, typed messages, and layout metadata | UI/error/wallet/native copy follows one locale policy; constrained messages pass native large-text/RTL/pseudolocale checks |
| F08 | Medium, confirmed semantic inconsistencies | Fix [date](app/shared/lib/date.ts) locale/day/debug-format contracts with the locale migration | True serialization separate from display; calendar-day/DST/invalid-time/locale tests pass |
| F09 | Medium, confirmed producer exceptions | Reconcile [apiClient schema extensions](app/shared/lib/apiClient.ts) with shared schema/producer contracts | Nullable/missing data retains useful fields; no unexplained local wire divergence |
| F10 | Medium, confirmed limits gap | Bound/cancel queued [image prefetch](app/shared/lib/imageCache.ts) and test boot-gate abandonment | Queue cannot grow indefinitely; old scope work is discarded; first paint and image loading recover |
| F11 | Addressed in release audit | [setup-sovran](.github/actions/setup-sovran/action.yml) defaults to frozen installs; external refresh is explicit | Linux PR execution and enforced branch checks still require verification |
| F12 | Medium, confirmed refresh gap | Repair [Marmot vendor source/provenance](app/scripts/vendor-marmot-ts.sh); inventory native vendor/patch ownership | Known revision and mandatory license; repeatable clean refresh; native required inputs fail closed |
| F13 | Medium, review | Audit facade rebuild disposal/private snapshot flush ordering in [buildNostrDataLayer](app/shared/lib/nostr/buildNostrDataLayer.ts) | Identity/tier changes leave no old listener or late write targeting new scope |
| F14 | Incremental, confirmed mixed syntax | Migrate static styling and alias inconsistencies within touched screens | Styling ratchet decreases without layout drift or removing native/animated seams |
| F15 | Incremental, review | Add asset provenance/retention and per-surface image/font policy | Source/license/generator known; translated glyphs render; row images avoid inappropriate long fades |
| F16 | Incremental, coverage gap | Expand accessibility, reduced-motion, and runtime performance scenarios | Device evidence for focus, text scaling, offscreen work, supported fallback OS, and release-mode performance |
| F17 | Documentation, partly addressed | Deslop conventions are consolidated here; align remaining skill routing/ADRs with this guide, current workspaces, Bun patches, store paths, blocking tests, and active release scripts | Skills route to this convention reference instead of restating competing app rules; historical ADR statements clearly dated; source links valid |
| F18 | Medium, confirmed portability gap | Repair tracked package commands that depend on ignored local launchers in [app/package.json](app/package.json) and [app/.gitignore](app/.gitignore) | Documented startup works from a fresh checkout without undisclosed machine-local scripts or secrets |
| F19 | Incremental, naming review | Apply decision 27 to coherent clusters; reuse [protocolIds](app/shared/lib/protocolIds.ts) and inspect overloaded payment/profile/key/time names before renaming | Every value has a verified meaning/representation; all callers and mocks updated; persisted/wire compatibility preserved; remaining historical candidates explicitly classified |
| F20 | Tooling, confirmed coverage/evidence limits | Make cleanup measurements cover the intended packages and reject incomplete artifacts, as detailed in decision 28 | Scope includes each touched owner; missing detector output cannot look clean; all baseline categories survive updates; justified exceptions are classified rather than hidden |
| F22 | High, coverage gap | Enforce decision 26 for existing routes, aliases, gestures and modal exits on both platforms | Each route has a named native journey or explicit capability gap; a screenshot gallery is not whole-app coverage |
| F21 | Medium, confirmed mixed truncation | Consolidate [strings.ts](app/shared/lib/strings.ts), the local [DetectedActionRow](app/features/send/components/DetectedActionRow.tsx) helper, and affected display/copy callers under decision 9's content policies | No lengthening at thresholds, one ellipsis/profile vocabulary, appropriate head/middle/tail behavior, unchanged full payloads, and native large-text/RTL/accessibility verification |

### Rules for the next implementation pass

Fix one coherent boundary at a time. First reproduce/characterize the affected contract, then change its owner and callers together, add the relevant regression, and mark the specific follow-up complete with evidence. Do not mix schema migration, provider teardown, visual cleanup, and dependency replacement into one blanket “consistency” change.

Keep useful current patterns. The aim is fewer ways to accomplish the same behavior, with explicit exceptions where behavior differs. Do not treat this document's recommended architecture as evidence that unfinished infrastructure already exists.

### Validation of this document

Local source-link targets and section anchors were checked, along with whitespace and table/fence structure. The deslop consolidation checked current protocol-ID/presentation examples and detector paths against source. The skill installation checked upstream snapshots, licenses, all skill/agent YAML metadata, relative links, and operation in a standalone temporary copy, including missing-link repair, content-tamper detection, and refusal to overwrite contributor files. The four owned skills also passed the skill-creator validator; optional upstream cross-skill/template links are classified in decision 29. Truncation behavior was source-inspected; its new policy has not been implemented or device-tested. Historical skill counts and unresolved claims are not reported as fresh audit results. Application tests, native builds, and cleanup censuses were not run for these documentation/contributor-tooling changes. No npm dependencies were installed. External references establish framework/protocol guidance, not runtime verification of Sovran or measured effectiveness of the skills.
