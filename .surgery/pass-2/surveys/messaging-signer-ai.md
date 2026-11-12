# Pass 2 survey: messaging, signer, AI and map

Area: `app/features/bitchat` (with the bridge `app/modules/bitchat-module/src/BitChatModule.ts` and
`app/shared/providers/BitchatBLEProvider.tsx`), Nut Drop and its redeem queue consumer
(`app/features/nearPay/{hooks/useNutDropAutoRedeem,lib/nutDropAutoRedeem,lib/nutDropStrikeState,hooks/useNutDropStrike}.ts`,
`app/shared/stores/profile/nutDropRedeemQueueStore.ts`, `wallet/src/transport/redeemOrchestrator.ts`),
`app/features/whitenoise`, `app/features/nostrSigner`, `app/features/ai` (with the message half of
`app/shared/stores/profile/routstrStore.ts` and `app/shared/lib/routstr/topUp.ts`), `app/features/map`.

Checkout `sovran-surgery`, branch `surgery/pass-2`. Paths are relative to `app/` unless they start with `wallet/`.
"Traced" means followed through the code; "run" means a test showed it. Two test files were run:
`__tests__/bitchatDmMessages.test.ts` (12 passed) and `__tests__/bitchatSend.test.tsx` (18 passed).

## Ranking

| # | Candidate | Reachable illegal state | Risk | Cost | Call |
| - | --------- | ----------------------- | ---- | ---- | ---- |
| 1 | BitChat BLE DM delivery state | yes, run | saved data, duplicate sends | S–M | convert |
| 2 | Nut Drop redeem entry and drain | yes, traced | money (wrong verdict shown, redemption stalls) | M | convert |
| 3 | AI turn lifecycle | yes, traced | money (paid answer written nowhere) | M | convert |
| 4 | Whitenoise DM conversation phase | yes, traced | saved data (DM index), peer key packages | S | convert |
| 5 | Signer "hot" flag with three owners | yes, traced (edge) | signer goes cold under a live link | S | convert |
| 6 | Whitenoise setup (banner and hook) | yes, traced | wrong success shown | S | convert |
| 7 | BitChat bridge lifecycle | yes (F207) | account scoping of incoming DMs | M | defer |
| 8 | Whitenoise request accept/decline | yes (F206) | saved data | S | defer |
| 9 | Whitenoise inbox start | yes (F184) | missed invites | S | defer |
| 10 | Signer engine pending queue and contexts | no | key-holding signer | M | defer |
| 11 | `useBitChat` chat session (connection flag, local echo) | yes (F183) | lost text | S | defer |
| 12 | Merchant detail load | yes, minor | none | S | convert (cheap) or leave |
| — | Strike map, Bluetooth state, approval controller, map camera/markers, Routstr top-up | — | — | — | leave |

---

## 1. BitChat BLE DM delivery state

**Files.** `features/bitchat/stores/bitchatDmMessages.ts:16-23` (type), `:40-70` (native mapping and rank),
`:195-253` (`applyDeliveryStatus`), `:274-320` (`afterHydrate` demotion), `:105-124` (persisted schema);
`features/bitchat/hooks/useBitChat.ts:438-545` (optimistic append, 15 s watchdog, native rejection);
`shared/providers/BitchatBLEProvider.tsx:80-87` (native status listener);
`features/bitchat/screens/GeohashChatScreen.tsx:134-158` (status to bubble), `:309-333` (retry);
`shared/ui/composed/chat/ChatMessageBubble.tsx:21-28,199-235` (failed icon and "Tap to retry").

**Variables.** Per own message: `deliveryStatus?` (`sending|sent|delivered|read|failed`), `isPending?`,
`failureReason?` (free string: native reason, `'timeout'`, `'app_restart'`, or a native rejection message), plus
`isOwn`. `isPending` is derived (`incoming === 'sending'`) but stored beside the status.

**States.** Sending, Sent (handed to native), Delivered, Read, Failed(native reason), and two states the code
writes as `failed` although nothing failed: TimedOut (watchdog guess) and Restarted (relaunch guess).

**Events.** append (`sending`); native `sending|sent|delivered|read|failed|partiallyDelivered` (partial maps to
`sent`); watchdog at 15 s if still `sending`; native rejection of `sendBLEPrivateMessage`; relaunch (`afterHydrate`);
retry (a new message with a new id; the old one is left as it is).

**State table** (rows: current; columns: incoming event; cell: resulting status, as the code does it today).
Rule at `bitchatDmMessages.ts:217`: accept if `incoming === 'failed'` or rank(incoming) > rank(current), with
ranks sending 0, sent 1, delivered 2, read 3, failed 4.

