# Wave 2 tightens the main screens, prunes Settings and adds a state-locked UI kit

Accepted on 2026-11-24. It refines the surfaces set out in
[ADR 0035](0035-wallet-settings-search-navigation-and-account-drawer.md).

**Search** uses the native iOS header search bar. While a search is active, the Search tab
shows an `X` that closes it.

**Accounts drawer** is wider, and each `AccountRow` takes two lines, so long account names
are not cut short.

**Mint Info** opens with a header built around the mint's icon. The "What this mint
supports" section is removed.

**Add Mints** runs `navigate` single-flight, so a double tap cannot push the next screen
twice, and every selectable row uses the same circle check.

**Network** is built from the canonical `SettingsRows`, like the other Settings pages.

**Profile** text meets AA contrast, and the NIP-05 label reads "Verified name".

**Moderation and Uploaded media** leave Settings. Their saved stores stay registered and
unchanged, so an older install's data still parses and Delete account still clears it.

**Swap routing** moves into the Developer section. All six of its settings are live, but
they tune behaviour most people never need to change.

**Design System**, a developer page, gains a state-locked UI kit, which shows components
held in fixed states so they can be compared side by side, and an animation frame scrubber
for inspecting motion.
