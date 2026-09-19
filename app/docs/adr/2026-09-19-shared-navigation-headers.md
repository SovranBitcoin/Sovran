# Shared gradient and identity navigation headers

Status: accepted for implementation; native validation tracked separately.

The app mixed opaque page colors, native blur, page gradients and one bespoke
Connected Apps identity animation. Amount-entry recipient titles exceeded the
Android title row, and settings reused modal-specific geometry.

Keep the native navigation actions and route stack. `Screen` paints the gradient
behind the transparent bar; `FlowSheetHeader` owns it inside Android sheets.
The shared navigation options disable iOS 26 automatic top scroll-edge masking
so it cannot overlap the app gradient. Use navigator header geometry and one explicit content inset on both platforms,
including measured sticky selectors. This replaces the fixed 70pt iOS modal
assumption; native present-time geometry must be checked for layout shifts.

Extract the Connected Apps two-phase, hysteretic identity handoff. Compact avatar
and title use one row, timing respects reduced motion, and scroll work stays in
Reanimated. Custom list owners forward their scroll signal without replacing
existing image-overlay or embed tracking. Payment amounts/actions never fade.

Receive tabs become pinned. Amount mint selection uses the existing bottom slot.
Design-system Headers demonstrates the variants without invoking wallet operations.
Hunch reviews continuity/reachability; deterministic source restrictions belong
in the glass-header gate. Camera and immersive media retain their transparent
or absent chrome.


## Validation record — 19 September 2026

Workspace type checks (including iOS and Android), app lint (zero errors), both
Metro platform exports, styling and React Compiler ratchets, the glass-header
guard, E2E JSON validation, Hunch config validation and `git diff --check` pass.
Lint retains warnings; Metro retains upstream package-export warnings. No new
dependencies, commits or publication are part of this change.

The focused Jest runs cover scroll insets, measured sticky content, identity
threshold/reversal, receive rails, amount constraints, Lightning dismissal,
mint routes, thread embeds, contact error states and notification paging. The
header gallery and component inventory snapshots pass; the E2E capture registry
uses the canonical page count rather than a fixed total.

The native `headers` suite is registered and validates as JSON, but has **not
passed on a device**. iOS lacks an installable entitled `com.sovranbitcoin.dev`
build. Android launched an isolated harness emulator and the development APK,
but the onboarding fixture stopped at Terms acceptance before entering the
gallery. The failed screenshot is in
`app/e2e/artifacts/run-2026-09-19T20-56-19-653Z-710f98a4/settings.headers/001-P05-tapUntil.png`.
The temporary emulator was shut down. Track the remaining visual checks in
[F23](../../../docs/architecture/follow-ups.md), including P2PK's intermittent
body-text disappearance, which was not reproduced or proven fixed.

Hunch 0.13.1 discovery inspected 4,460 chunks (4,460 requests, 12,658,997 input
tokens); the oversized generated analysis script was not searched. The required
`hunch check --base origin/main` reviewed 130 hunks with 381 requests and
2,738,167 input tokens. It returned incomplete coverage: the renamed gradient's
deleted hunk needs human review, several isolated changes lacked context, and
one file changed during review. Subsequent focused checks covered the final
header implementation, new files, navigation options and tab insets. The latest
tab-inset review completed with no findings (13 requests, 30,368 input tokens).

The overlay-order and moved-Receive-tabs candidates were checked against the
whole implementation: the native scroller stays first, noninteractive gradient
overlays follow it, and `stickyContent` receives the moved selectors. Measured
inset tests pass. A generated rule initially flagged the shared morph itself;
its scope now targets screen-local implementations. The regenerated lock retains
unchanged compiled rules and adds the new convention rules. These reviews are
not a complete semantic or native-visual pass. Across the recorded discovery
and review runs: 5,143 requests and 16,243,241 input tokens. JSON reports are in
`/tmp/sovran-header-*.json` on the development machine.


## Correction after iOS feedback

The first pass reserved one header height but rendered `ScrollEdgeFade` at twice
that height. Its color ramp ended at the reserved boundary, but its native iOS
blur mask extended another full header height over resting content and root
tabs. Previously the fixed 70pt geometry/native inset combination hid much of
this mismatch. The earlier inset tests mocked the fade away and missed it.

A renderer regression now compares the actual fade prop to the resting content
boundary in auto, animated and custom layouts: all three failed with 208pt of
blur over 104pt of clearance before the correction. The fade is now bounded by
the reserved header height. Content enters that region only as it scrolls up.
Receive's sticky rail/mode tabs use a solid header/tab band; Feed, Contacts and
Notifications use the same explicit opaque appearance around their fixed filters.
Android sheets render the solid variant without reserving a gradient overhang.
The gallery demonstrates the opaque sticky-tab variant alongside gradients and
identity transitions. No per-screen top-margin workaround was added.

This regression is verified at the shared rendered-layout seam; native iOS
appearance and the Android comparison still require device validation (F23).


Correction checks: 34 focused tests pass, including the failing-before-fix iOS
fade bounds, solid pinned chrome on both platforms, and Android sheet appearance
switching/clearance. Full app lint passes with warnings and zero errors.
Workspace types, both Metro exports, styling/compiler
ratchets and E2E JSON validation pass. Hunch's focused continuity review used
25 requests and 67,982 input tokens; it returned no findings but abstained on two
isolated hunks, so coverage remains incomplete. No iOS simulator was booted and
no development app was found under `app/ios/build` during this correction.


## Settings scrolling viewport correction