| current \ incoming | sending | sent / partial | delivered | read | failed(reason) | watchdog 15 s | relaunch |
| ------------------ | ------- | -------------- | --------- | ---- | -------------- | ------------- | -------- |
| sending (or no status) | sending | sent | delivered | read | failed(reason) | **failed('timeout')** | **failed('app_restart')** |
| sent | sent | sent | delivered | read | failed(reason) | — (only fires on sending) | **failed('app_restart')** ¹ |
| delivered | delivered | delivered | delivered | read | **failed(reason)** ² | — | delivered |
| read | read | read | read | read | **failed(reason)** ² | — | read |
| failed(any) | failed | failed | **failed** ³ | **failed** ³ | failed(new reason) ⁴ | — | failed |

1. Ledger quirk, pinned as `QUIRK` in `bitchatDmMessages.test.ts:228-249` (run): native already handed the
   message off; after a relaunch it shows failed with "Tap to retry".
2. Ledger quirk, pinned as `QUIRK` in `bitchatDmMessages.test.ts:185-194` (run): the peer acknowledged, a later
   failure still wins.
3. `failed` is absorbing (`bitchatDmMessages.test.ts:169-183`, run, pinned as intended, not as a quirk). Combined
   with the watchdog (`bitchatSend.test.tsx:409-423`, run) this makes TimedOut final: the banner on the same
   screen says a mesh-relayed DM waits on a "15s spool" (`GeohashChatScreen.tsx:244-262`), the watchdog fires at
   15 s, and the `delivered` that follows is dropped. See defect D1.
4. The reason is overwritten (`timeout` replaced by a native reason, or the reverse).

**Combinations with no meaning.** `deliveryStatus: 'failed'` with `failureReason` `timeout`/`app_restart` (an
unknown outcome stored as a failure); `isPending: true` with any status but `sending` (written only through
`appendOutgoing`, so not produced today); `failureReason` present with a non-failed status (cleared on every
accepted update, not produced today); `deliveryStatus` on an inbound message (an event whose id matched an inbound
id would set it; native only reports outbound ids, so not reached).

**Reachable today.** TimedOut-then-delivered stays failed (run, by the two pinned tests above composed: the
watchdog writes `failed`, a later `delivered` is skipped). Delivered then failed (run). Sent then relaunch (run).
Retry: `GeohashChatScreen.tsx:316-323` re-sends `original.content` as a new message and leaves the failed bubble
with its own "Tap to retry", so each tap sends one more copy; nothing guards a double tap (traced; D2).

**Persisted.** Yes. Store `bitchat-dm-messages-store`, profile scope (key `bitchat-dm-messages-store:profile:<pubkey>`),
fields `byPeer[peerID][].deliveryStatus`, `.isPending`, `.failureReason`. The reader already turns an unknown
status into `failed` (`.catch('failed')`). A conversion can keep the saved shape exactly and decode at the read
boundary: `failed` + `failureReason ∈ {timeout, app_restart}` decodes to Unconfirmed, anything else `failed` to
Failed; `isPending` is written as before (derived on write) and ignored on read. No new enum value is needed, so an
older release still reads every blob a newer one writes.

**Consumers.** 5 files read the flags: the store, `useBitChat.ts` (watchdog reads `deliveryStatus`),
`GeohashChatScreen.tsx` (maps `deliveryStatus ?? isPending`), `ChatMessageBubble.tsx` (three comparisons),
`BitchatBLEProvider.tsx` (writer).

**Pinned.** `bitchatDmMessages.test.ts` (transitions, restart demotion, unknown status), `bitchatSend.test.tsx`
(append, native rejection, watchdog including after the chat closes), `bitchatBridgeLifecycle.test.tsx` (provider
feeds statuses). A conversion needs pinned first: TimedOut followed by `sent`/`delivered` (today stays failed),
the retry tap sending a second copy, and a save→reload fixture holding each of the five saved statuses with each
reason.

**Recommendation.** Convert: a pure transition function `next(state, event)` over a discriminated union
`Sending | Sent | Delivered | Read | Failed{reason} | Unconfirmed{why: 'timeout'|'app_restart'}`, decoded and
encoded at the store boundary. Unconfirmed accepts a later `sent`/`delivered`/`read`; whether Delivered/Read accept a
later `failed` and whether Sent survives a relaunch are the ledger's open quirks for the owner. The repo's
`wallet/src/machine` is heavier than needed here; a table like `nutDropStrikeState.ts` fits.

**Deletes.** `STATUS_RANK` and the special case for `failed`, the `isPending` write logic, the screen's
`richStatus ?? isPending` fallback for BLE DM rows, the watchdog's store read (it would send an event).
Size S–M (store, hook, screen; bubble unchanged).

---

## 2. Nut Drop redeem entry and drain

