# 21. A build chooses its modules

Date: 2026-09-29
Status: Proposed. The core and first surfaces are wired; the rest is listed below.

Sovran must be shippable in narrower shapes: a Lightning-only wallet, an
on-chain-only one, ecash and Lightning without the social layer, or the full app
with a single module removed, such as ecash over DMs or Nostr search.

## Decision

`app/shared/config/features.ts` owns one **feature set**. It is a frozen record
of switchable modules: the rails `ecash`, `lightning`, `bolt12`, `onchain` and
`paymentRequests`; the Nostr modules `nostr`, `nostrSearch`, `ecashMessages`,
`contacts` and `feed`; the proximity modules `nfc` and `nutDrop`; and `ai`.

- **Chosen at build time.** `EXPO_PUBLIC_SOVRAN_EDITION` names an edition:
  `full` (the default), `lightningOnly`, `onchainOnly`, `ecashLightning` or
  `private`. `EXPO_PUBLIC_SOVRAN_FEATURES` applies JSON overrides, for example
  `{"ecashMessages":false}`. An EAS profile or `.env` picks both.
- **Not a user setting.** Nothing is persisted, so changing an edition can never
  break a stored schema. A user-facing toggle would be a separate settings field
  that can only narrow the build's set further.
- **Dependencies resolve downwards.** A module whose requirements are off is
  switched off: no `nostr` means no search, DMs, contacts or feed, and no `ecash`
  means no DMs, NFC, Nut Drop, payment requests or AI. A set with no rail left
  throws. So do unknown editions and unknown override keys, which fail the build.
- **One seam per package.** The app filters its surfaces with `hasFeature`. The
  `wallet` package never imports the app. Instead, `applyFeatureSetToWallet()`
  runs once in the root layout and calls `configureEnabledPaymentMethods`. That
  makes `isMethodImplemented` report disabled methods as unavailable everywhere
  availability is computed, including screen actions and mint selection.
- **Surfaces declare their module.** A list entry carries its `feature` rather
  than branching inline. This holds for tabs, receive tabs, and the send and
  receive hub rows.

Ecash stays the custody layer in every edition, because the Coco mints hold the
funds. `ecash: false` removes bearer-token surfaces, not the mint wallet.

## Wired

- Tabs (`(tabs)/_layout.tsx`): feed and notifications (`feed`), contacts, and ai.
- Receive tabs (`computeReceiveTabs`): Unified appears only over two or more rails.
- Send hub: create ecash, NFC and Nut Drop. People search is blanked unless
  `nostrSearch` is on. DM delivery is armed only when `ecashMessages` is on, so
  without it a contact is paid over Lightning.
- Receive hub: fixed amount (`lightning`), paste (`ecash`) and Nut Drop.
- Send token screen: the NFC button.
- Settings: Network, Remote Login and Moderation (`nostr`), and My media (`feed`).
- Routes (`shared/lib/nav/featureRoutes.ts`): the root layout's guard sends any
  navigation into a disabled module back to the wallet, whether it arrives from
  a deep link, a notification or a stale push. Transaction history and settings
  are exempt, so a past payment stays viewable.
- Input (`shared/config/featureDetectors.ts`): Colada and the send screen parse
  with detectors that are blind to disabled modules. A token scanned in a
  Lightning-only build therefore reads as unsupported instead of starting a
  flow the build cannot finish.
- Providers: `BitchatBLEProvider` mounts only with `nutDrop`.
- Wallet: method availability through `isMethodImplemented`, which also covers
  on-chain addresses, since those are parsed without detectors.

## Deliberately not gated

- The Nostr key and NDK providers. Wallet features, P2PK locks and payment
  requests derive from the same keys, so they stay mounted and are simply idle
  when `nostr` is off.
- Code size. Metro does not tree-shake, so a disabled module's code still ships
  in the bundle, even though nothing can reach it. Making that code absent is a
  separate step: it would need a Metro resolver that maps the module entry
  points (`@/features/ai`, `@/features/bitchat`, `@/shared/lib/nfc`, and the
  Routstr imports in `sovranPaymentConfig.ts`) to stubs per edition.
- Native checks. Each non-full edition needs one e2e scenario, run on both
  platforms.
