# Follow-ups

Open work carried over from the 2026-09-10 convention audit (formerly the
follow-up register in `SYSTEM.md`, now replaced by the rules in
[hunch.config.ts](../../hunch.config.ts)). "Confirmed" means the source behavior
was inspected, not that a production incident was reproduced. Fix one boundary
at a time: characterize the contract, change the owner and its callers together,
add the regression, then remove the item here.

| ID | Priority | Work | Done when |
| --- | --- | --- | --- |
| F02 | High, confirmed | `app/shared/lib/nostr/nip04Cache.ts` persists decrypted DMs in AsyncStorage. Make plaintext memory-only, or design encrypted storage with retention. | Safe key migration; no plaintext at rest; offline and profile-isolation tests |
| F03 | High, review | `app/shared/lib/cashu/amount.ts` mixes display coercion with validation (`amountToNumber` maps bad input to 0; `toSafeSatAmount` truncates). Separate them. | Invalid, unsafe or fractional values can't authorize a spend; callers classified |
| F04 | High, confirmed | Raw exception text reaches UI in `ClaimUsernameScreen`, the Settings export alert and the Colada deep-link popup. Route through `describeError`/popup failures. | No raw upstream detail on those surfaces; original error preserved |
| F05 | High, review | `createMergeWithSchema` falls back to defaults on rejection, including for critical stores. | Corruption can't silently reset identity or funds state; unrelated preferences survive |
| F07 | Medium | No app-wide i18n yet. Chosen direction: one locale service, Lingui with build-time compiled ICU catalogs, `expo-localization` for device preferences, wallet copy integrated through its existing resolver. Verify versions and `Intl` support on Hermes first. | UI, errors, wallet and native copy follow one locale policy; pseudolocale, RTL and large-text checks pass |
| F08 | Medium, confirmed | `app/shared/lib/date.ts`: the `iso` style isn't ISO 8601; `chat-bubble` "Yesterday" uses 24/48-hour windows; the locale resolver treats `'en'` as system. | Serialization separate from display; calendar-day, DST, invalid-time and locale tests |
| F09 | Medium, confirmed | `apiClient` relaxes shared profile schemas locally. Reconcile with `@sovranbitcoin/schemas` and the producer. | No unexplained local wire divergence |
| F10 | Medium, confirmed | `imageCache` prefetch has no queue cap or caller cancellation. | Bounded queue; old-scope work discarded; boot-gate abandonment tested |
| F12 | Medium, confirmed | `app/scripts/vendor-marmot-ts.sh` resolves a missing source and records no revision or license. | Known revision, mandatory license, repeatable refresh |
| F13 | Medium, review | Facade rebuild disposal and profile snapshot flush ordering in `buildNostrDataLayer`. | Identity or tier changes leave no old listener or late write |
| F14 | Incremental | Static `StyleSheet.create` and inline styles remain; migrate touched screens through the styling ratchet. | Ratchet decreases without layout drift |
| F15 | Incremental | Asset provenance, cache retention, and per-surface image transitions (the 1 s default delays dense rows). | Source and license known; row images avoid long fades |
| F16 | Incremental | Accessibility, reduced-motion and release-mode performance scenarios on devices. | Device evidence for focus, text scaling and offscreen work |
| F18 | Medium, confirmed | `dev` and `dev:wda` call `app/scripts/dev.sh` and `start-wda.sh`, which are git-ignored. | Startup works from a fresh checkout |
| F19 | Incremental | Apply the naming rules to overloaded payment, profile, key and time names, one cluster at a time. | Callers, mocks and persisted/wire names accounted for |
| F20 | Tooling | Cleanup measurements skip `wallet/src` and `nostr/src` and can pass on missing detector output. | Scope covers each owner; missing output fails |
| F21 | Medium, confirmed | `truncateMiddle` in `strings.ts` can lengthen strings and uses three periods; `DetectedActionRow` has its own helper. Converge on compact (8+8) and detail (12+12) profiles with one `…`. | No lengthening at thresholds; copied and signed values byte-identical |
| F22 | High, coverage gap | Not every route, alias, gesture and modal exit has a native journey on both platforms. | Each route has a journey or an explicit capability gap |
| F23 | High, native validation gap | [Shared navigation headers](../review/header-contract.md), decision recorded in `app/docs/adr/2026-09-19-shared-navigation-headers.md`: iOS harness lacks an installable entitled dev client; Android stops at Terms acceptance before the header gallery. P2PK title space/insets were corrected, but disappearing body text was not reproduced. | Run `headers` suite on both platforms; inspect named screens, large text, reduced motion, long names and iOS modal presentation shifts; reproduce and resolve any remaining P2PK disappearance |