**Files.** `shared/stores/profile/nutDropRedeemQueueStore.ts:25-61` (entry), `:215-327` (`enqueue`, `markStatus`,
`requeue`, `scheduleRetry`, `prune`), `:166-200` (reader);
`wallet/src/transport/redeemOrchestrator.ts:114-221` (single-flight drain, gates, error kinds);
`features/nearPay/lib/nutDropAutoRedeem.ts:45-210` (module-singleton orchestrator, toast and annotation hooks),
`:212-231`; `features/nearPay/hooks/useNutDropAutoRedeem.ts:41-174` (triggers);
consumers `features/nearPay/lib/nutDropStrikeState.ts:44,70-77`, `features/payments/lib/parkedMessageEcash.ts:43,95-114`,
`features/payments/lib/dmEcashRecovery.ts:50-96`, `features/payments/screens/MessageEcashMintScreen.tsx:50-74,116`,
`features/payments/components/MessageEcashToReview.tsx:39-52`, `features/payments/hooks/useDmEcashAutoRedeem.ts:73-77,136,222`.

**Variables.** Per entry: `status` (six strings), `attempts`, `nextAttemptAt`, `lastError?`. Module scope:
`orchestrator` singleton and its `inFlight` latch. The strike map derives a seventh state from three of them:
"waiting" = `pending && attempts > 0 && nextAttemptAt > now` (`nutDropStrikeState.ts:73-77`).

**States.** Queued, Waiting(attempt n, until t, lastError), Redeeming, Redeemed, Spent, UntrustedMint, Failed(lastError).
Terminal: Redeemed, Spent. Parked: UntrustedMint, Failed (leave via `requeue`).

**Events.** enqueue; drain picks due entries (`pending` or `redeeming`, `nextAttemptAt <= now`); trust check;
`markStatus('redeeming')`; success → `redeemed`; error kind spent → `spent`, network/retryable → `scheduleRetry`
(Waiting or Failed at 5 attempts), fatal → `failed`; manual `requeue`; Nostr intake `markSpent`/`markUntrusted`;
`prune` (terminal after 24 h).

**Combinations with no meaning.** `redeemed` or `spent` with `lastError` from an earlier attempt (`markStatus`
keeps the old `lastError`, `nutDropRedeemQueueStore.ts:255`; reachable after any retried success, traced); `pending`
with `attempts >= 5`; `failed` with `nextAttemptAt` in the future; `markStatus` accepts any status from any status
(for example `redeeming` over `redeemed`) because the store has no transition rule; only the orchestrator's filter
keeps that from happening today.

**Reachable today.**
- A persisted `redeeming` entry (app killed, or the background budget expired, after the mint swap but before
  `markStatus('redeemed')`; or the profile changed during `executeAutoRedeem`, `redeemOrchestrator.ts:186`) is
  retried on the next drain, the mint answers "already spent", the entry becomes `spent` and, with the app active,
  the toast shows red "Token was already redeemed" for ecash that was received (`nutDropAutoRedeem.ts:154-159`).
  The receive's history row also never gets its Bluetooth badge and sender (`onRedeemed` is not called). Traced (D4).
- A drop that arrives, or a manual "try again" that requeues, while a drain is running: `drain()` returns at once
  (`redeemOrchestrator.ts:121`) and the running drain took its `due` snapshot before the new entry existed, so the
  entry waits for the next foreground, connectivity change or message. Traced (D3).
- `lastError` on a redeemed entry: traced, cosmetic (nothing renders it for terminal entries).

**Persisted.** Yes. Store `nut-drop-redeem-queue`, profile scope, `byTokenHash[hash].status|attempts|nextAttemptAt|lastError`.
The reader is deliberately tolerant (`status` `.catch('pending')`) and pass 1 just rebuilt its recovery. A
conversion keeps the saved shape and decodes each entry into the union at the read boundary; it must not tighten
any field.

**Consumers.** Status strings are compared in 8 files outside the store (listed above), plus the wallet port's own
copy of the union (`redeemOrchestrator.ts:25-26`) and the strike state's third copy (`nutDropStrikeState.ts:44`).

**Pinned.** `nutDropRedeemQueueStore.test.ts`, `nutDropRedeemQueueOversize.test.tsx`, `nutDropRedeemQueueRecovery.test.ts`,
`nutDropDleqBoundary.test.ts`, `nutDropStrikeState.test.ts`, `useDmEcashAutoRedeem.test.tsx`, `dmEcashRecovery.test.ts`,
`dmEcashIntake.test.ts`, `wallet/__tests__/unit/transport.test.ts` (drain gates, kinds, profile change).
Missing before a conversion: a drain called while another runs (today: dropped), a `redeeming` entry whose token
the mint reports spent (today: `spent` and a red toast), and `lastError` after a retried success.

