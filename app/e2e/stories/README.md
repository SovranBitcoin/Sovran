# Stories

An end-to-end test here is one thing a person does with the app, played on an iPhone simulator
([ADR 0033](../../docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md)).

```sh
bun app/e2e/press/native-build.ts ios --bundled   # the test build, once per change to the app
cd app && bun run e2e:stories --workers 4         # every story; the report is e2e/artifacts/stories/index.html
bun run e2e:story e2e/stories/library/<story>.json --udid <simulator> --app e2e/artifacts/native-builds/ios-bundled/Sovran.app --look
```

A story is a JSON file in `library/`: a purpose, the state it starts from, and steps. A step does one thing (tap,
swipe, type) and says what must then be true. `states/` holds stories that only set things up; any story's end
can be another's start. `--look` lists what is on screen when a story ends, which is how the next step is written.

## What has a story

| The app's pages (`app/app`) | Stories |
| --- | --- |
| First launch, Terms, Privacy, onboarding | `first-launch-accept-terms`, `states/onboarded`, `open-an-empty-wallet` |
| Wallet home, account switch, More menu | `browse-the-tabs`, `search-from-the-wallet`, `open-history-from-more`, `states/testnut-mint` |
| Receive: hub, amount, Lightning, on-chain, payment request, QR, token, scanner | `receive-100-sats-on-testnut`, `ask-for-an-onchain-payment`, `ask-for-ecash-with-a-payment-request`, `show-a-code-to-get-paid`, `copy-a-token-and-redeem-it`, `open-the-scanner` |
| Send: hub, amount, token, Lightning | `send-40-sats-as-ecash`, `pay-a-lightning-invoice`, `an-invoice-already-paid-is-refused`, `take-back-unclaimed-ecash`, `sending-with-no-money-is-refused`, `a-bitcoin-address-is-recognised`, `pick-the-notes-to-send` |
| Nut Drop | `open-nut-drop`, `look-for-people-nearby` |
| Transactions, filters, details | `see-the-payments-in-history`, `filter-the-history` |
| Mints: list, add, info, reviews, updates, split, rebalance plan | `states/testnut-mint`, `read-about-the-test-mint`, `read-the-reviews-of-a-mint`, `see-how-a-mint-has-changed`, `see-the-balance-split`, `see-the-rebalance-plan` |
| Map | `find-bitcoin-near-me` |
| Theme and wallpaper | `preview-the-theme`, `browse-the-wallpaper-gallery`, `apply-a-wallpaper` |
| Profiles | `add-a-second-profile`, `switch-back-to-the-first-profile`, `start-editing-a-profile-and-leave` |
| Backup and recovery | `write-down-the-recovery-words`, `back-up-the-wallet-and-pass-the-check`, `find-where-the-recovery-phrase-is-kept`, `look-at-recover-wallet-and-cancel`, `start-a-wallet-recovery` |
| Settings | `open-settings-and-read-the-terms`, `make-notifications-strict`, `see-where-the-feed-comes-from`, `look-at-swap-routing`, `see-the-keys-ecash-can-be-locked-to`, `look-at-moderation`, `look-at-my-media`, `look-at-delete-account-and-leave` |
| Developer rows | `turn-on-mock-mode`, `the-app-says-when-it-is-offline`, `look-at-the-storage-inventory`, `open-the-design-system`, `preview-screens-in-the-design-system`, `walk-the-design-system-families`, `walk-the-design-system-flows` |
| Feed, composer | `draft-a-post-and-discard-it` |
| Contacts, groups, a person's profile, sharing | `look-at-a-contact`, `look-at-groups`, `show-a-contacts-public-key` |
| Notifications | `read-the-notification-tabs`, `read-the-app-notifications` |
| Remote Login | `open-remote-login`, `share-remote-login`, `look-at-remote-login-activity` |

## What has none, and why

- **NFC**: a simulator has no NFC, and Send does not offer it there.
- **Scanning a real code, photos, the flashlight**: a simulator has no camera picture to scan; the scanner page opens.
- **AI pages**: the default build leaves them out.
- **Messages (direct, Bitchat, White Noise, geohash chat)**: they need a second wallet to talk to.
- **Paying a person**: with no contacts that take payments, Send lists nobody; in Mock Mode it lists pretend people,
  and tapping one did nothing when tried.
- **Publishing**: posting, following, saving a profile, reviewing a mint. A story must not publish to public relays.
- **Deleting an account, rotating the Remote Login secret**: opened where there is a page, never confirmed.
- **A recovery run to its end**: it searches four real mints and takes minutes; the story sees it start.
- **On-chain send beyond recognising the address, swaps between mints, locked ecash**: each needs money on a mint
  the run controls, and on two mints for a swap.
- **A person's stories, a post's thread**: which posts and whose stories are there changes from run to run, and
  the feed's posts have no control that opens the thread by id.
- **A place on the map**: the markers are drawn by the map, not by the app.
- **Three design-system families at or below the fold, and the add-a-mint sample flow**: not written yet.
- **Android**: the driver is for the iPhone simulator only.
- **Failure toggles**: "Mock Fail Send" did not make a real send fail when tried; "Mock Fail Melt" was not tried.

## Money stories form one line

Against the public test mint a wallet must never be put back to an earlier moment and spent from again: the mint
has already signed those secrets (F146). So `receive-100-sats-on-testnut` → `send-40-sats-as-ecash` →
`pay-a-lightning-invoice` → `an-invoice-already-paid-is-refused` → `take-back-unclaimed-ecash` →
`copy-a-token-and-redeem-it` each start where the last ended, one worker plays the line in order, and each worker
makes its own wallet. A new money story goes on the end of the line. F149 has what would lift this.
