# Wallet, Settings and Search are the tabs; the drawer switches accounts

Accepted on 2026-11-24, after a three-model design review. It amends the surface lists in
ADR 0021: the `feed`, `ai` and `directMessages` modules no longer exist, because no build
shipped a route for them.

The bottom bar today holds Contacts and Wallet, and the left drawer is a menu of rows
(Wallet, Contacts, Remote Login, Settings) of which Feed, Notifications and AI pointed at
deleted tabs. People reach Settings, the most-used page after the wallet, through two
gestures, and the Contacts tab duplicates what Send already offers.

The Contacts tab is dropped. Everything it carried that moves money stays: quick-pay and
people search on Send, silent NIP-17 ecash auto-redeem (`useDmEcashAutoRedeem`, mounted with
`ecashMessages`), payment-request replies, and nearby/BitChat search, which runs on demand
instead of in the background.

The bar becomes Wallet, Settings and a dedicated Search tab. On iOS 26+ NativeTabs the
Search trigger uses `role='search'`, so the system draws it as the separated search
control. Settings is the tab's root page only; its 24 sub-screens stay in the root
`(settings-flow)` stack, so their routes, deep links and native-harness aliases do not move.

The left drawer becomes a vertical account switcher: one row per profile, the active one
marked, with add-account at the end. Its open gesture keeps a 32pt edge (`swipeEdgeWidth` 32) so it does not fight horizontal gestures inside the wallet.

Removing Remote Login (NIP-46) goes with this change. Its two saved stores stay registered
and inert, so an older install's data still parses, and Delete account still wipes its
bunker secrets and pending pairing.