**Recommendation.** Convert in two parts. Store: one exported `transition(entry, event)` with the union above
(the queue's actions become events; illegal moves are refused and logged), and one exported `isDue`/`isParked`/`isLive`
set used by the eight consumers instead of string compares. Orchestrator: replace "overlapping calls return
immediately" with "an overlapping call marks a rerun; the running drain loops once more" (keeps single-flight,
loses no trigger). Distinguishing "spent because we redeemed it" from "spent by someone else" needs the receive's
own record (Coco history by token) and is a decision, not a refactor; flag it to the owner with D4.

**Deletes.** The string compares in eight files, the strike state's private copy of the status union, the
`isRetryWaitingEntry` reconstruction. Size M (store, wallet orchestrator, eight readers).

---

## 3. AI turn lifecycle

**Files.** `features/ai/hooks/useAiSend.ts:151-183` (status and controller), `:272-274` (abort the prior stream),
`:318-326` (start), `:870-934` (catch/finally), `:1093-1120` (send: user `pending`, empty placeholder),
`:1150-1205` (retry); `features/ai/lib/streamingBuffer.ts:50-81` (one global slot);
`features/ai/lib/turnErrors.ts` (in-memory map, 24 entries); `features/ai/lib/turnTruncation.ts`;
`features/ai/components/AiMessageBubble.tsx:333-432` (derives the phase back from all of them);
`features/ai/screens/AiChatScreen.tsx:179,373-375,493`; `shared/stores/profile/routstrStore.ts:233-292` (message),
`:673-688` (`mapSessionMessages` writes the *current* session only), `:1266-1300`, `:1599-1630`;
`features/ai/lib/sessionsPopup.ts:58-62`.

**Variables.** Persisted message `content` (empty string = placeholder), user message `pending`; hook state
`{isSending, streamingMessageId}`; `streamControllerRef`; buffer `streamingId/Text/Reasoning/StartedAtMs`;
`turnErrors[id]`; `turnTruncation[id]`; the routstr store's `currentSessionId`, which decides where every write lands.

**States** (per assistant turn). Placeholder, Streaming(id, text so far), Answered(content, cost), Truncated(content),
Failed(error id), Interrupted (empty content, no error: a kill, an evicted error, or a stream with no chunks),
Removed (aborted).

**Events.** send/retry start, chunk, finish reason, stream end, error, abort (unmount or a newer stream),
relaunch, 25th error (evicts the oldest), session switch or new session, profile switch.

**Combinations with no meaning.** `isSending: false` while a stream for the visible turn is still writing;
`streamingMessageId` naming a message that is not in the current session; a saved user message with `pending: true`
and no stream; an assistant placeholder in one session receiving its answer while another session is current.

**Reachable today.**
- Session switch or "New conversation" from the header (`app/(drawer)/(tabs)/ai/_layout.tsx:26`, not gated on
  `isSending`) during a stream: `finalizeAssistantMessage` and `setMessagePending` map only the now-current session,
  so the paid answer is written nowhere, the old session keeps an empty answer (rendered as "interrupted") and its
  question stays `pending: true` in saved data. Traced (D5).
- Overlapping streams: `send` and `retry` are separate single-flights and `isSending` is set only once streaming
  starts, so a retry whose context is still being assembled (image encode) and a composer send can both reach
  `streamIntoPlaceholder`. The second aborts the first; the first's `finally` then calls `clearStreaming()` and
  `setStatus({isSending:false})` unconditionally, wiping the live buffer and the streaming flag the second owns
  (`setStreamingText` is id-guarded, so nothing re-arms it). Traced (D6).
- Abort on unmount removes the placeholder, leaving a question with no answer and nothing to press
  (pinned as current behaviour in `aiConversationBranchStream.test.tsx:421-434`; contradicts the rule written at
  `useAiSend.ts:941-944`). D7.
- Kill mid-stream: F207 (already filed). Failure mid-stream drops shown text: F207.

**Persisted.** Partly. `routstr-store` (profile scope) `sessions[].messages[].content|pending|costSats|…`; errors,
truncations and the buffer are runtime only. A conversion keeps the message shape; the union lives in a runtime
per-turn store keyed by message id and session id, and a saved empty assistant message decodes to Interrupted as it
does today.

**Consumers.** `useAiSend.ts`, `AiMessageBubble.tsx`, `AiChatScreen.tsx`, `AiTurnErrorPill.tsx`, `streamingBuffer.ts`,
`turnErrors.ts`, `turnTruncation.ts`, `routstrStore.ts` (8 files).