Settings and 18 sibling screens used a `safeArea` frame around their entire
scroll view. The frame reserved space correctly at rest but prevented content
from ever moving behind the header, making a configured gradient appear solid.
The initial header census checked colors and inset amounts, not this viewport
relationship, and missed it.

`Screen safeArea="scroll"` now publishes header clearance to `ScreenScrollView`
and `List screen`. One shared hook adds that clearance to local content padding;
the viewport itself remains full height. Fixed frames remain for the explicit
opaque root filters. Settings, its sibling pages, follower/mint history and the
Network list use scrolling clearance. Network's subtitle is a list header.
Existing refresh, keyboard, recovery and Settings actions stay with their owners.
The header scenario captures Settings both at the top and after scrolling.

A failing-before-fix renderer test checks the actual scroller's content padding
and all viewport ancestors, with both iOS and Android header contexts. A detail
list regression also preserves its local 12pt top gap and bottom inset once.
Android solid sheet chrome now renders inside FlowSheetHeader rather than through
native headerBackground, which would introduce an elevated duplicate over controls.
Native visual confirmation remains outstanding; these are rendered-layout tests,
not screenshots from a device.


Settings correction checks: 56 focused tests and 91 design-system tests (80
snapshots) pass. The focused Hunch continuity review completed with no findings:
80 requests, 228,582 input tokens. The rule now covers a fixed viewport that
prevents an advertised gradient from receiving scrolling content. Styling and
React Compiler ratchets, the header guard and E2E scenario validation pass.

Final workspace types, full app lint (zero errors; warnings retained), and both
iOS/Android Metro exports also pass for the Settings correction.


## Thread, horizontal strips and identity timing

Thread's embed sheet had its entire viewport positioned below navigation. Move
header clearance into the list; use FlashList's negative initial `viewOffset`
(the installed implementation adds it to the target coordinate) so an anchored
reply still lands below the bar. Identity progress accounts for the list's first
item offset. Middle/inline sheet snaps now use full-screen coordinates, preserving
their visible destinations; expanded content can scroll behind navigation.
Native reply anchoring and embed gestures still need visual validation.

`gradient-tabs` paints one color/blur fade across the measured bar plus horizontal
currency/month strip, with transparent tab containers above it. It is used by
Transactions, Select/Add Mints and distribution; Receive keeps its solid rails.
The gallery includes Tab fade and the native scenario operates a currency tab.
Android sheets delegate the combined fade to Screen instead of painting another.

Profile activation now waits for the measured full profile header instead of the
avatar's lower edge. Visual morph state and profile gradient opacity stay in
Reanimated; only an isolated development probe publishes React state. A renderer
replay of offsets 0/77/100/55/0/80 produced three owner rerenders before the fix
and zero after. Mint Info now uses Screen's UI-thread animated scroll container,
eliminating its JS callback for header animation. Profile media-offset accounting
is preserved. These checks establish less React/JS work, not improved device FPS:
no agent-device profiler or booted simulator was available in this session.


Thread/tab/identity validation: 152 tests and 80 existing snapshots pass, including
new failing-before-fix viewport, combined-fade and owner-render regressions.
Workspace types and styling/compiler ratchets pass. The Hunch diff review used
83 requests / 293,191 input tokens and was incomplete; it flagged Mint Info's
removed custom scroller with low confidence. Whole-file follow-up on the shared
owner, Mint Info, profile and thread sheet completed with no findings (27 requests
/ 140,242 input tokens). Source review confirms Screen's animated scroller now
owns Mint Info's inset and scroll signal. The explicit header-scroll-work rule
permits isolated dev probes and necessary media-offset bookkeeping.

Final app lint reports zero errors, and both iOS/Android Metro exports pass.
The final focused rerun passes 36 tests, including an additional assertion that
the animated profile fade fills its overlay without intercepting touches.
Native appearance, frame timing, reply anchoring and embed gestures remain
unverified; successful exports and renderer tests do not establish those results.


## Pre-PR validation

The full workspace run exposed incomplete Reanimated/Screen mocks in four
existing transaction, thread and Send suites. Updated their mock interfaces;
the existing payment/navigation assertions remain unchanged. The new gallery
also adds one scenario and two platform pairs: updated the coverage ledger and
explicit runner/viewer/audit counts to 158 scenarios / 274 pairs. Capture inventory
keeps an explicit 102-page assertion.

All 470 app suites pass (4,609 tests, 166 snapshots), as do 1,319 wallet tests,
335 Nostr tests and the copy workspace. Native harness contracts pass 736 tests;
the separate viewer matrix and focused capture inventory pass as well. Workspace
types (including both app platforms), formatting, Knip, styling/compiler/header
guards, E2E validation, release tests, copy checks and asset checks/tests pass.
Full app lint reports zero errors and 159 warnings; both Metro exports pass.
Native visual and frame-timing gaps above remain open.

Hunch review: the full diff run was incomplete (one deleted-file notice and
insufficient context in Mint Info, Connected Apps and profile); it returned two
low-confidence continuity candidates in Notifications layout and Mint Info.
Source tracing confirms Notifications delegates to the opaque Screen/filter
layout and Mint Info delegates inset/scroll ownership to Screen. Whole-file
follow-up on these callers and shared owners completed with no findings or
notices (44 requests). Review of the final test/harness corrections returned no
findings but retained a rename-only notice for HeaderGradient; inspected that
rename directly. The full review is not described as clean automated coverage.
Combined pre-PR Hunch usage: 829 requests, 5,959,797 input tokens.
