# Loop notes

Memory for `LOOP_PROMPT.md` passes. Newest entry last.

## Per-rail failure table

| Rail | Stage | Failure | Signal | Funds | Next step | Verified? |
| --- | --- | --- | --- | --- | --- | --- |
| BOLT11 melt (amountless invoice) | Choose | Mint can't pay invoices with no amount | Mint info: bolt11 melt `MeltMethodSetting.options.amountless` absent/false (`../../nuts/23.md:258-270`) | Spendable (nothing sent) | Pay from another mint that advertises `amountless`; else ask for an invoice with an amount | Spec yes; Sovran behaviour not confirmed |
| BOLT11 melt (amountless invoice) | Quote | Mint rejects the amountless quote | Depends on the mint: nutshell 11011 always (`../../nutshell/cashu/mint/ledger.py:1094-1096`, it has no amountless support); cdk 11011 only if `options.amountless` is sent to a mint without it (`../../cdk/crates/cdk/src/mint/melt/mod.rs:199-206`); cdk+CLN with no option → 50000 "Payment backend error" (`../../cdk/crates/cdk-cln/src/lib.rs:361-364`, `../../cdk/crates/cdk-common/src/error.rs:1140-1145`) | Spendable (quote only) | Same as above | Spec yes; Sovran maps 11011 to `cashu.amountless_invoice` (`app/shared/lib/errors/catalog.ts:175`). Sovran sends no amount, so it fails even where supported (see 2026-09-29 pass 2); which error the mint returns then is not confirmed |

## 2026-09-29 — amountless option cited to the wrong NUT

- **Problem:** README, `requirements.py` and the concept page said a mint's
  support for amountless invoices is NUT-05's `options.amountless`. NUT-05 only
  says `options` are "method-specific and can be defined in method-specific
  NUTs" (`../../nuts/05.md:268-272`); the bolt11 `amountless` option (both the
  melt-quote request field and the `MeltMethodSetting` flag) is defined in NUT-23
  (`../../nuts/23.md:143-157`, `../../nuts/23.md:258-270`). Error 11011 is still
  correctly listed under NUT-05 (`../../nuts/error_codes.md:16`).
- **Fix (correction only):** NUT-05 → NUT-23 at `README.md:111`,
  `requirements.py:66`, `concept/body.html:123` and `concept/body.html:313`. No
  model change; word counts unchanged.
- **Verification:** `bruteforce.py` ran clean (rankings unchanged, text-only
  change); `robustness.py 300` ran clean (bip321 lead 0.485, 100%);
  `concept/build.py` wrote `dist/send-receive-forms.html`; `check.cjs` →
  "concept page check passed".
- **Open questions:**
  - README claims "Sovran never reads `options.amountless`". The grep found
    only `app/features/mint/lib/mintChanges/nuts.ts:67` (a label for
    mint-change diffs) and the 11011 catalog entry. Confirm that no send path
    gates on it (`app/features/send`, `wallet/src/detectors.ts`) before
    counting it as verified.
  - Does coco/cashu-ts send `options.amountless.amount_msat` on the melt
    quote? Look in `../../coco` and `../../cashu-ts` melt-quote builders.
    Without it, an amountless bolt11 fails even on a mint that supports it.

## 2026-09-29 (pass 2): Sovran never sends the amount for an amountless bolt11

- **Problem:** the README said Sovran "only fails at the melt quote (error
  11011)" because it ignores `options.amountless`, which implies it works on
  mints that support the option. It doesn't: Sovran builds every bolt11 melt
  quote as `methodData: { invoice }` with no `amountSats`
  (`wallet/src/operations/defaultOperations.ts:1453-1458` in `quoteMelt`, and
  again at about `:1584-1587` in `executeMelt`). Installed coco 2.0.0 sends
  `options.amountless.amount_msat` only when `amountSats` is set
  (`node_modules/@cashu/coco-core/dist/index.js:10312-10314`;
  source `../../coco/packages/core/infra/handlers/melt/MeltBolt11Handler.ts:24-28`);
  cashu-ts forwards it (`../../cashu-ts/src/wallet/Wallet.ts:3917-3947`). NUT-23
  puts the amount in that request field (`../../nuts/23.md:143-157`). So the
  amount the user types for an amountless invoice never reaches the mint. The
  exact error the mint then returns (11011 or something else) is not confirmed,
  so I dropped the error code.
- **Fix:** rewrote `README.md:117-118` to "Sovran neither checks
  `options.amountless` nor sends an amount, so these fail at every mint's
  quote; the concept checks first." That is the same number of words (README
  now 1,472). No model change: the concept already models the check.
- **Verification:** `bruteforce.py`, `robustness.py 300` and `build.py` exited 0;
  `check.cjs` printed "concept page check passed". No rankings changed.