**Pinned.** `aiConversationBranchStream.test.tsx` (streaming, abort, kill shape, mid-stream failure),
`aiSendRecovery.test.ts`, `aiSendRequestShape.test.ts`, `aiSendAssembly.test.ts`, `aiSendGate.test.ts`,
`aiTurnErrorPill.test.tsx`, `aiTurnTruncation.test.tsx`, `aiFinalize.test.ts`. Not pinned: session switch or new
session during a stream, overlapping send and retry, the 25th error evicting the first.

**Recommendation.** Convert: one runtime turn store `Record<turnId, {sessionId, phase: Streaming|Answered|Truncated|Failed|Removed}>`
replacing `turnErrors`, `turnTruncation` and the hook's `status`; the streaming slot keyed by turn id with
`clearStreaming(id)`; finalize writes to the turn's own `sessionId` (a store action that targets a session, not
"current"). A reducer is enough; the stream already has a controller, no timers or retries beyond the candidate walk.

**Deletes.** `turnErrors.ts` and `turnTruncation.ts` (two parallel LRU maps), the bubble's reconstruction of phase
from four sources, the hook's `SendStatus` state, the unconditional `finally`. Size M.

---

## 4. Whitenoise DM conversation phase

**Files.** `features/whitenoise/hooks/useWhitenoiseDM.ts:55-174`, `:209-257` (load), `:272-362` (send and lazy
create); `features/whitenoise/screens/WhitenoiseDMScreen.tsx:37-124`.

**Variables.** `group`, `groupRef` (post-commit mirror, also written directly by send), `messages`, `isLoading`,
`isCreatingGroup`, `error`, plus `client` from context and the single-flight ref.

**States.** NoClient, Loading, NoGroup, CreatingGroup, Ready(group), LoadFailed(error), SendFailed(error) (Ready with an error).

**Events.** client appears; load finds index → group; load finds none; send (creates when no group); create fails;
send fails; group event arrives.

**Combinations with no meaning.** `isLoading && isCreatingGroup`; `error` with `hasGroup` and no failed action
pending; `group` set by load while `groupRef` already holds a group created by a send.

**Reachable today.** The composer is not disabled while loading (`WhitenoiseDMScreen.tsx:92` checks
`!isClientReady || isCreatingGroup` only). A send before `loadDmGroupImpl` resolves sees `groupRef.current === null`
and creates a group, invites the peer (consuming one of their key packages and putting a second request in their
inbox) and overwrites the DM index, even when an index entry and group already exist. When load resolves later it
calls `setGroup(found)` (or `setGroup(null)` and `setMessages([])` for a first conversation), replacing the created
group in state; whichever lands last wins and the other group is orphaned. Traced (D8). The orphaned-group-on-failed-invite
and lost-text cases are F206.

**Persisted.** Indirectly: `whitenoise:<accountIndex>:dm-index:<pubkey>` (value overwritten, shape unchanged) and
Marmot group state. A conversion does not touch stored shape.

**Consumers.** 2 files (`useWhitenoiseDM.ts`, `WhitenoiseDMScreen.tsx`).

**Pinned.** `whitenoiseDmSend.test.tsx` (open, create, double tap, failures, live events), `whitenoiseStorage.test.ts`.
Needs first: a send issued before load resolves, with and without an existing index entry.

**Recommendation.** Convert to a reducer with a discriminated union; `send` waits for (or is refused before)
Loading → settled; `groupRef` goes. S.

**Deletes.** `isLoading`, `isCreatingGroup`, `groupRef`/`useLatestRef`, the screen's four-way empty-text ternary
(it reads the phase). About 40 lines.

---

## 5. Signer "hot" flag with three owners

**Files.** `features/nostrSigner/data/nip46RequestsStore.ts:97-102,318-320`; writers
`screens/ShareSignerScreen.tsx:117-124` (focus), `components/SignerConnectSheetContent.tsx:200-221,598-608` (sheet life),
`hooks/useConnectSheetOpener.ts:36-52`, `lib/openPairingFromUri.ts:86`; reader `hooks/useNostrSignerService.ts:86-114`.

**Variables.** One boolean `serviceHotRequested`, written `true`/`false` by three independent owners.

**States.** Cold, Hot(by share screen), Hot(by connect sheet), Hot(by both). The boolean can express only Cold/Hot.

**Reachable today.** With no active connection, Share Signer focused (true), a nostrconnect link opened by deep link
or paste shows the connect sheet over it (true); closing the sheet runs `releaseIfSheetClosed` → false while the
Share screen still shows its bunker link, so `shouldRun` drops and the engine stops; a client connecting with that
link gets no answer until the screen loses and regains focus. Traced, edge (D10).

**Persisted.** No (session store).

**Consumers.** 6 files.

