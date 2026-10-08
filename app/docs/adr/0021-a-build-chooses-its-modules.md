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
`directMessages`, `contacts` and `feed`; the proximity modules `nfc` and
`nutDrop`; and `ai`.

`ecashMessages` and `directMessages` are different things. The first is a
payment rail: the NIP-17 transport that carries ecash to a contact. The second
is the conversation UI: chat threads, the message menu and message previews.
Turning `directMessages` off leaves the rail working in both directions. A
send ends on the wallet instead of opening the thread. An incoming token is
redeemed without any conversation: `useDmEcashAutoRedeem` mounts at account
scope whenever `ecashMessages` is on, reads the message inbox, and feeds ecash
to the same persisted redeem queue Nut Drop uses (amended 2026-10-06; before
that, a message token could only be redeemed from its chat bubble). Mint trust
is the queue's: a token from an untrusted mint waits and is not auto-trusted,
and that mint is not contacted at all (no spent check, no keyset fetch) until
the person opens the token, because the mint URL is the sender's choice.
A token that waits, or that kept failing, is listed on the wallet home under
"Needs your review" and opens in the ordinary receive screen; the queue picks
it up again once its mint is trusted.

- **Chosen at build time.** `EXPO_PUBLIC_SOVRAN_EDITION` names an edition:
  `payments` (the default), `full`, `lightningOnly`, `onchainOnly`,
  `ecashLightning` or `private`. `payments` is the focused app: everything
  except `ai` and `directMessages`. `full` ships every module and must
  be named explicitly. `EXPO_PUBLIC_SOVRAN_FEATURES` applies JSON overrides, for example
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
  Without the feed the wallet is the first tab, and so the landing tab. Tab
  folders the build does not ship are declared hidden and removed from the
  state handed to the tab bar.
- Drawer (`navigation/drawerMenu.ts`): each row carries its module, so a row
  never points at a tab the build lacks.
- Search: the Posts scope (`feed`).
- Profiles: the post list under the header (`feed`), the message menu
  (`directMessages`) and AI provider rows in "Runs" (`ai`).
- Contacts: message previews and White Noise rows (`directMessages`).
- Transaction detail: the link into an AI conversation (`ai`).
- Own-events sync: without `feed` it requests only the profile and follow list.
- Receive tabs (`computeReceiveTabs`): Unified appears only over two or more rails.
- Send hub: create ecash, NFC and Nut Drop. People search is blanked unless
  `nostrSearch` is on. DM delivery is armed only when `ecashMessages` is on, so
  without it a contact is paid over Lightning.
- Receive hub: fixed amount (`lightning`), paste (`ecash`) and Nut Drop.
- Send token screen: the NFC button.
- Settings: Network, Remote Login and Moderation (`nostr`), Notifications and
  My media (`feed`), and the White Noise developer toggle (`directMessages`).
- Routes (`shared/lib/nav/featureRoutes.ts`): the root layout's guard sends any
  navigation into a disabled module back to the wallet, whether it arrives from
  a deep link, a notification or a stale push. Tabs are matched by their folder,
  so their nested screens go with them. Transaction history and settings
  are exempt, so a past payment stays viewable.
- Input (`shared/config/featureDetectors.ts`): Colada and the send screen parse
  with detectors that are blind to disabled modules. A token scanned in a
  Lightning-only build therefore reads as unsupported instead of starting a
  flow the build cannot finish.
- Providers: `BitchatBLEProvider` mounts only with `nutDrop`.
- Wallet: method availability through `isMethodImplemented`, which also covers
  on-chain addresses, since those are parsed without detectors.

## Deliberately not gated

- Routstr balance recovery in `CocoProvider`. It returns sats parked on AI
  nodes, so it must keep running in a build that has since dropped `ai`.
- The recent-contacts DM subscription. It is how contacts are discovered and
  how ecash sent over `ecashMessages` arrives.
- Mint key-change alerts live under the Notifications tab and are unreachable
  without `feed`; they need a home outside that tab.

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
