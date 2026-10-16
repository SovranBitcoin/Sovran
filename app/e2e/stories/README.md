# Stories

An end-to-end test here is one thing a person does with the app, played on an iPhone simulator
([ADR 0033](../../docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md)).

```sh
bun app/e2e/press/native-build.ts ios --bundled   # the test build, once per change to the app
cd app && bun run e2e:stories --workers 4         # every story; each invocation preserves a run
bun run e2e:story e2e/stories/library/<story>.json --udid <simulator> --app e2e/artifacts/native-builds/ios-bundled/Sovran.app --look
```

Open the shared history with `bun run e2e:viewer`. [Results ownership](../README.md) explains
where generated evidence belongs and how to group older output.

For a fresh Android story, use `bun run e2e:story e2e/stories/library/<story>.json --platform android`.
It uses the current stamped development APK and owns a disposable emulator and Metro server;
build the APK first with `bun run screenshots:native-build android`. Saved states, handed/given
inputs, deep links and permission overrides are not supported in this lane yet. It keeps the
same story report, screenshots and received logs, plus the installed APK comparison and session
receipt. Cleanup and source drift can fail an otherwise passing story. This is functional
development-build evidence: toast/triple-tap timing is extended, location is pregranted, and video, pixel-motion and
device performance measurements are absent. It does not satisfy the controller's native gate.

Each play has its own session identity, checked against the app's hello before accepting
logs or sending requests. A profile restart may reconnect to that same session. The attempt
keeps the hello and all received log entries, including those outside step windows; this
does not prove the app emitted every expected log, identify its installed binary, or certify
cleanup. Keep those obligations separate when reviewing native evidence.

A story is a JSON file in `library/`: a purpose, the state it starts from, and steps. A step does one thing (tap,
swipe, type) and says what must then be true. `states/` holds stories that only set things up; any story's end
can be another's start. `--look` lists what is on screen when a story ends, which is how the next step is written.

## What has a story

| The app's pages (`app/app`)                                                    | Stories                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First launch, Terms, Privacy, onboarding                                       | `first-launch-accept-terms`, `states/onboarded`, `open-an-empty-wallet`                                                                                                                                                                                                                                                                                                                                                                                          |
| Wallet home, account switch, More menu                                         | `browse-the-tabs`, `search-from-the-wallet`, `open-history-from-more`, `states/testnut-mint`                                                                                                                                                                                                                                                                                                                                                                     |
| Receive: hub, amount, Lightning, on-chain, payment request, QR, token, scanner | `receive-100-sats-on-testnut`, `receive-100-sats-on-the-private-mint`, `ask-for-an-onchain-payment`, `ask-for-ecash-with-a-payment-request`, `show-a-code-to-get-paid`, `copy-a-token-and-redeem-it`, `redeem-ecash-from-a-link`, `redeem-ecash-locked-to-my-key`, `open-the-scanner`                                                                                                                                                                            |
| Send: hub, amount, token, Lightning, on-chain                                  | `send-40-sats-as-ecash`, `pay-a-lightning-invoice`, `an-invoice-already-paid-is-refused`, `a-lightning-payment-the-mint-has-not-settled`, `a-lightning-payment-the-mint-could-not-make`, `take-back-unclaimed-ecash`, `sending-with-no-money-is-refused`, `a-bitcoin-address-is-recognised`, `start-an-onchain-send`, `send-on-chain-from-the-private-mint`, `pick-the-notes-to-send`, `the-lock-question-when-paying-a-person`, `the-person-i-pay-pays-me-back` |
| Nut Drop                                                                       | `open-nut-drop`, `look-for-people-nearby`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Transactions, filters, details                                                 | `see-the-payments-in-history`, `filter-the-history`                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mints: list, add, info, reviews, updates, split, rebalance, swap               | `states/testnut-mint`, `states/private-mint`, `move-money-between-two-mints`, `read-about-the-test-mint`, `read-the-reviews-of-a-mint`, `see-how-a-mint-has-changed`, `see-the-balance-split`, `see-the-rebalance-plan`                                                                                                                                                                                                                                          |
| Map                                                                            | `find-bitcoin-near-me`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Theme and wallpaper                                                            | `preview-the-theme`, `browse-the-wallpaper-gallery`, `apply-a-wallpaper`                                                                                                                                                                                                                                                                                                                                                                                         |
| Profiles                                                                       | `add-a-second-profile`, `switch-back-to-the-first-profile`, `start-editing-a-profile-and-leave`                                                                                                                                                                                                                                                                                                                                                                  |
| Backup and recovery                                                            | `write-down-the-recovery-words`, `back-up-the-wallet-and-pass-the-check`, `find-where-the-recovery-phrase-is-kept`, `look-at-recover-wallet-and-cancel`, `start-a-wallet-recovery`, `recover-a-wallet-from-its-mints`                                                                                                                                                                                                                                            |
| Settings                                                                       | `open-settings-and-read-the-terms`, `make-notifications-strict`, `see-where-the-feed-comes-from`, `look-at-swap-routing`, `see-the-keys-ecash-can-be-locked-to`, `look-at-moderation`, `look-at-my-media`, `look-at-delete-account-and-leave`, `delete-the-account-and-start-again`                                                                                                                                                                              |
| Developer rows                                                                 | `turn-on-mock-mode`, `the-app-says-when-it-is-offline`, `look-at-the-storage-inventory`, `open-the-design-system`, `preview-screens-in-the-design-system`, `walk-the-design-system-families`, `walk-the-rest-of-the-design-system`, `walk-the-design-system-flows`, `open-the-sample-mint-and-map-flows`                                                                                                                                                         |
| Feed, composer, a post's thread                                                | `draft-a-post-and-discard-it`, `open-a-posts-thread` (from the design system's sample posts), `open-a-thread-from-the-live-feed`, `open-a-posts-author-from-the-feed`                                                                                                                                                                                                                                                                                            |
| Contacts, groups, a person's profile, sharing                                  | `look-at-a-contact`, `look-at-groups`, `show-a-contacts-public-key`                                                                                                                                                                                                                                                                                                                                                                                              |
| Notifications                                                                  | `read-the-notification-tabs`, `read-the-app-notifications`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Remote Login                                                                   | `open-remote-login`, `share-remote-login`, `look-at-remote-login-activity`                                                                                                                                                                                                                                                                                                                                                                                       |