**Pinned.** `nip46PairingEntry.test.ts` (flag set/cleared), `nip46SignerService.test.ts` (start conditions).
Needs first: two holders, release of one.

**Recommendation.** Convert to a lease set, as `acquirePublicBLEMesh` already does in `BitChatModule.ts:198-206`:
`acquireSignerHot(): release`. S.

**Deletes.** `setServiceHotRequested` and the "the surface that set it owns resetting it" rule.

---

## 6. Whitenoise setup (hook and banner)

**Files.** `features/whitenoise/hooks/useWhitenoiseSetup.ts:27-145`; `components/WhitenoiseSetupBanner.tsx:61-99`;
`screens/WhitenoiseSetupScreen.tsx:14-47,87-89`; `features/user/components/SendMessageMenu.tsx:43`.

**Variables.** Hook: `keyPackageCount` (read once, then kept by `+1/-1` event deltas: a derived value stored),
`isLoading` (starts `true`), `isBootstrapping`, `error`. Banner: its own `phase` (`idle|running|success|gone`).

**Reachable today.** `bootstrapImpl` catches and returns normally, so the banner's `await bootstrap(); setPhase('success')`
shows the green check after a failed bootstrap; then `phase === 'gone' && !isReady` sends it back to `idle` and the
card reappears with no error (the banner never reads `error`). Traced (D9). With no client `isLoading` never leaves
`true`, so the setup screen's button stays disabled with no message (traced, minor). The count can drift if
`count()` resolves after a `keyPackageAdded` it already includes (traced, needs timing; the bootstrap's final read
repairs it).

**Persisted.** No.

**Consumers.** 4 files. Each hook instance has its own state and single-flight, so the screen and the banner can
bootstrap at once.

**Pinned.** None for the hook or the banner (`sendMessageRecommendationMenu.test.tsx` mocks the hook).

**Recommendation.** Convert: `bootstrap` returns a result the banner branches on; one union
`Unavailable|Checking|NeedsSetup|SettingUp|Ready|Failed(error)`; count re-read on events instead of incremented.
Pin the banner's failure path first. S.

---

## 7. BitChat bridge lifecycle (defer)

**Files.** `modules/bitchat-module/src/BitChatModule.ts:149-206` (`currentStart`, `lifecycle` queue,
`publicMeshLeases`), `:256-262` (incoming DM filter by `currentStart.profileScope`);
`features/nearPay/hooks/useNearbyDiscovery.ts:255-284`; `features/bitchat/hooks/useBitChat.ts:155-159,185,273`;
`features/bitchat/screens/NetworkSheet.tsx:91`.

**Variables.** `currentStart` (the last *requested* start, set before native runs), the promise chain, the lease set.

**Reachable.** The filter switches when a start is requested (F207, pinned in `bitchatBridgeLifecycle.test.tsx:309-325`).
A failed start leaves `currentStart` set, so a later lease acquire/release restarts it. Two owners pass different
requests (`useBitChat` passes the hook's `nickname`, possibly `''`; discovery passes `nickname || 'sovran'`), and
whichever called last is what every lease restart replays. Traced.

**Persisted.** No (native storage out of scope, F198).

**Recommendation.** Defer: the fix (separate Requested from Running, owners register requests) needs native
confirmation on both platforms and is entangled with F207's open question; the pins in
`bitchatBridgeLifecycle.test.tsx` hold the current order.

## 8. Whitenoise request accept/decline (defer)

`features/whitenoise/hooks/useWhitenoiseRequests.ts:36-179`: `busyId` and `error` shared by two single-flights;
join → index → markAsRead with no record of which step completed. F206 covers the double join and the unblocked
decline. One addition: accepting a second invite from a peer who already has a DM group overwrites
`whitenoise:<i>:dm-index:<pubkey>` and orphans the first group's history (traced; D8 on the peer's side produces such
an invite). Defer to F206's decision. Pinned in `whitenoiseInboxRequests.test.tsx`.

## 9. Whitenoise inbox start (defer)

`features/whitenoise/hooks/useWhitenoiseInbox.ts:50-173`: `cancelled`, `unsubscribe`, `cursorHighSec`,
`cursorUnknown` form Starting/Subscribed/Failed/Stopped. No retry after a failed start is F184. Also: the cursor
advances on ingest, before decrypt, and nothing calls `decryptGiftWraps()`, so a gift wrap ingested but not
decrypted (kill between the two awaits) is never decrypted; the 60 s overlap re-fetch is deduped by `seen`. Narrow
window, traced. Defer with F184; a conversion would also decrypt `getReceived()` on start.

## 10. Signer engine pending queue and contexts (defer)

