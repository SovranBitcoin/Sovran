# Reinstall and key recovery

Expected behavior; **not device-verified**. Jest injects SecureStore failures and checks identity, cache invalidation, reset ordering, and recovery actions. Native reinstall, encrypted backup, dead-Keystore restore, accessibility, and layout still need iOS/Android device runs with disposable accounts.

| Installation | Expected behavior | Diagnostic events |
| --- | --- | --- |
| iOS fresh | Create a root; onboarding offers “I have a recovery phrase”. | `nostr.secure.mnemonic_stored` (fresh), `gate.reinstall.skip` |
| iOS reinstall with retained Keychain | Reuse the root and NIP-06 account; skip carousel after legal acceptance; run wallet recovery. | `gate.reinstall.detected`, `gate.restore.needed` |
| iOS encrypted-backup restore | Reuse readable Keychain keys; retained lifecycle metadata determines whether recovery is needed. Any key read error blocks replacement. | `nostr.secure.mnemonic_exists`; `gate.restore.needed` or `gate.restore.skip`; on error `secure.mnemonic.locked` |
| Android fresh | Create a root; offer phrase import in onboarding. Import restarts with pending wallet recovery. | `nostr.secure.mnemonic_stored`, `secure.mnemonic.recovered`, `gate.restore.blocked` |
| Android reinstall without backup | No retained keys: fresh onboarding; entering the original phrase recovers its derived accounts. | Same as Android fresh |
| Android restored preferences with a dead Keystore | Block on “Stored keys can't be unlocked on this device”; never generate after the failed read. Import the original phrase or explicitly confirm Start fresh twice. | `secure.mnemonic.locked` once per process; then `secure.mnemonic.recovered` or `nostr.secure.all_data_cleared` |

`secure.mnemonic.locked` contains only platform and an allowlisted error class. It is a sticky runtime state, never persisted. A restart after a confirmed write/delete rebuilds all account caches. Recovery writes the pending lifecycle marker before replacing the root. Known derived profiles must match the submitted phrase. Imported Nostr identities need their original nsec as well as the root phrase used for their Cashu wallet.

Unknown persisted profile sources still parse as `imported`; omitted legacy sources remain derived. Missing imported keys permit repair only when NIP-06 derivation at the saved account index produces the exact saved pubkey. Repair clears derived keys, Cashu mnemonic, **and Cashu seed** caches before changing source to `derived`/chain 0. `profile.source.repaired` records that proof without recording the key. Mismatches show Re-import; that form accepts only the saved account's nsec.

Android `allowBackup` was not set in app.json and no project plugin supplied custom backup rules. It is now false. The installed Expo SecureStore plugin also supplies its own backup/data-extraction rules by default, excluding `SecureStore` shared preferences; these remain enabled. **A new Android binary is required**; an OTA cannot change the installed manifest. No native manifest or backup transport was executed here.

The manual `reinstall-recovery` E2E suite assumes each disposable device is already at the named error state (an OS backup restore or a deliberately prepared test installation). It checks entry and dismissal of the recovery forms without providing secrets or deleting data. These scenarios are schema validation, not device evidence. The ordinary onboarding scenario checks the phrase entry exists.