## What has none, and why

- **NFC**: a simulator has no NFC, and Send does not offer it there.
- **Scanning a real code, photos, the flashlight**: a simulator has no camera picture to scan; the scanner page opens.
- **Bitchat, White Noise and geohash chat**: they need another phone nearby or another app; the Nostr chat and the
  AI tab have stories in `full/` (below). Asking the AI something costs sats a new wallet does not have.
- **Publishing**: posting, following, saving a profile, reviewing a mint. A story must not publish to public relays.
- **Rotating the Remote Login secret**: not done.
- **Locking ecash the person sends**: locking to a person sends them a message. Ecash locked to the wallet's own
  key and handed to it has a story.
- **`lightning:` and `bitcoin:` links from outside the app**: they land on the page-not-found page (F151).
- **A link opened over an open Settings page**: redeeming then can hang the app (F150), so the stories close
  Settings first.
- **A person's stories**: whose stories are there changes from run to run. The two stories on the live feed
  take whichever post the network sends first.
- **A place on the map**: the markers are drawn by the map, not by the app; iOS reports them only as one label
  for the whole map.
- **Android, and a phone**: the driver is for the iPhone simulator only.
- **Making a real payment fail on purpose**: with "Mock Fail Send" or "Mock Fail Melt" on, a real send and a real
  Lightning payment went through as usual; the toggles do not reach real payments. The failures that have stories
  are real ones: an invoice already paid, and no money.

## A mint of the run's own

`{{mint}}` and `{{mint2}}` in a story are two mints the runner starts on the Mac for that simulator
(`privateMint.ts`): `cdk-mintd` with pretend Lightning, behind TLS with a certificate the simulator is told to
trust, because the app accepts a mint only at an `https` address. An invoice is paid the moment it is made, and an
on-chain payment is "sent" at once. The mints' databases are saved and put back with the wallet's state, so a
story that starts from `states/private-mint` or `receive-100-sats-on-the-private-mint` can be played again and
again and any number of stories can start from the same moment. They run only for a story that names them or
starts from a state that holds them. Needs `cdk-mintd`, `socat` and `openssl` on the Mac.

## A second wallet, and links

A step with `handed: { "token": { "sats": 32 } }` is handed ecash as it begins: the runner acts as a second
wallet on the simulator's first mint (`secondWallet.ts`) and the step uses it as `{{token}}`. An invoice a story is given can say `"paying": "failed"`, and the run's own mint reports the payment failed after
taking it, or `"paying": "pending"`: the mint then holds the
payment as pending and never settles it (F152 is what that showed). `lockTo` locks a handed token to
a public key, which may be one remembered off the screen (`remember` with `idAfter` keeps what follows a prefix in
a row's id). `open` opens a link as another app would, and answers iOS's "Open in Sovran?" for the person.
Nothing is published and no other phone is needed.

`{{person}}` is the public key of another person, made for one play and never used again (`person.ts`). A story
pays them, and a step with `handed: { "paidBack": { "sats": 16 } }` has them read who paid from the message that
reached them and send ecash back the same way. This is the one place a story reaches public relays: an encrypted
message between two keys nobody else has, which the owner allowed on 2026-10-13. The message they send expires
from the relays after a minute, because a wallet put back to a saved moment reads its messages again and would
take the ecash in twice; the story is named to be played last among those that start from the same moment.

## The full edition

The default build leaves out the chat pages and the AI tab (ADR 0021). `full/` holds the stories about them, played
on a second test build that differs only in its JavaScript:

```sh
bun app/e2e/press/native-build.ts ios --bundled --edition full   # e2e/artifacts/native-builds/ios-bundled-full
bun run e2e:stories:full
```

| Pages                                                       | Stories                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Finding a person by key, the message menu, a Nostr chat     | `write-to-a-person-and-read-their-answer` (the other person is the runner; F153 is what it found) |
| AI tab: models, conversations, providers, a provider's page | `look-at-the-ai-models-and-conversations`, `look-at-the-ai-providers`                             |

A step with `handed: { "reply": { "text": "…" } }` has the other person answer what the story wrote to them.

## Money stories on the public test mint form one line

Against the public test mint a wallet must never be put back to an earlier moment and spent from again: the mint
has already signed those secrets (F146). So `receive-100-sats-on-testnut` → `send-40-sats-as-ecash` →
`pay-a-lightning-invoice` → `an-invoice-already-paid-is-refused` → `take-back-unclaimed-ecash` →
`copy-a-token-and-redeem-it` each start where the last ended, one worker plays the line in order, and each worker
makes its own wallet. That line stays as proof against a mint nobody here runs. A new money story starts from
`receive-100-sats-on-the-private-mint` instead, where none of this applies.