`features/nostrSigner/lib/nip46Engine.ts:255-269,339-364,772-807,917-929,1061-1097`,
`lib/verdictResolver.ts:99-158`, `data/nip46RequestsStore.ts:178-238`. Parallel collections: the runtime store's
`pending[]` and the engine's `pendingContexts` map, both keyed by request id, plus `generation` for staleness and a
sweep timer that runs only while `pending` is non-empty. Every removal path (sweep, resolve, block flush, stop)
removes from both; I found no reachable divergence. `nip46Engine.test.ts`, `nip46RequestsStore.test.ts`,
`nip46ApprovalController.test.ts` pin it closely. Defer: folding the context into the store entry would delete the
map and the seam's `takeContext/deleteContext`, but the gain is small and the code is security-sensitive.

## 11. `useBitChat` chat session (defer)

`features/bitchat/hooks/useBitChat.ts:150-295,391-422`. `isConnected` is one flag written by four effects; the
`ble` effect has no cancelled check, so an earlier `startBLE` resolving after a dependency change sets it `true`
again (traced, display only: the dot in the non-DM header). Local echo uses `isPending` and removes the row on
failure: F183. Defer to F183's decision on how a failed send is shown; the local rows would then take the same
union as candidate 1.

## 12. Merchant detail load

`features/map/screens/MerchantDetailScreen.tsx:54-92,156-180,249-284`: `place`, `isLoading`, `loadFailed`,
`retryCount`. A `placeId` change on a mounted screen keeps the old merchant shown without a loading state
(traced; the stack pushes a new screen in practice). Pinned in `mapCameraMerchantDetail.test.tsx`. Convert cheaply
to `Loading|Loaded(place)|Failed|Missing` if touched; otherwise leave.

## Leave

- `features/nearPay/lib/nutDropStrikeState.ts` and `hooks/useNutDropStrike.ts`: already an explicit union and a
  pure derive with deadlines (`nutDropStrikeState.test.ts`). It loses its private status copy under candidate 2.
- `features/bitchat/hooks/useBluetoothState.ts`: one union, one setter.
- `features/nostrSigner/hooks/useSignerApprovalController.ts`: two refs and pure helpers, unit-tested.
- `features/map/hooks/useMapCamera.ts`, `useMapMarkers.ts`: timers and refs for rendering; `markersRef` and
  `markers` are written together in one function. Pinned (`useMapMarkers.test.ts`, `mapCameraMerchantDetail.test.tsx`).
- `shared/lib/routstr/topUp.ts`: already returns a discriminated result; pinned by `routstrTopUp.test.ts`.
- `nip46ConnectionsStore` `status`: two values, explicit schema.

---

## Defects

Not repeated from `docs/follow-ups/`: F183 (silent failed public/geohash send), F184 (inbox start not retried),
F206 (Whitenoise leftovers on failure), F207 (bridge filter timing; AI kill and mid-stream loss), F77, F195.