- **Resolves:** the open question about coco/cashu-ts `amount_msat` from pass 1
  (both libraries support it; Sovran doesn't use it). The question "does any
  Sovran send path gate on `options.amountless`?" is answered too: none does
  (grep of `app/features/send` and `wallet/src` finds only comments).
- **Open questions:**
  - What do cdk and nutshell return for an amountless bolt11 melt quote that
    has no `options.amountless`? Look in `../../cdk` (melt quote handler) and
    `../../nutshell` (`cashu/mint/ledger.py` melt_quote). That decides the
    signal in the failure table.
  - This is an app bug, not a research one. A fix would pass `amountSats` for
    bolt11 targets with no decoded amount in `quoteMelt`/`executeMelt`. It is
    out of scope for this loop; raise it with the user.

## 2026-09-29 (pass 3): what a mint returns for an amountless bolt11 with no amount

- **Problem:** the failure table gave error 11011 as the Quote-stage signal
  for an amountless bolt11. That holds for nutshell only.
  - nutshell raises `AmountlessInvoiceNotSupportedError` (11011) whenever the
    invoice has no amount, with or without options (`../../nutshell/cashu/mint/ledger.py:1094-1096`;
    code at `../../nutshell/cashu/core/errors.py:138-140`).
  - cdk returns 11011 only when the wallet sends `options.amountless` to a
    mint whose bolt11 setting lacks it (`../../cdk/crates/cdk/src/mint/melt/mod.rs:199-206`).
    With no option at all (Sovran's case, pass 2), the CLN backend fails in
    `get_payment_quote` with `UnknownInvoiceAmount` (`../../cdk/crates/cdk-cln/src/lib.rs:332`,
    `:361-364`; LND same at `../../cdk/crates/cdk-lnd/src/lib.rs:95`). That surfaces as
    `ErrorCode::Unknown(50000)` "Payment backend error"
    (`../../cdk/crates/cdk-common/src/error.rs:1140-1145`).
- **Fix:** corrected the Signal cell of the BOLT11 Quote row in the failure
  table. The page and README don't cite 11011 (grep finds none), and the page
  already catches this at the Choose stage from mint info (`concept/body.html:313`),
  so no page change is needed.
- **Verification:** `bruteforce.py`, `robustness.py 300`, `build.py` exited 0; `check.cjs` printed "concept page check passed".
- **Consequence for Sovran (idea, unverified on device):** `app/shared/lib/errors/catalog.ts:175`
  maps only 11011 to `cashu.amountless_invoice`. On a cdk mint the same user
  mistake shows a generic backend error with no next step, which is a dead end.
- **Open questions:**
  - Which error do cdk-ldk-node and cdk-fake-wallet backends give here? Look in
    `../../cdk/crates/cdk-ldk-node/src/lib.rs` and `../../cdk/crates/cdk-fake-wallet/src/lib.rs`.
  - Should the page model the "mint info stale" case, where the Choose check
    passes but the quote fails? That would put a Quote-stage ⋯ item ("Pay from
    another mint") on the amount step. Look at `concept/body.html:300-320`.

## 2026-09-29: Zeus added to the comparison (user request)

- **Change:** Zeus (`../../zeus`, Cashu mode) added as a baseline in
  `bruteforce.py` (send: method → entry → amount, skip=y, lock=method_option,
  confirm=melt_only, send_all=n, dead_end; receive: method → amount,
  claim=confirm). It also gets a column in the concept page matrix
  (`WALLETS`, `SCREENS`, `FEATURES`) and a row in the README baselines.
- **Results:** send 2.62 (shown as 2.6), receive 2.12 (2.1). No design ranking changed.
- **Evidence (zeus paths):** menu "Send Ecash / Send"
  `components/LayerBalances/EcashSwipeableRow.tsx:69-97`; kind detection
  `utils/handleAnything.ts:407-475`; amount only for amountless invoices
  `views/PaymentRequest.tsx:329`; ecash one tap `views/Cashu/SendEcash.tsx:292-326`;
  Lightning swipe review `views/Cashu/CashuPaymentRequest.tsx:1139`; lock button
  `SendEcash.tsx:440-463`; offline warning only `SendEcash.tsx:360-366`; receive
  tabs `views/Cashu/ReceiveEcash.tsx:423-454`; claim tap
  `views/Cashu/CashuToken.tsx:555-570`; unified QR node-only `views/Receive.tsx:610-673`;
  amountless melt not wired `stores/CashuStore.ts:4314-4321`; NUT-15
  `CashuStore.ts:1078-1085`; claimed-token watch `CashuToken.tsx:143-151`.
- **Feature string:** `nyppyypnn ?nyp ypnpp yyn pyn ppppnnnyp yypy` (37 rows,
  same order as `FEATURES`).
- **Modelling choices to recheck:** confirm=melt_only because ecash has no
  review and Lightning does. offline_unverified=hold because Zeus queues
  offline tokens as pending (`CashuStore.ts:5031-5064`). Whether pending
  counts in the balance is not confirmed; if it does, use "count" as for Minibits.
- **Verification:** all four commands pass ("concept page check passed"). README now 1,499 words.
- **Open:** row 10 (quick amounts) is still "?"; look in `components/AmountInput.tsx`.
  Row 8 (unified QR fallback) is "n" only because nothing was found.

## 2026-09-29 (pass 4): Zeus "Quick amounts" resolved

- **Problem:** the Zeus cell for "Quick amounts" was "?" (open item from the Zeus entry).
- **Finding:** Zeus's only preset amount buttons (50k / 100k / 1m / Other) are
  on the home keypad and render only when `!ecashMode && belowMinAmount &&
  !overrideBelowMinAmount` (`../../zeus/views/Wallet/KeypadPane.tsx:440-512`). They
  lift a Lightning amount above the channel provider's minimum; they are not
  quick amounts, and they never show in ecash mode. `components/AmountInput.tsx`
  has only a unit toggle (no preset buttons).
- **Fix:** Zeus cell "?" → "n" (`concept/body.html:712`). No model change.
- **Verification:** all four commands pass ("concept page check passed").
- **Open questions:**
  - Do pending offline tokens count in Zeus's balance? This decides hold vs count
    in the Zeus receive baseline. Look at the `CashuStore.ts:5031-5064` pending
    queue and the balance getter in `../../zeus/stores/CashuStore.ts`.

## 2026-09-29 (pass 5): mint selection, per-mint failure and unreachable mints (user request)

- **Problem (from the user, then checked):**
  1. The page had no idea of *which* mint failed. A simulated ecash or
     Lightning failure closed the whole rail, so the only next step was
     another rail. Sovran's retry does the same: `retry` rebuilds the same
     constraints and returns to amount entry (`wallet/src/machine/transitions.ts:374-395`).
     No failed-mint exclusion was found (grep for failedMint/excludeMint/triedMint
     in `wallet/src` and `app/features/send`: none). So a user who retries
     repeats the same failing mint unless they change the MintSelector pill
     (`app/features/send/screens/AmountSelector.tsx:401`) themselves.
  2. The "mint down" scenario only covered mint.sovran.money.
  3. Ecash from a mint that isn't answering, delivered online over Nostr, was
     shown as fine ("no mint needed"). The receiver has to swap it at that mint
     to claim it, and the payment only settles when they do (`../../nuts/03.md:21`).
     So it arrives but can't be claimed, and the sender's proofs sit pending
     until then.
- **Fix (`concept/body.html`, `head.css.html`, `check.cjs`):**
  - The scenario control is now "Mint not responding: None / mint.sovran.money /
    mint.minibits.cash", and the status line names the mint.
  - `byReach()` orders mints reachable-first, keeping the user's order otherwise.
    It is used for Cashu requests, Lightning and a contact's accepted mints.
  - Ecash rejected by a mint (simulated) moves on to the next mint that the
    receiver accepts and you hold enough at, then to the next rail. The same
    goes for Lightning ("found no route" → next mint). Nothing is asked of the
    user; that is the answer to "retry repeats the doomed flow".
  - Ecash from an unreachable mint while online is a last resort only, with the
    explicit label "they can claim it once it's back".
  - Pay step summary: a skipped or failed rail lists every mint's reason, so a
    rejection isn't hidden behind the next mint's "not enough".
  - `check.cjs` now runs four scenarios: online, offline, sovran down and minibits down.
- **Verification:** `bruteforce.py`, `robustness.py 300` and `build.py` exited 0;
  `check.cjs` printed "concept page check passed". Rendered by hand:
  sovran down + Cashu request → "Send 1,024 sats from mint.sovran.money anyway"
  (last resort); ecash rejected → Lightning from mint.sovran.money, with the
  rejection shown.
- **Not changed (open):**
  - `bruteforce.py` has no per-mint failure. Automatic next-mint retry saves the
    "pick another mint" screen a manual selector costs. Model it as a Pay-stage
    failure with probability p per mint: auto → 0 extra screens, manual
    selector → +1. Look at `walk_send` in `bruteforce.py`.
  - README: the facts table row "Online / mint reachable" should say
    "reachable mints first; a failed mint moves to the next". This needs a
    3-word trim elsewhere to stay under 1,500 words.
  - Does coco expose mint reachability cheaply (a cached `/v1/info` age or a
    last-error timestamp) so the Choose stage can weight mints without a
    network call? Look in `../../coco/packages/core` (mint adapter or MintInfo
    cache). Unknown must not count as failed.
  - "idea": the page weights purely by reachability. A real ranking would also
    weigh balance, input fees (NUT-02) and the receiver's preference order in
    NUT-18 `m`. Unverified against any shipping wallet.

## 2026-09-29 (pass 6): README matches the per-mint fallback

- **Problem:** the README facts table row "Online / mint reachable" still said
  only "Offline: ecash from held pieces only". Since pass 5 the concept page
  orders reachable mints first and moves on from a failed mint (`concept/body.html`,
  `byReach` and the retry loops). An unreachable mint's ecash can't be claimed
  until it is back (`../../nuts/03.md:21`). This was an open item from pass 5.
- **Fix:** the row now reads "Reachable mints first, failed ones skipped;
  offline: held pieces" (`README.md:28`). To keep the word count, two lines
  were trimmed: the caveat "robustness tests the ranking, not numbers" and
  "(others tie on Send all)". The README stays at 1,499 words.
- **Verification:** `bruteforce.py`, `robustness.py 300` and `build.py` exited 0;
  `check.cjs` printed "concept page check passed".
- **Still open (from pass 5):** per-mint failure in `bruteforce.py`; coco
  reachability signal; the ranking "idea".

## 2026-09-29 (pass 7): a third demo mint and `mint_choice.py` (user request)

- **Request:** add more mints so more flows can be exercised, and add scripts
  that challenge the assumptions behind "the best flow".
- **Page (`concept/body.html`, `check.cjs`):**
  - A third demo mint, `mint.example.org` (1,022 sats, no fee, amountless yes,
    no BOLT12, no onchain). The name is deliberately fictional. It is added to
    the "Mint not responding" picker, and `check.cjs` now runs five scenarios.
  - With mint.sovran.money down, a 1,000 sat invoice now pays from
    mint.example.org (rendered by hand).
  - Pay step: each skip reason is its own line, and identical reasons are merged
    ("mint.a, mint.b: too little for amount + fee") to stay within the
    150-character budget. "not enough to cover the fee reserve" became
    "too little for amount + fee".
- **New script `mint_choice.py` → `mint_choice.md` (~2 s):** a Monte Carlo over
  random wallets (2–5 mints) comparing four policies: auto reachable-first
  (the concept), auto in the user's order, default mint + error + manual
  picker (Sovran today), and always-ask-first. It sweeps four assumptions:
  A1 stale reachability, A2 failures being per mint vs per payment, A3 users
  retrying the same mint, A4 share of mints down. Scores: extra screens, +3
  per unmade payment, +5 per ecash the receiver can't claim yet (NUT-03:21).
  - Result: auto_reach wins every row. Its lead over auto_order shrinks to 0.006
    at 50% stale reachability, so reachability ordering is only worth it
    while the signal is fresh.
  - **Challenge found:** auto leaves slightly more payments unmade (12.3%) than
    default_pick (11.4%), because a user who retries the same mint can get past
    a transient failure, while auto tries each mint once. Whether real
    failures are transient (retry the same mint once) or persistent per mint
    is not confirmed. Look at `../../coco` melt retry handling and cdk
    `crates/cdk/src/wallet/melt` for how a failed melt is retried.
- **Verification:** `bruteforce.py`, `robustness.py 300` and `build.py` exited 0;
  `check.cjs` printed "concept page check passed".
- **Open:**
  - The README artifact list doesn't mention `mint_choice.py` yet. Adding it
    needs about a 12-word trim to stay under 1,500 words.
  - Every rate in `mint_choice.py` is a guess (A1–A4 defaults). Candidates for
    real numbers are Sovran log-doctor melt/swap failure logs, and mint uptime
    from an audit site such as bitcoinmints.com (not verified to publish it).
  - More challenger scripts worth writing ("idea"): fee-aware mint ranking
    (NUT-02 input fees vs balance), and whether the receiver's order in NUT-18
    `m` should outrank the sender's preference.

## 2026-09-29 (pass 8): flow spec object, From/Into mint control, send receipt (user request)

- **Requests:** (1) online but the chosen mint is down → steer to a reachable
  mint without forcing it: round up/down here, *or* the exact amount from
  another mint picked by balance, plus a "change mint" control; (2) the mint
  control on every step where switching is safe; (3) one object that defines
  the whole flow, usable as a spec by other Cashu wallets; (4) a real final
  send state (who, how much, method, mint, lock, timeline) that always has a
  QR for ecash, whatever the transport.
- **New `flow.py` → `flow.json`:** send and receive steps, each with `asks`,
  `skip_when` and `mint_switch` (yes/no plus why). Also `MINT_SELECTION` (candidates,
  order, on_failure, not_responding_while_online, last_resort, user_override),
  `FAILURES` (the LOOP_NOTES table as data, rows marked verified or not), and
  `RECEIPT` (the fields a receipt must show). `concept/build.py` embeds it as
  `FLOW`, and the page decides where the mint control appears from
  `mint_switch`, so the spec and the demo can't drift apart.
  - Switch allowed on send amount / how / pay (nothing committed). Not allowed
    on the receipt (terminal; reclaim instead) or on `who`. Receive: allowed on
    intent, amount and QR (an unpaid quote just expires, NUT-04). Not allowed
    on claim (a token is swapped at its issuing mint, NUT-03).
  - The 20004 row cites `../../nuts/error_codes.md:29` (verified).
- **Page (`concept/body.html`, `head.css.html`, `check.cjs`):**
  - `rank(list, sel)` implements `MINT_SELECTION.order`: the user's pick first,
    else reachable, then larger balance. It is used by every send branch,
    `resolve()` (paste/scan/tap) and receive (the "Into" mint). The old
    hard-coded `MINTS[0]` is gone from the token, P2PK, Lightning-address and
    receive paths.
  - Mint control "From/Into <mint> · auto ▾": the menu has Auto plus each mint
    with its balance and state. It shows "unknown, you're offline" in airplane
    mode, never "down" (unknown ≠ failed). A mint the receiver doesn't accept,
    or can't cover the amount, is disabled with the reason.
  - When the chosen mint isn't responding while online, the amount verdict
    offers "Exact N sats from <best reachable mint by balance>" next to ↓/↑
    rounding, and notes that ecash from this mint can only be claimed once it's
    back. The balance cards show the same state text.
  - Receipt (designed fresh, not ported from Sovran's timeline): a "Sent to"
    header with avatar or icon; the amount as the only large type; a hairline
    timeline (Created → Sent/Queued → Claimed/Paid); rows for Method, From,
    Lock, Claim fee (or Lightning fee), Via; and for ecash a token QR with
    Copy / Share / Write to card, plus whether showing it is safe (locked) or
    not. Screenshot checked at 500 px in headless Chrome (scratchpad only).
  - Added a `[hidden] { display: none !important }` rule. Locally the bottom-bar
    CTA and simulate menu showed on the receipt, because the page relied on the
    publisher's wrapper for that rule.
  - `check.cjs` now opens the mint control and completes a send for every contact,
    budgeting the receipt text.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:**
  - The receipt's "Claimed" relies on NUT-07 state checks. Confirm how coco
    watches a sent token (a proof-state subscription vs polling) in
    `../../coco/packages/core`.
  - Sovran shows a mint toggler on every possible page (user). Compare its
    rules with `flow.py` `mint_switch`, especially the `pay` step, in
    `app/features/send/screens/AmountSelector.tsx:401` and the confirm screens.
  - `flow.json` is the seed of a cross-wallet spec, but it doesn't yet cover
    tap-to-pay steps, request creation on receive, or per-rail
    `skip_when` rules as machine-checkable predicates ("idea": express them
    against `requirements.py` Rail fields so `bruteforce.py` can read them).
  - The README doesn't mention `flow.py` or `mint_choice.py` (word budget).

## 2026-09-29 (pass 9): top up a trusted mint to pay a single-mint request; coverage row (user request)

- **Problem (from the user's 2026-09-28 interop audit issue):** a NUT-18 request
  with a strict mint list (`m`, no `mp`) where Sovran holds too little at the
  listed mints is blocked, because the mint picker only offers listed mints
  (`ctx.supportedMintUrls`, `wallet/src/machine/transitions.ts`). cashubtc/wallet
  requests list exactly one mint.
- **Prior art checked:** cashubtc/wallet AcquireThenPay
  (`../../wallet/android/app/src/main/java/com/cashu/me/Core/Wallet/WalletCashuRequestPayment.kt`).
  The funding source is the largest-balance other mint with bolt11 melt (`:36-48`).
  The top-up amount adds an input-fee buffer for up to 32 proofs (`:21-33`).
  With no funding source it asks for an external top-up (`:9-15`). Per the audit
  issue it also *adds the requested mint*.
- **Policy decided by the user:** a last resort only; a setting; never add or
  trust a new mint. Only top up a mint already in the wallet. A bundled
  `lightning=` invoice is preferred.
- **Fix:**
  - `flow.py`: `MINT_SELECTION.top_up` (when, never, how, consent, setting,
    durability, prior_art), a new `SETTINGS` list (4 settings with their
    evidence), and a FAILURES row for "app killed between melt, mint and send"
    (unverified; next step: re-check the NUT-04 mint quote on restart).
  - Page: in `resolve()` the "Last resort: top up <mint>" rail runs after the
    bundled Lightning invoice and onchain, and before the unreachable-mint last
    resort. It only applies to listed mints you already hold, never inside a tap,
    and the source is chosen reachable-first by balance. It honours the "Lightning
    fails" simulation. There is a new setting "Top up a mint I already use to pay
    a request" (default on) and a demo payload "Cashu request only for a mint you
    hold too little at" (600 sats at mint.minibits.cash, which holds 418).
    The receipt adds a "Topped up" timeline step and a Top-up row.
  - Matrix: a new feature row "Top up a mint you use to pay a request"
    (`yn?y???`: Sovran n per the audit issue; Cashu Wallet y via AcquireThenPay,
    though it adds new mints; the rest not checked). Also a **Feature coverage**
    row at the top (✓ = 1, ◐ = ½, ? and – = 0, over 38 features): concept 97%,
    Sovran 75%, cashu.me 45%, Cashu Wallet 47%, Macadamia 42%, Minibits 43%, Zeus 50%.
  - Fixed along the way: the payload receipt called the recipient by the demo
    label; it now says "Cashu payment request" / "Lightning invoice", and
    "Watching for the receiver to claim it".
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed". Rendered by hand:
  on → "Move 183 sats from mint.sovran.money over Lightning (fee up to 2), then
  pay in ecash"; off → "Topping up a mint you use is off in your settings".
- **Open:**
  - Durability: which coco operation state machine would own melt → mint → send?
    Look at `../../coco/packages/core/operations` for resumable operations.
  - cashu.me, Macadamia, Minibits and Zeus top-up support is unchecked ("?").
  - Coverage treats every feature as equal weight; the per-feature weights in
    `bruteforce.py` would give a truer number ("idea").

## 2026-09-29 (pass 10): receipt timeline designed from first principles (user request)

- **Problem:** the receipt timeline was static. "Created / Sent / Claimed" were
  all shown at once, with invented details, and the header said "Sent to"
  even while the token was still being prepared or after a failure.
- **Design (the principles are in `flow.py` above `STEP`):**
  1. One step per question the sender has: did it leave, did it reach them, is it final.
  2. A step keeps its noun and only the tense changes, via label = (future,
     active, done). Example: "Alice claims it" → "Waiting for Alice to claim it"
     → "Claimed by Alice". Earlier lines read as history, not rewrites.
  3. Only the active step has a detail line. Done steps are past tense plus a
     time. Future steps are muted and promise nothing.
  4. The last done step keeps one result line when it is the outcome
     ("Final: it can't be taken back now", "Unused fee reserve came back").
  5. A failure replaces the active step with what happened, where the money
     is, and one next step; later steps are removed.
  6. Lasting facts (lock, mint, fees) stay in the rows, not the timeline.
  The header verb follows the timeline: Sending to → Sent to (once the sending
  step is done), Paid, Queued for, or Couldn't send to.
- **Spec:** `flow.py` has `STEP` (each step's labels, active detail,
  `active_locked` / `active_exact` variants, result, and fail = (title, where
  the money is, action)) and `TIMELINE` (the steps for ecash to a person, to a
  request, as a token, by tap, Lightning, onchain; a top-up adds a first step;
  a queued send uses `send.queued`). They are embedded in the page as
  `FLOW.timeline_steps` / `FLOW.timelines`.
- **Page:** `timeline()` renders from the spec, with the demo controls "Next
  event / Back online", "Fail this step" and "Replay". Screenshots of four
  states (start, waiting to be claimed, claimed, failed) were checked at 500 px
  in headless Chrome (scratchpad only). `check.cjs` walks every contact's
  timeline to the end and fails its first step, budgeting all text.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:**
  - "Sent to Alice" means the relays accepted the NIP-17 message. Whether coco
    or Sovran get a relay OK (NIP-01 `OK`) to base that on is not confirmed.
    Look at the NDK publish result in `nostr/`.
  - Claim detection (NUT-07 state polling vs a subscription) is still open (pass 8).
  - Reclaim ("take it back") after a lock with a locktime needs the locktime
    to pass (NUT-11 refund path). The active claim-step text should say so
    when a lock is set. It currently says "you can take it back" unconditionally.

## 2026-09-29 (pass 11): mint info gates every step; set-amount receive asks the method (user request)

- **Problem:** the page treated a mint as a set of on/off flags. Real mints
  publish per method-unit `min_amount` / `max_amount` / `options` and a
  `disabled` flag for minting (`../../nuts/04.md:160-187`) and melting
  (`../../nuts/05.md:245-272`), and a `supported` flag per NUT in `/v1/info`
  (`../../nuts/06.md:70-90`), e.g. NUT-11 P2PK. So 100 sats can be receivable
  over Lightning at two mints but not a third, and onchain at none. A
  set-amount receive also created every rail's quote up front, which loads
  the mint for methods the payer won't use.
- **Fix:**
  - Demo mints carry `limits.mint/melt[method] = [min, max]` and `p2pk`:
    sovran bolt11/bolt12 1–1M and onchain 25k–10M; minibits bolt11 1–100k;
    example.org bolt11 200–500k with no P2PK. `lim(m, op, method, amt)`
    returns '' or a short reason.
  - Send: Lightning and BOLT12 check melt limits per mint; onchain checks melt
    limits; the top-up needs NUT-04 bolt11 limits at the target and NUT-05 at
    the source; a Lightning address picks a mint whose melt limits fit; the
    person Lightning way needs a mint within limits; a locked request skips
    mints without NUT-11; the lock slider becomes "can't lock tokens (no
    NUT-11), so it goes unlocked. Change mint to lock it"; and a pasted P2PK
    key only uses NUT-11 mints (the others are disabled in the mint menu).
  - Receive with a set amount: Lightning / Ecash / Onchain / All chips. Only
    the chosen method makes a quote ("Asks your mint for N quotes" / "No mint
    quote needed"). The default is Lightning if any reachable mint can issue it
    at this amount, else Ecash. A method no mint can issue is disabled with the
    reason ("onchain from 25,000 sats at your mints", or the pinned mint's own
    reason). Each rail is issued at the first reachable mint whose limits fit.
    Any amount keeps one reusable code.
  - Fixed along the way: the BOLT12 detail printed `${m.name}` literally
    (single-quoted template).
  - `flow.py`: `MINT_INFO` (which `/v1/info` fields gate which step, with
    sources) and `RECEIVE_METHODS` (choices, default, why, and the tension below).
  - `check.cjs`: set-amount receive for 100 and 30,000 sats × every mint pin ×
    every method.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed". Rendered: 100 sats
  auto → Lightning at mint.sovran.money, Onchain off; pinned to example.org →
  Lightning off ("mint.example.org: Lightning from 200 sats"), defaults to
  Ecash; 30,000 → Onchain available.
- **Tension to resolve (open):** `bruteforce.py` still ranks the unified BIP-321
  receive QR first (lead 0.49 screens) because it saves the method question.
  The user prefers asking the method for set amounts because every quote costs
  the mint work. Add a mint-load term (quotes created per receive) to the
  receive score in `bruteforce.py` and see where the ranking flips. Until then
  the README's "Unified BIP-321 receive QR: yes" finding and the page disagree.
- **Also open:** NUT-07 unsupported → the receipt can't show "Claimed" (in
  `flow.py MINT_INFO`, not on the page); `nuts.4.disabled` / `nuts.5.disabled`
  are not simulated; mint info is assumed fresh (the Choose-stage cache age is
  still open from pass 5).

## 2026-09-29 (pass 12): mint load in the receive ranking

- **Problem (open from pass 11):** `bruteforce.py` ranked the unified BIP-321
  receive QR first without counting that it makes the mint create a quote for
  every quote-backed rail (NUT-04). The page now asks the method for set
  amounts, so the model and the page disagreed. The model also had no design
  matching the page: Lightning preselected, with switch chips on the QR screen.
- **Fix (`bruteforce.py`):**
  - `Walk.quotes` counts mint quotes per receive: set-amount Lightning and
    onchain rails; reusable any-amount codes cost none. Unified creates one per
    feasible backed rail; otherwise at most one.
  - New receive dimension `default_rail` (not with bip321): Lightning is
    preselected and a switch screen is spent only when the payer can't use it.
    That is certain for recv.cashu, never for recv.lightning, and
    `DEFAULT_RAIL_MISS = 0.3` for an unknown payer (**a guess**, labelled in the code).
  - `quote_load()` plus a new results.md section "Receive: cost of mint quotes"
    that sweeps the price of one quote in screens. The main ranking is
    unchanged in form (it is the cost-0 row).
- **Results:** best unified 1.846 (screens + dead-end) with 0.343 quotes per
  receive; best preselected-Lightning 1.936 with 0.298. The unified QR adds
  only ~15% more quotes because onchain is rarely feasible. Preselecting wins
  once a quote costs more than **2.01 screens**. Robustness (300 samples): the
  unified family now wins 68.7% of weightings, preselected Lightning 31.3%;
  the bip321 lead fell from 0.485 to 0.090.
- **README updated to match:** the findings row is now "Unified BIP-321 receive
  QR | yes (quote under 2 screens) | 0.09 | 69%", and "receive 69%, else
  preselected Lightning". Two asides were trimmed to stay at 1,497 words.
  `flow.py RECEIVE_METHODS.tension` records the numbers.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **What this says:** in screens alone the unified QR still edges ahead, but
  only just. The page's choice (preselected Lightning, All opt-in) is a
  defensible trade when mint load matters; that is an operator/product call,
  not something the model settles.
- **Open:**
  - `DEFAULT_RAIL_MISS` needs a real number: the share of set-amount payers
    who can't pay Lightning. A candidate source is Sovran receive logs (which
    rail paid a unified QR).
  - A quote's real cost to a mint: cdk/nutshell quote creation hits the
    Lightning backend (an invoice per quote). Look at `../../cdk/crates/cdk/src/mint/issue`
    and whether mints rate-limit quotes (NUT-19 cached responses?).
  - Should robustness.py sweep DEFAULT_RAIL_MISS too? At 0 miss, preselecting
    would tie or beat unified on screens.

## 2026-09-29 (pass 13): "Get paid by" is its own receive step (user request)

- **Request:** for a set amount, the method should be a step like "Get paid":
  tiles, pick one, and the QR step shows only that way. Pass 11 had chips on
  the QR step with Lightning preselected.
- **Fix:**
  - Page: receive with a set amount is now Get paid → Amount → **Get paid by** →
    QR code. Tiles: Lightning, Ecash, Onchain, All of them. Each tile names the
    mint that would issue it and the quote cost ("mint.sovran.money · 1 mint
    quote", "No mint quote needed", "2 ways in one code · 1 mint quote"). A way
    no mint can issue at this amount is disabled with its reason (NUT-04 limits,
    pass 11). The step is skipped when only one way is open, and the Into-mint
    control is shown on it (`mint_switch: yes`). The Amount button reads
    "Continue". The QR step lost its method chips.
  - `flow.py`: a new RECEIVE_STEPS entry `method`; `RECEIVE_METHODS.default` is now
    "none: the step asks".
  - `check.cjs`: returns to the method step before trying each way.
  - Screenshot of the step (100 sats) checked at 500 px (scratchpad only).
- **Model consequence:** this is the "ask the method" receive family, not the
  pass-12 `default_rail`. In `results.md` it costs about 0.5 screens more than the
  unified QR on screens alone, and wins only if one mint quote costs more than
  ~2 screens (pass 12). README's findings row still says the unified QR wins,
  with that caveat. The page follows the product decision; the difference is
  recorded, not hidden.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** should "All of them" be the first tile? It saves the question for
  payers of unknown wallets. It is a product call; the pass-12 numbers give the trade.

## 2026-09-29 (pass 14): lock control redesigned (user request)

- **Problem:** the lock used a native range slider with a tick row
  (Off/1h/1d/1w/30d/∞). It was unstyled, hard to hit on a phone, and mixed
  "lock or not" with "for how long" in one control.
- **Fix (`concept/body.html`, `head.css.html`):** a switch "Lock to <name>"
  (default off). When on, a custom segmented control "If unclaimed, take it
  back after 1h · 1d · 1w · 30d · Never" appears, defaulting to 1w. This maps to
  NUT-11's locktime with the sender as refund key; Never means no refund path.
  A pasted P2PK key shows "Locked to <key>" without a switch, because the lock
  is the point of that send. The receipt row now reads "… · take back after
  1 week" / "no take-back". The claim step gets `active_locked` in `flow.py`:
  "Only {to} can claim it. You can take it back after 1 week if unclaimed." /
  "It can't be taken back." This resolves the pass-10 open item where the
  claim step said "you can take it back" unconditionally. `check.cjs` switches
  the lock on and tries every period for each contact. Screenshots (off / on)
  were checked at 500 px (scratchpad only).
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** NUT-11 refund needs the locktime to pass *and* the sender's refund
  key. Confirm Sovran/coco set the sender as the refund key when locking
  (`wallet/src` lock paths, `../../coco` P2PK send options), otherwise "take it
  back" is not true.

## 2026-09-29 (pass 15): receipt continuity (user request)

- **Problem:** while the timeline said "Preparing the token", the receipt
  already showed the token's QR. The token, the transport line ("went by …")
  and "Start again" ignored the timeline, so the page contradicted itself
  mid-send.
- **Fix:** `timeline()` publishes `f.tlPhase` (tokenReady, sent, spent, failed,
  settled), and the rest of the receipt reads only that:
  - token: a same-size hatched placeholder until the token exists ("The token
    appears here once it's ready"); nothing if making it failed; the QR once
    ready and after a failed delivery ("It didn't go by …; share it another
    way"); "Claimed by Alice. This token is spent" once claimed.
  - transport line tense: "It's going by …" → "The same token went by …"
    (queued: "goes by … once you're online").
  - "Start again" → "Send another", shown only once settled (claimed, paid,
    failed or queued), never mid-send.
  - The header already followed the timeline (pass 10).
  - Principle 7 added to `flow.py`; placeholder and spent styles added.
- **Checked:** every phase of Alice's send printed as header | token | timeline;
  all consistent (start, token ready, delivered, claimed, fail at prepare,
  fail at delivery). A screenshot of the preparing state was checked at 500 px.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** continuity across the steps *before* the receipt (e.g. the amount
  shown on the send button vs the receipt amount when the claim fee is added)
  is not yet audited end to end.

## 2026-09-29 (pass 16): primary mint as a soft default (user request)

- **Request:** tap a mint card at the top to make it the primary. Second and
  third are ranked by balance. The primary is a soft recommendation on every
  step: used unless it can't be.
- **Evidence (Sovran, via jevgrep then grep):** Sovran keeps one persisted
  `selectedMint` per profile (`app/shared/stores/profile/mintStore.ts:23,57,119`),
  and `MintSelector` defaults to it (`app/features/wallet/components/MintSelector/useMintSelector.ts:66-67`).
  The concept's primary mirrors that, but softly: a step can move off it and says why.
- **Fix:**
  - `S.primary` (demo default mint.sovran.money). `byReach()` puts the primary
    first when it is responding, then reachable mints, then balance. Every
    step's own filters still apply (receiver accepts it, balance, NUT-04/05
    limits, NUT-11), so a primary that can't do the payment drops out naturally.
  - Balance cards are buttons, labelled Primary / 2nd / 3rd (the others ordered
    by balance). The selected card is outlined. Tapping one sets the primary and
    redraws.
  - Mint control: "· primary" when using it, "· auto" otherwise. When a step
    moves off the primary it says why, e.g. "Not your primary, mint.example.org:
    Alice doesn't accept it." / "…: can't lock (no NUT-11)." / "…: not
    responding." The mint menu marks the primary.
  - `flow.py MINT_SELECTION`: new `primary` rule with the Sovran citation; the
    order now starts with the primary, and balance ranks the rest.
  - `check.cjs`: each mint as primary × every contact.
- **Rendered with example.org as primary:** a shared token and a pasted
  invoice use it ("· primary"). Alice → mint.sovran.money, "Alice doesn't
  accept it". A pasted key → mint.sovran.money, "can't lock (no NUT-11)".
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** on receive, the "Into" control follows the primary, but when a
  rail (e.g. Lightning under the primary's minimum) is issued at another mint
  the tile names that mint without saying "not your primary: why". Consider
  the same hint on the "Get paid by" tiles.
- **Correction (same pass):** the first run of the extended `check.cjs` failed.
  The pass-8 verdict "<mint> isn't responding, so you can only send the pieces
  you hold there, and they can claim it once it's back" plus its chips came to
  171 chars (> 150), which the new primary × contact loop reached with
  mint.sovran.money down. It was shortened to "<mint> isn't responding: only
  pieces held there can go, claimable once it's back." All four commands now
  pass. Version 32 was published before this check finished; version 33 is the
  corrected one.

## 2026-09-29 (pass 17): receive receipts, Settings/Research sheets, themes, fictional mints (user request)

- **Receive final state.** A receive now ends in a receipt like a send's, with
  the same timeline rules (flow.py principles 1–7). Sovran's timeline is
  state-driven, with friendly labels over coco/cashu-ts states
  (`app/features/settings/screens/designSystemTimelineScenarios.ts:18,58`), so
  each receive step is a protocol state:
  - QR paid: Paid by <way> → Minting your ecash (NUT-04 PAID → ISSUED) → "Final:
    in your balance". Onchain adds a confirmation step; ecash (Cashu request)
    goes Paid → Claiming (NUT-03). The QR screen *was* the waiting state, so the
    receipt opens with "Paid" done; the demo CTA is "Simulate the payer paying".
  - Pasted token, known mint: Checking the token (NUT-07) → Claiming it (NUT-03)
    → "Final: … the sender can't take it back". It opens automatically (no
    question to ask), replacing the old inline "Claimed … Nothing to confirm".
  - Locked token offline: Verified offline (NUT-12 + NUT-11) → Waiting for <mint>
    (counts as pending). Unlocked offline: "Held aside".
  - New mint: "Add this mint" → Added → Unspent → Claimed; "Move it" → Unspent →
    Moving it to <your mint> (fee) → Moved.
  - Failures per step (expired, already spent, paid-not-minted with a retry, no
    route). Header: Receiving → Received / Not received. "Receive more" shows
    only once settled. Drafts freeze once the receipt shows (bug found by
    rendering: the move choice was overwritten on redraw).
  - `flow.py`: 11 receive STEP entries and TIMELINE kinds recv_ln, recv_btc,
    recv_ecash, claim, claim_offline, claim_later, claim_add, claim_move.
- **Less overwhelming layout.** One centred column. A top bar with a gear
  (Settings, top left), the title, and "Research" (top right). The Settings
  sheet (from the left) holds Theme, Your settings and the demo Scenario. The
  Research sheet (from the right) holds the comparison matrix, the QR/tap map,
  the paste map and About. Escape, Done or a tap outside closes them. The intro
  paragraph was removed.
- **Themes.** Paper (default), Ink (dark), Sand, Sage, Slate, Dusk (dark): the
  same tokens with different palettes, picked in Settings with swatches, and
  remembered per viewer in localStorage (wrapped in try/catch).
- **Fictional mint names.** mint.tidewater.cash, mint.kestrel.money,
  mint.northfield.io; the mint you don't use is mint.orchardbay.cash. Internal
  ids are unchanged. Earlier LOOP_NOTES entries keep the old names.
- **Checked:** screenshots at 500 px (main in Paper and Ink, the Settings sheet
  in Sand, a receive receipt in Sage). The receive timelines were printed for
  each kind. `check.cjs` now opens and closes both sheets, applies every
  theme, and walks every sample token to a receipt.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** contacts' NIP-05 and Lightning addresses still use real-looking
  domains (sovran.money, getalby.com); the "Get paid by" tiles don't yet say
  "not your primary: why" (pass 16); the Research sheet re-renders the matrix
  on open only.

## 2026-09-29 (pass 18): being paid by tap (from numo, first principles), and the failure catalogue (user request)

- **numo (../../numo @45d7cfb5, Android only):** an HCE Type 4 tag
  (`ndef/NdefHostCardEmulationService.java:19`), armed passively ~1 s after the
  request screen opens (`PaymentRequestActivity.kt:1401`). The tag serves
  creqA (no transports), bolt11, or a BIP-321 of both, depending on the tab
  (PRA:973-1030). The payer writes the token back in-band; Nostr, Lightning
  and BTCPay race it and the first outcome wins (PRA:1408). Budgets: 3.5 s
  between APDUs, 3 s partial write, 5 s tap (NdefHCE:49; PRA:2194).
  `90 00` is sent before the token is checked (NdefUpdateBinaryHandler:205-231).
  A duplicate tap is silently ignored (PRA:1256-1262). Overpay is kept, with no
  change. Unknown mints are refused, or melted to its Lightning mint (CPH:545-562).
- **Platform (docs/research/nfc-payment-requests.md §2–3):** Android can present
  a tag, but reader mode turns its own card emulation off. So passive listening
  follows the screen: Send reads, the Receive QR presents. iPhones can emulate
  only through `CardSession` (EEA, iOS 17.4+, Apple-managed entitlement, manual
  start, 60 s). Other iPhones can't be tapped to receive.
- **Model (`bruteforce.py`):** a new receive dimension
  `nfc_recv ∈ {passive, button, qr_only}`, with guesses P_IOS 0.5, P_EEA 0.2,
  QR_INSTEAD 0.5 and P_TAP_LOST 0.1 (all labelled). On "Get paid by tap":
  passive 2.36, qr_only 2.50, button 2.86. **A tap button on every phone is worse
  than just showing the QR** unless scanning costs the payer > 1.10 screens;
  passive wins from 0.27. The best receive family is now `… bip321=y ·
  nfc=passive` (68.7% of weightings). Baselines: Macadamia, Cashu Wallet and
  Zeus = button; the others = qr_only.
- **Page:** "Your phone: Android / iPhone in the EEA / iPhone elsewhere" is in
  the demo conditions. After the QR, a tap row: Android "Ready for a tap"
  (pulsing, listening while the code is on screen); iPhone EEA "Tap to receive
  · Start" (60 s); iPhone elsewhere "can't be tapped; they scan the QR"; Any
  amount "set an amount to be paid by tap". A tap carries what the QR carries.
  Lightning: "their phone reads the invoice and pays over Lightning" → receipt
  Waiting for the payment → Your ecash. Ecash: "their wallet writes ecash to your
  phone" → Receiving the tap → Check → Claim, with the fail state "The tap ended
  early · Nothing arrived; the token is still theirs. Tap again, or they scan
  the QR". This continuity bug (an ecash receipt for a Lightning QR) was found
  in a screenshot and fixed.
- **Failure catalogue (8 codebases):** 18 rows were added to `flow.py FAILURES`
  (26 total), each with the funds state, the next step and the best prior art.
  They render in the Research sheet as "Failure paths". The dead ends and who
  handles each best: already-spent token (Zeus checks NUT-07 first); melt
  stuck PENDING (cdk/Cashu Wallet saga resume, Minibits guarded Revert);
  missing NUT-08 change (cashu.me/cdk/coco store blanks; macadamia TODO);
  payment-request delivery failure (Sovran/cdk roll back); duplicate payment of
  a request (only Cashu Wallet guards the payer); 11006 limits (only coco
  pre-checks); a tap lost mid-transfer (only Sovran rolls back); swap failure
  mid-send (coco's definite-code list; macadamia marks proofs valid unchecked).
- **Spec bug found in Minibits:** `minibits_wallet/src/services/wallet/utils.ts:13-16`
  maps OUTPUTS_ALREADY_SIGNED 10002, QUOTE_PENDING 11005 and TOKEN_PENDING 11006;
  the spec has 11003, 20005 and 11002 (11006 = amount outside limit), so its
  pending branch misfires. Candidate upstream issue (not filed).
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed" (it now covers tap
  per platform and the failure table). Screenshot of the Android QR step
  checked at 500 px.
- **Open:**
  - Model the tap guesses from data (share of iPhones/EEA, tap loss rate from
    Sovran NFC logs); add `nfc_recv` to robustness `RECV_DIMS`.
  - Page: surface more catalogue failures as step fail states (melt PENDING
    "still settling", missing NUT-08 change "restoring your change").
  - The payer side of "90 00 ≠ paid" in the send tap flow: the receipt should
    stay "Handed to the terminal" until proof state changes. It currently
    advances by demo clicks.
  - README: no NFC row yet (word budget).

## 2026-09-29 (pass 19): scanner, Edit in the card, pickers that behave (user request)

- **Scanner.** A scan button sits between Receive and Send and opens a sheet:
  a camera viewfinder (the demo has no camera) and two real, orthogonal options,
  **Paste from clipboard** (`navigator.clipboard.readText`, with a message when
  the artifact frame blocks it) and **Pick from photos** (file input → native
  `BarcodeDetector`, else jsQR 1.4.0 from jsDelivr, since it isn't on cdnjs).
  Below them, examples of everything someone could show you: "To pay" (every
  paste example plus every payload, including the Cashu request, foreign-mint,
  locked, fee-mint, top-up and no-amount ones) and "To get paid" (four tokens).
  Whatever is read is routed: `cashuA/B…` → Receive › Claim; anything
  `classify()` knows → Send with it pasted; otherwise "Not recognised".
- **Edit inside the card.** A done step's summary card carries a pencil + "Edit"
  on its right edge, instead of a floating "Edit" outside it.
- **Pickers:**
  - Keyboard now matches the buttons. Before, Enter in a field submitted the
    form and jumped to the receipt whatever the bottom button said. Now Enter
    presses the bottom button (and does nothing when it's disabled). Escape
    closes the simulate panel, the mint menu and the people/terminal
    dropdowns, as well as the sheets.
  - Explicit close: the mint menu ("Pay from ✕") and the people list
    ("People ✕") have header close buttons.
  - Failure simulation: "⋯" became "⚠ Simulate" (icon only below 520 px) and
    opens a titled panel, "Simulate a failure on this step", with a switch per
    failure, "Clear all", "Done" and ✕. It closes on an outside click and
    focuses the first switch on open.
- Fixed along the way: a Cashu request that only the scanner exposed reached a
  159-char reason (no change offline). It was shortened to "<mint>: no change
  without the mint; nearest is N (+x, limit +y)".
- **Checked:** screenshots at 500 px (main with the scan button, the scanner
  sheet, and a scanned invoice with the simulate panel open). `check.cjs` now
  routes every scanner example and asserts that Enter never jumps to a receipt.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** the scanner could also accept `lightning:`/`bitcoin:` URIs and
  NFC tag contents (UR animated QR, NUT-16) as examples; the scan route skips
  the entry chooser, so "Edit" on Who returns to the Paste panel rather than the
  scanner.

## 2026-09-29 (pass 20): softer themes (user feedback: "elements a little strong, hard outlines")

- **Change (end of the body.html CSS, so it wins the cascade):** two theme-aware
  tokens, `--tint` = color-mix(fg 7%, surface) and `--ring` = color-mix(fg 16%,
  transparent). Selected chips, tiles, choices, mint cards, theme swatches,
  dropdown options and the Receive/Send tab now use the tint and ring
  instead of an inverted fill or a 1px `inset` fg outline. Chips are borderless
  on `--accent-soft`. The scan button, step numbers, timeline dots and focus
  states were softened; menu and sheet shadows lightened. Each theme's `--line`
  was lightened one step (Paper F0F0F0, Ink 232326, Sand ECE5D7, Sage E6EAE3,
  Slate E9EDF2, Dusk 27222C). The only solid element left is the main action
  (bottom button).
- Fixed: the "Get paid by" tile subtitle capitalised a domain
  ("Mint.tidewater.cash").
- **Checked:** screenshots at 500 px (Ink and Paper main, Ink "Get paid by").
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".

## 2026-09-29 (pass 21): receipt controls in the footer (user request)

- **Change:** on a receipt (send or receive), the bottom bar now drives the
  timeline. Main = "Next event" / "Back online", then "Send another" / "Receive
  more" once settled. Left = "Replay" once settled or failed (disabled Back
  while in progress). Right = "⚠ Fail this step" while a step can fail. The
  inline demo row and inline reset buttons are hidden with CSS but stay in the
  DOM, so `check.cjs` keeps pressing them; `renderNav()` forwards the footer
  clicks to them.
- **Checked:** Alice's receipt walked with footer clicks only: Next ×3 →
  Replay | Send another; Replay → back to start; Fail → "Couldn't make the
  token" with Replay | Send another; Send another → a fresh send.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".

## 2026-09-29 (pass 22): scanner with three sources, each with its own mock list (user request)

- **Change:** the scanner sheet now has a Camera / Paste / Photos segmented
  control. Each source lists what it could realistically hold, and the real
  action is the first row where one exists ("Use my real clipboard", "Choose
  a real photo…"). The viewfinder shows only for Camera.
  - Camera (33 rows): every payable example as "QR: …", the four tokens, an
    animated token QR (NUT-16), an upper-case LIGHTNING: QR, and failures (a
    website-link QR; a partial animated QR: "3 of 7 frames, keep the camera on it").
  - Paste (34): every example as "Copied: …", the tokens, `nostr:` / `lightning:`
    / `cashu:` links, and failures (a mint's URL: "Mints are added from the mint
    list; there is nothing to pay"; ordinary text; an empty clipboard).
  - Photos (10): a screenshot of an invoice, a shop's unified QR, a poster
    Lightning address, a printed paper-gift token, a profile QR, a bitcoin: QR,
    and failures (no QR in the image, blurry/cropped, a still of an animated QR:
    "scan it live").
  - Failure rows keep the sheet open and explain in a warning strip.
    `routeScan()` now strips `lightning:` / `cashu:` prefixes.
- Fixed along the way: lower-casing labels after "Copied" broke names and
  acronyms ("alice's", "bOLT12"), so the prefix is now "Copied: <label>".
- `check.cjs`: every row of every source, asserting that each routes (or, for
  failures, explains and stays open). A `freshRecv()` helper settles any
  in-progress receive receipt before resetting (a receipt in progress has no
  reset; this crashed the tap loop once).
- **Checked:** screenshots of all three sources at 500 px in Ink.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".

## 2026-09-29 (pass 23): the lock is part of the Ecash option (user request)

- **Change:** on a person's How step, the Ecash option and its lock are one
  card (`.choice-group`). The radio row sits on top, and when Ecash is chosen
  the "Lock to <name>" control (or "can't lock (no NUT-11)" / "not reachable"
  hint) appears inside the same card, indented under the description. It used
  to sit below all the options. The group is a div, not a label, because the
  lock's switch can't nest inside the radio's label. When Ecash is the only
  way (no How step), the lock stays under the amount, as before.
- **Checked:** screenshots in Ink and Paper at 500 px.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".

## 2026-09-29 (pass 24): show every option; an unsupported one leads to a mint that supports it (user request)

- **Principle:** never hide an option because the current mint can't do it.
  Show it, say why it can't work here, and offer the mints that can (a
  one-tap mint change). Hiding it made users hunt through the mint menu.
- **Send, lock:** the lock switch is always offered on a responding mint.
  Switching it on at a mint without NUT-11 now shows "<mint> can't lock tokens
  (no NUT-11). Lock it from a mint that can:" with chips for the mints that do
  (NUT-11, responding, accepted by the receiver, holding enough), ranked by
  `byReach`. Picking one sets the mint and keeps the lock on. If none can: "None
  of your mints <name> accepts can lock this amount; switch the lock off to send
  it unlocked". This replaces the old "so it goes unlocked" hint on both the How
  step and the single-way amount step.
- **Receive:** rails carry their method and amount. A way the chosen mint
  can't issue (e.g. BOLT12 or onchain into mint.kestrel.money for any amount;
  Lightning under a mint's minimum for a set amount) stays listed with its reason,
  plus "Works at: <mint> …" chips (NUT-04 limits, responding). This covers the
  any-amount QR rails and the "Get paid by" tiles. Tapping a chip moves the
  "Into" mint and the way becomes available.
- **Checked by render:** Bob from mint.northfield.io with the lock on → offers
  tidewater (1,789) and kestrel (418) → picking tidewater keeps the lock. Any
  amount into kestrel → BOLT12 and onchain listed with "Works at:
  mint.tidewater.cash" → tapping makes all three available. Both are in `check.cjs`.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".

## 2026-09-29 (pass 25): unsupported options keep their tab; "Change mint" opens the selector (user correction of pass 24)

- **User's intent:** keep the normal tabs and tiles; opening one the current
  mint can't do shows "not supported by this mint" and a **Change mint**
  button that opens the mint selector. Pass 24 listed mints inline instead.
- **Change:**
  - A shared `unsupported(what, reason, need)` panel: a warning icon, "<What>
    isn't supported by this mint", the reason, and a Change mint button
    (`data-mintneed`).
  - The mint selector now takes a need (`p2pk`, or `<method>:<amount>`). Its
    header says what it filters for ("Mints that can lock", "Mints that issue
    BOLT12"), and it disables each mint that can't, with the reason (NUT-11 /
    NUT-04 or NUT-05 limits), on top of the step's own filters (accepted,
    balance). Picking a mint or closing clears the need.
  - Receive, any amount: the tabs All / Cashu / Address / Offer / Bitcoin always
    show (unsupported ones muted). An unsupported tab replaces the QR with the
    panel. Set amount: the "Get paid by" tiles are never disabled for the
    mint's sake (the sub reads "Not supported by this mint"); the QR step shows
    the panel instead of a QR and hides "Simulate the payer paying". The step is
    no longer skipped when only one way works here.
  - Lock: switching it on at a mint without NUT-11 shows the panel inside the
    lock card; after changing mint the lock stays on.
  - Removed pass 24's inline "Works at" and "Lock it from a mint that can"
    lists.
- **Checked:** screenshots (Offer tab on kestrel → panel; Change mint →
  "Mints that issue BOLT12" with kestrel and northfield disabled). Text walk of
  the lock: "Mints that can lock" disables northfield (no NUT-11) and kestrel
  (not enough); picking tidewater keeps the lock. `check.cjs` asserts the
  panel, the disabled mints, and that the option works after changing mint.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".

## 2026-09-29 (pass 26): is "take it back after 1 week" true? (open from pass 14)

- **Question:** the lock control promises "If unclaimed, take it back after
  1h / 1d / 1w / 30d". That holds only if the lock names the sender as a
  refund key.
- **Sources (jevgrep → grep):**
  - NUT-11: after `locktime`, keys in `refund` may also spend, and the main
    key still can (`../../nuts/11.md:181-183, 213-217`). No `refund` tag after
    the locktime → spendable by anyone (`:183`). No `locktime` → permanent (`:169`).
  - Sovran: `normalizeP2pkLock` refuses a locktime without refund keys (anyone
    could spend) and refund keys without a locktime (`wallet/src/p2pk/lock.ts:48-52, 96-102`),
    and refuses *any* locktime while `P2PK_RECLAIM_ENABLED` is off
    (`lock.ts:91-94`). The flag is `false` (`wallet/src/p2pk/reclaimGate.ts:23`),
    so shipping Sovran only makes permanent locks.
- **Problems found:** (1) the comparison matrix credited "Sovran today" with
  partial lock duration (◐), but timed locks are gated off: corrected to –,
  which lowers its coverage score automatically. (2) The spec never said that a
  timed lock must put the sender's key in `refund`, which the page's
  take-back wording depends on.
- **Fix:** `flow.py MINT_SELECTION.lock` = take_back (locktime + the sender's
  key in refund), never (locktime without refund; refund without locktime),
  permanent ("Never" = no locktime), sovran_today (gated off; the concept's
  periods need the gate on). Matrix row: "Lock duration: One control, no extra
  screen" with Sovran = –. The page's take-back copy is unchanged; it is true
  under the spec's rule.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** does coco's P2PK send accept refund keys and locktime
  (`../../coco/packages/core` send options), and does Sovran's reclaim path
  sign with the refund key after the locktime (`wallet/src/p2pk/reclaimGate.ts`,
  the `availability.ts` reclaimable-after-locktime action)? Needed before the
  gate can be switched on.

## 2026-09-29 (pass 27): can coco make and reclaim a timed lock? (open from pass 26)

- **Question:** does coco's P2PK send take refund keys and a locktime, and can
  the sender spend the refund path after the locktime?
- **Sources (grep in ../../coco, HEAD 281b2802):**
  - Send accepts them: `locktime`, `refundKeys`, `requiredRefundSignatures`
    (`packages/core/operations/send/SendMethodHandler.ts:19-24`).
  - P2PK sends can't be rolled back: `canReclaim = false`
    (`packages/core/infra/handlers/send/P2pkSendHandler.ts:11`), enforced at
    `operations/send/SendOperationService.ts:568`.
  - Receive signs a locked proof only with the key in the secret's `data`
    field (`packages/core/services/ProofService.ts:879`), never a `refund` key.
- **Problem:** the model said timed locks need the Sovran gate on, but not
  why it can't be switched on yet. The blocker is in coco. The
  `reclaimGate.ts:1-18` comment agrees.
- **Fix:** `flow.py MINT_SELECTION.lock.sovran_today` now names the coco
  blocker with the three citations. No page, ranking or README change.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** would upstream coco accept a refund-key signer (sign with a
  `refund` key once `locktime` has passed)? Check `gh search issues --repo
  cashubtc/coco refund` and the ProofService signing call before planning a
  patch; memory says coco stays vanilla, so it must come from upstream.

| Stage | Failure | Signal | Funds | Next step | Verified? |
| --- | --- | --- | --- | --- | --- |
| After | Sender tries to take back an unclaimed timed lock | Not offered: coco can't sign the refund path | Locked to receiver; sender can't spend | None today, so timed locks stay gated off | Yes (coco code) |

## 2026-09-29 (pass 28): does upstream coco plan refund-path signing? (open from pass 27)

- **Sources (gh, read-only):** `gh search issues --repo cashubtc/coco refund`
  finds no issue or PR for refund-key signing. The P2PK PRD, cashubtc/coco#286
  (closed), encodes `locktime`, `refund` and `n_sigs_refund` on send (user
  stories 8-10). It keeps P2PK sends non-reclaimable (story 17) and lists
  "Payer reclaim of executed P2PK payment request sends" as out of scope
  (https://github.com/cashubtc/coco/issues/286).
- **Finding:** reclaim is deliberately out of scope upstream, not overlooked.
  The model's pass-27 `sovran_today` blocker is accurate, so no file changed
  besides these notes.
- **Verification:** `bruteforce.py`, `robustness.py 300` and `build.py`
  exited 0; `check.cjs` printed "concept page check passed" (see below).
- **Open:** a refund signer would need a new upstream coco issue (don't post
  from the loop; it's the user's call). Next pass: audit another rail's failure
  table instead, e.g. the bolt11 melt `PENDING` → NUT-05 quote re-check path
  (`../../nuts/05.md`, `../../coco/packages/core/operations/melt`).

## 2026-09-29 (pass 29): the picker opens directly; per-mint vs global disabling (user request)

- **Problem (user):** an option the current mint can't do showed a "not
  supported" panel, then needed a "Change mint" tap to open the picker: one
  extra tap when we already know another mint can do it. Nor was "this mint
  can't" kept apart from "none of your mints can".
- **Rule now:**
  - **Mint-specific** (another responding mint can do it): choosing the option
    opens the filtered mint picker at once. Covers the lock switch on a mint
    without NUT-11, the "Get paid by" tiles and the any-amount tabs (Offer,
    Bitcoin). The tile sub reads "Not at this mint: pick one". If the user
    closes the picker, the old panel with Change mint stays as the fallback.
    The lock opens the picker only once per switch-on (`f.autoNeed`).
  - **Global** (no responding mint can, or offline): the option is disabled
    with its reason. Examples: Lightning/onchain tiles offline ("Needs the
    network"); BOLT12/onchain tabs when tidewater (the only mint with them) is
    down; the lock switch when no mint the receiver accepts has NUT-11 ("None
    of your mints <name> accepts can lock this (NUT-11). It goes unlocked.").
- **Code:** `concept/body.html`: `lockMints` + auto-open in the send
  flow, `lockSlider(…, canLock)` global branch, `r.need` / `r.nowhere` on
  receive rails, `data-need` on tiles and tabs.
- **check.cjs:** asserts the picker opens with no Change mint tap (lock and
  Offer tab), and that the Offer tab is disabled when tidewater is down. The tap
  test now uses Ecash when Lightning is globally disabled (offline); it used to
  "tap" a Lightning invoice offline, which the page shouldn't allow.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300` and
  `build.py` exited 0; `check.cjs` printed "concept page check passed". No
  ranking or number changed. Not checked visually (no screenshots this pass).
- **Open:** on the send How step, ecash from an unreachable mint says "Can't
  lock … It goes unlocked" even when another reachable mint could lock; it
  should open the picker like the NUT-11 case (`body.html`, the `lockSlider`
  call sites in the Amount/How steps).

## 2026-09-29 (pass 30): a message ("why") on every flow, with who can read it (user request)

- **Framing (user):** who, what, how, when, where, why = recipient, amount,
  rail, lock take-back, mint, message. This pass adds the **why**.
- **Sources, one per rail:**
  - Ecash payment memo sent to the receiver: `../../nuts/18.md:154,161`.
  - Token memo `d` from the sender: `../../nuts/18.md:257,281`.
  - A payment request's `d` shown to the payer after scanning: `../../nuts/18.md:44`.
  - Mint-quote `description` (`../../nuts/04.md:45`). It needs the mint to
    advertise `description: true` for bolt11 (`../../nuts/23.md:125`) and
    bolt12 (`../../nuts/25.md:133`).
  - LNURL-pay comment, only up to `commentAllowed` characters (0 if absent):
    LUD-12 (https://github.com/lnurl/luds/blob/luds/12.md, lines 10, 29).
  - BIP-321 `message` "describes the transaction to the user", set by the
    requester (https://github.com/bitcoin/bips/blob/master/bip-0321.mediawiki, line 72).
  - A melt (paying an invoice) and an onchain send carry no note from the payer.
- **Change:** `noteField()` plus `NOTE_VIS` in `concept/body.html`. An optional
  "Message" field (140 characters) with one line under it saying who sees it:
  - a person by ecash (NIP-17, "Visible to them");
  - a person or address by Lightning ("Visible to them only if their address
    takes comments"; otherwise only you);
  - a shared or locked token ("whoever claims it");
  - a pasted invoice or bitcoin address ("Only you see it");
  - a pasted creq ("Visible to them");
  - receive: creq, Lightning invoice, BOLT12 offer, BIP-321 bitcoin QR, All,
    and the npub.cash address ("Only you": fixed address, payers add their own comment).
  Typing doesn't redraw, so focus is kept.
- **check.cjs:** the receive QR step must show `#r-why` with a visibility line.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300`, `build.py`
  exited 0; `check.cjs` printed "concept page check passed". Not checked
  visually.
- **Open:** (1) The message isn't written into the demo QR payloads or the
  receipt timeline yet (`qrText`, `f.draft`). (2) Should Choose know
  `commentAllowed` from the LNURL first response (the Choose stage, cached), and
  then show the real limit or grey out the field? Check Sovran's LNURL code
  (`jg "lnurl pay comment" wallet/`). (3) Whether demo mints advertise NUT-23
  `description` isn't modelled; add it to `MINTS` if it becomes a condition.
  (4) Group steps as who/what/how/when/where/why? That's a layout decision for
  the user.

## 2026-09-29 (pass 31): the message is asked when the spec needs it (user correction of pass 30)

- **Problem (user):** the message was asked at the wrong step. On receive it
  sat on the QR step, after the invoice already existed.
- **When each rail takes it (sources):**
  - Lightning invoice: `description` goes in the **mint-quote request**
    (`../../nuts/04.md:45`), and only if the mint's NUT-04 bolt11 options say
    `description: true` (`../../nuts/23.md:125,135-136`). cdk checks that
    option *before* requesting the quote (`../../cdk/crates/cdk/src/wallet/issue/mod.rs:239-250`).
    So it must be asked before the quote, never after.
  - BOLT12 offer: `description` at quote creation (`../../nuts/25.md:19,133`).
    coco passes it for bolt12 (`../../coco/packages/core/infra/handlers/mint/MintBolt12Handler.ts:39`)
    but its bolt11 `createQuoteData` has no description at all
    (`../../coco/packages/core/operations/mint/MintMethodHandler.ts:62-67`).
    **Sovran on coco can't set an invoice description today.**
  - Cashu request `d` (`../../nuts/18.md:29,44`) and BIP-321 `message` are
    encoded into the code, so they're set before it's shown.
  - Payer side: the NUT-18 payload `memo` (`../../nuts/18.md:154,161`) and
    the token memo are written at send time. cdk builds the payload with
    `memo: None` (`../../cdk/crates/cdk/src/wallet/payment_request.rs:382`);
    the token memo is set on confirm (`../../cdk/crates/cdk/src/wallet/send/mod.rs:87`).
  - Paying a bolt11 invoice (melt, NUT-05) or a bitcoin address: nothing can
    carry the payer's note.
- **Fix (`concept/body.html`):**
  - Receive, set amount: the Message field moved to the Amount step, before
    "Get paid by" and before any quote. The QR step only echoes it, and says
    when the invoice can't carry it (`MINTS[].desc`, the demo NUT-23 option:
    tidewater/northfield yes, kestrel no). The Lightning tile adds "· no
    message" in that case.
  - Receive, any amount: the field stays with the reusable code and says
    "Changing it makes a new code".
  - Send: no field for a pasted invoice or bitcoin address (removed pass 30's
    "Only you" row). Everything else is unchanged: person ecash/Lightning,
    token, Lightning address, pasted creq, each at the final send step.
  - Both receipts show a Message row.
- **check.cjs:** the set-amount Amount step must show `#r-why` with a
  visibility line, and the QR step must not ask it.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300`, `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** (1) If the Into mint can't take a description while a message is
  set, should the Lightning tile open the mint picker (the pass-29 rule)
  instead of "no message"? (2) Sovran would need coco to add `description` to
  bolt11 `createQuoteData`: an upstream ask, since coco stays vanilla.
  (3) LNURL `commentAllowed` still isn't modelled; nothing found in cdk.

## 2026-09-29 (pass 32): a modular wallet: every rail and feature is a build switch (user request)

- **Goal (user):** one design that can ship as Lightning only, onchain only,
  ecash + Lightning, no ecash messages, no Nostr search, and so on.
- **Model (`flow.py`):**
  - `MODULES`: ecash, lightning, bolt12, onchain, nostr, npubcash, lock, nfc,
    msg_ecash, msg_lightning, msg_onchain. Each has `needs`, `what` and
    `where`. Dependencies: bolt12 → lightning; npubcash → lightning + nostr;
    lock → ecash; msg_* → its rail.
  - `PRESETS`: full, lightning_only, onchain_only, ecash_lightning,
    ecash_no_messages, no_nostr. `flow.py` asserts that every preset meets its
    dependencies and has at least one way to pay, so a bad preset fails the
    first verify command.
- **Rules:**
  - Off means hidden, never greyed. A build choice isn't a condition the user
    can fix, unlike pass 29's per-mint and global disabling.
  - A paste or scan for a missing module says so ("Lightning isn't part of
    this wallet") instead of "Not recognised".
  - A one-rail build skips "Get paid by".
  - Balances stay at mints in every build: Lightning and onchain are mint
    quotes (NUT-04/05/30). Turning ecash off only removes it as a way to pay
    others. This is the honest reading; a mint-less onchain-only wallet would
    be a different product.
- **Page (`concept/body.html`):**
  - `ON(m)`, `RAIL_MOD`, `setModule()` (adds needs, drops dependents, refuses to
    leave no rail).
  - Gates: `classify()` (wraps `classify0`); `resolve()` rails and top-up;
    person ways (ecash, Lightning, the npub.cash fallback); Who (people search,
    Tap, Share token); receive modes (Paste a token), rails, the "Get paid by"
    tiles, the QR's `creq=` part and the Cashu why-box; `tapReceive`;
    `lockSlider`; the message fields (`MSG_MOD`, and a receive visibility line
    that names only enabled rails).
  - Settings → "Wallet build": a preset picker and one switch per module.
- **check.cjs:** every preset. It fails on script errors, on any surface of a
  module that's off (people search, token, tap, lock, message, receive tiles
  and tabs, `CREQ` in the QR, tap box), on a one-rail build that still asks
  "Get paid by", and when turning Lightning off leaves BOLT12 or npub.cash on.
  A jsdom probe showed Lightning-only and onchain-only both reach the QR
  without a "Get paid by" step, with messages naming only their own rail.
- **README:** a Modules bullet in Model; the task list is replaced by a
  pointer to `SEND`/`RECEIVE` in `bruteforce.py`, so it stays at 1,492 words.
- **Verification:** `flow.py`, `bruteforce.py`, `robustness.py 300`, `build.py`
  exited 0; `check.cjs` printed "concept page check passed".
- **Open:** (1) `bruteforce.py` still scores only the full build. Scoring each
  preset would show what a Lightning-only wallet costs in screens. (2) The
  research matrix and failure table don't filter by build. (3) For Sovran:
  modules map onto `wallet/` (payment intent per rail) and `nostr/`; a
  runtime flag set would live in `app/shared` config. Not checked in code yet.