| # | Defect | Where | Path | Failing test idea | Stored data or wire format? |
| - | ------ | ----- | ---- | ----------------- | --------------------------- |
| D1 | A BLE DM the watchdog marks failed at 15 s stays failed when native later reports `sent`/`delivered`; the person retries and the peer gets it twice | `bitchatDmMessages.ts:217`, `useBitChat.ts:493-509` | send to a mesh-only peer (banner promises a 15 s spool), `delivered` arrives at 16 s. Run (composition of two pinned tests) | append, fire watchdog, apply `delivered`: expect `delivered` | Transition only; saved shape kept (decode `failed`+`timeout` as unconfirmed). Pinned as intended in `bitchatDmMessages.test.ts:169`, so the owner rules |
| D2 | Retrying a failed BLE DM leaves the failed bubble retryable; each tap (or a double tap) sends another copy | `GeohashChatScreen.tsx:316-323`, `ChatMessageBubble.tsx:218-235` | tap "Tap to retry" twice | two taps on one failed row: expect one native send | No |
| D3 | A Nut Drop that arrives, or a manual "try again", while a drain runs is not redeemed until the next foreground, connectivity change or message | `wallet/src/transport/redeemOrchestrator.ts:121`; callers `useNutDropAutoRedeem.ts:145`, `MessageEcashMintScreen.tsx:116`, `MessageEcashToReview.tsx:52` | two drops in quick succession; the second sits `pending` while the app stays open | drain A blocked on `executeAutoRedeem`, enqueue B, call drain, release A: expect B redeemed | No |
| D4 | A drop redeemed but interrupted before `redeemed` is saved is later classified `spent`: red "Token was already redeemed" toast for ecash that arrived, and no sender or Bluetooth badge on the history row | `redeemOrchestrator.ts:133-141,186,203-206`; `nutDropAutoRedeem.ts:154-159` | kill (or profile change) after the mint swap; next launch drains the `redeeming` entry | `redeeming` entry, receive throws "already spent": expect no failure toast | No shape change; the fix needs a way to tell own redemption from someone else's (decision) |
| D5 | Switching conversation or starting a new one while an AI answer streams: the paid answer is saved nowhere; the old session keeps an empty "interrupted" answer and its question stays `pending: true` | `routstrStore.ts:673-688,1618-1630`; `useAiSend.ts:815,1119`; `sessionsPopup.ts:58-62` | header clock → pick another conversation mid-stream | start send, `switchSession`, finish stream: expect the answer in the original session | Saved `routstr-store` gets a stuck `pending: true`; fix needs no shape change |
| D6 | When two AI streams overlap, the older one's `finally` clears the newer one's live text and sets `isSending: false` while it still streams | `useAiSend.ts:272-274,931-934`; `streamingBuffer.ts:75-81` | retry (context still assembling, `isSending` false) then a composer send | two overlapping `streamIntoPlaceholder`; expect the second's buffer and status intact after the first aborts | No |
| D7 | An AI stream aborted by the screen unmounting deletes the answer placeholder, leaving a question with no answer and no retry, which the code's own rule forbids (`useAiSend.ts:941-944`) | `useAiSend.ts:872-876` | leave the AI screen mid-stream (unmount) | pinned today at `aiConversationBranchStream.test.tsx:421`; flip to expect a retryable interrupted turn | No |
| D8 | A Whitenoise DM sent before the conversation finishes loading creates a new MLS group even when one exists, invites the peer again (spending one of their key packages) and overwrites the DM index | `useWhitenoiseDM.ts:296-325`, `WhitenoiseDMScreen.tsx:92` | open an existing chat, send before `loadAllGroups` resolves | hold `loadAllGroups`, send: expect no `createGroup` | Overwrites `whitenoise:<i>:dm-index:<pubkey>` (value only); peer-visible Welcome |
| D9 | The Whitenoise setup banner shows its success check after a failed bootstrap, then the card comes back with no error | `WhitenoiseSetupBanner.tsx:83-88`, `useWhitenoiseSetup.ts:88-94` | key-package publish fails | bootstrap rejects at relay: expect banner not in `success` | No |
| D10 | Closing the connect sheet clears the signer's hot flag while Share Signer still needs it; with no active connection the engine stops under a link being shown | `SignerConnectSheetContent.tsx:214`, `ShareSignerScreen.tsx:117-124`, `useNostrSignerService.ts:89-90` | Share Signer focused, open a nostrconnect link, close the sheet | two holders, release one: expect engine still started | No |

Lower, traced, not promoted: redeemed entries keep a stale `lastError` (`nutDropRedeemQueueStore.ts:255`); the
setup screen's button stays disabled forever with no client (`useWhitenoiseSetup.ts:100,105`); a Whitenoise gift wrap
ingested but not decrypted before a kill is never decrypted (`useWhitenoiseInbox.ts:130-152`).

## Not read

- Native BitChat bridges (Swift, Kotlin) and vendored BitChat: whether native ever emits `failed` after `delivered`,
  or re-delivers a spooled DM after a relaunch, is unknown and decides how much of candidate 1 is real-world.
- `features/bitchat/screens/NetworkSheet.tsx`, `components/BluetoothNotice.tsx`, `hooks/useLocationTiers.ts` beyond
  a skim.
- Signer screens and components (`SignerConnectSheetContent.tsx` beyond the hot-flag lines,
  `SignerApprovalSheetContent.tsx`, `SignerAppDetailScreen.tsx`, activity screens, gesture demo); `nip46Engine.ts`
  lines 384-740 (handlers, connect, policy pipeline); `nip46Transport.ts`; `bunkerSecrets.ts`,
  `pairingIntentStorage.ts`, `useResumePendingPairing.ts` (all closely pinned per pass 0).
- AI: `useAiSend.ts` lines 480-690 (candidate walk and stream loop body), `ProviderListScreen`, `ProviderInfoScreen`,
  `useModelCatalog`, `reserve.ts`, `branching.ts`, `format.ts`; Routstr `api.ts`, `sdk/client.ts` (the paid-attempt
  phase variables pass 0 listed belong to the payments survey's reading of Routstr).
- Whitenoise `client/network.ts`, `client/signer.ts`, storage backend internals (pinned in pass 0).
- Map `MapScreen.tsx` and `StatsCard.tsx`.
- `useDmEcashAutoRedeem.ts`, `dmEcashIntake.ts`, `parkedMessageEcash.ts` were read only for how they use the queue
  statuses; their own logic is the payments survey's.
- Nothing was run on a device. Only the two BitChat test files above were run.
