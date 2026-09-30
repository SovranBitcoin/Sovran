"""The payment flow as one object: a spec another Cashu wallet can follow.

`requirements.py` says what each rail needs; this file says how a wallet walks
the user through them: the steps, what each step asks, when a step is skipped,
where the mint can still be changed, how the wallet picks a mint, what every
failure looks like, and what the final receipt shows.

The concept page reads this file (via flow.json, embedded by concept/build.py),
so the demo and the spec cannot drift apart.

Run:  python3 docs/research/payment-flows/flow.py   (writes flow.json)
"""

from __future__ import annotations

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Steps. `mint_switch` says whether the "From/Into mint" control is shown:
#   "yes"  switching is safe (nothing has left the wallet)
#   "no"   the step is terminal or already committed to a mint
# ---------------------------------------------------------------------------
SEND_STEPS = [
    {"id": "who", "asks": "Who is being paid: a person, or a scan, paste, tap or shared token",
     "skip_when": "never; it is the first question",
     "mint_switch": "no", "why": "No mint is involved until the wallet knows who is paid."},
    {"id": "amount", "asks": "How much; quick amounts, amounts held exactly marked, All / Max",
     "skip_when": "the counterpart fixed it (invoice or request with an amount)",
     "mint_switch": "yes", "why": "Nothing has been swapped or sent; any mint the receiver accepts can pay."},
    {"id": "how", "asks": "Ecash or Lightning, only when both are open",
     "skip_when": "one way is open",
     "mint_switch": "yes", "why": "Still nothing committed; the mint changes which ways are open."},
    {"id": "pay", "asks": "Nothing: the last tap sends (a Lightning or onchain melt shows the fee first)",
     "skip_when": "never",
     "mint_switch": "yes", "why": "Until the tap, the mint can change; the fee and route are re-quoted."},
    {"id": "receipt", "asks": "Nothing",
     "skip_when": "never",
     "mint_switch": "no", "why": "Terminal: the token exists or the melt ran. Reclaim, don't switch."},
]

RECEIVE_STEPS = [
    {"id": "intent", "asks": "Any amount, Set an amount, or Paste a token",
     "skip_when": "never", "mint_switch": "yes", "why": "Receiving into another mint is always safe before a quote is paid."},
    {"id": "amount", "asks": "How much", "skip_when": "Any amount",
     "mint_switch": "yes", "why": "Changing the mint only re-creates the quote and request."},
    {"id": "method", "asks": "Get paid by: Lightning, Ecash, Onchain, or All of them (set amount only)",
     "skip_when": "any amount (one reusable code), or only one way is open at this amount",
     "mint_switch": "yes", "why": "No quote exists yet; each tile names the mint that would issue it (NUT-04 limits)."},
    {"id": "qr", "asks": "Nothing: the chosen way's QR (All = one BIP-321 code)",
     "skip_when": "never", "mint_switch": "yes",
     "why": "Safe until a payer pays; the old quote simply expires (NUT-04)."},
    {"id": "claim", "asks": "Nothing for a known mint; add it or move the money for a new one",
     "skip_when": "never", "mint_switch": "no",
     "why": "A token is claimed at the mint that issued it (NUT-03); moving it is a melt, offered as a choice."},
]

# ---------------------------------------------------------------------------
# How the wallet picks a mint when the user hasn't.
# ---------------------------------------------------------------------------
MINT_SELECTION = {
    "candidates": "mints the receiver accepts (NUT-18 `m`, NIP-61 kind 10019), where you hold enough",
    "primary": "the user's primary mint (Sovran: persisted selectedMint, app/shared/stores/profile/mintStore.ts:23; "
               "MintSelector defaults to it, useMintSelector.ts:66-67) leads every step as a soft default; each step's own "
               "filters still apply, and when it can't be used the step names the reason",
    "order": [
        "the primary, when it is responding and passes the step's filters",
        "reachable before not responding (online only; offline, every mint is 'unknown', never 'down')",
        "holds the exact amount in pieces before needing change",
        "larger balance first (this is what ranks the second and third mints)",
    ],
    "on_failure": "try the next candidate without asking; then the next rail; never retry the same mint silently",
    "not_responding_while_online": "offer: exact amount from another mint (named), round up/down from this one, or change mint",
    "last_resort": "ecash from a mint that isn't responding, labelled: the receiver can claim it only once the mint is back (NUT-03)",
    "top_up": {
        "when": "a Cashu request (NUT-18) with an amount lists only mints you already use, you hold too little there, "
                "and neither its bundled Lightning invoice nor onchain can be paid (a bundled lightning= is always preferred)",
        "never": "adds or trusts a mint you don't already use; runs inside an NFC tap (too slow for numo's ~5 s budget)",
        "how": "mint quote at the target mint for the shortfall; melt from your largest-balance other mint that can pay Lightning; "
               "mint the ecash; pay the request from the target mint",
        "consent": "one confirm screen showing the amount moved, the source mint and the Lightning fee reserve",
        "setting": "top_up_trusted_mint (default on)",
        "durability": "must resume after the app is killed between melt, mint and send (not yet specified; see LOOP_NOTES)",
        "prior_art": "cashubtc/wallet AcquireThenPay: ../../wallet/android/app/src/main/java/com/cashu/me/Core/Wallet/"
                     "WalletCashuRequestPayment.kt:21-48 (funding source = largest balance with bolt11 melt; "
                     "input-fee buffer for up to 32 proofs); it adds the requested mint, which this spec forbids",
    },
    "lock": {
        "take_back": "a timed lock sets locktime AND the sender's key in `refund`: after the locktime either party can "
                     "spend, so the sender can take back what is still unclaimed (../../nuts/11.md:181-183, 213-217)",
        "never": "a locktime without refund keys (after it, ANYONE can spend: ../../nuts/11.md:183); "
                 "refund keys without a locktime (unusable). Sovran refuses both (wallet/src/p2pk/lock.ts:48-52, 96-102)",
        "permanent": "'Never' = no locktime tag (../../nuts/11.md:169): only the receiver can ever spend it",
        "sovran_today": "timed locks are gated off (P2PK_RECLAIM_ENABLED = false, wallet/src/p2pk/reclaimGate.ts:23; "
                        "lock.ts:91-94), so only permanent locks ship; the concept's 1h-30d periods need that gate on. "
                        "Blocker is coco: send accepts locktime + refundKeys (../../coco/packages/core/operations/send/"
                        "SendMethodHandler.ts:19-24), but P2PK sends can't reclaim (infra/handlers/send/P2pkSendHandler.ts:11) "
                        "and receive signs only with the secret's `data` key (services/ProofService.ts:879), never a refund key",
    },
    "user_override": "the From/Into mint control on any step where mint_switch is 'yes'; Auto returns to these rules",
    "sources": ["../../nuts/03.md:21", "LOOP_NOTES.md pass 5", "mint_choice.md"],
}

# ---------------------------------------------------------------------------
# Mint info (NUT-06) the flow must read before offering an option. Each gate is
# checked at the Choose stage from cached info; unknown (no info yet, offline)
# is never treated as unsupported.
# ---------------------------------------------------------------------------
MINT_INFO = [
    {"field": "nuts.4.methods[] {method, unit, min_amount, max_amount, options}; nuts.4.disabled",
     "gates": "receive by Lightning / BOLT12 / onchain at this amount, per mint (NUT-04)",
     "flow": "a set-amount receive greys out a method no mint can issue at that amount, and says why; "
             "the Into mint is the first reachable one whose limits fit",
     "source": "../../nuts/04.md:160-187"},
    {"field": "nuts.5.methods[] {method, unit, min_amount, max_amount, options}; nuts.5.disabled",
     "gates": "paying an invoice, offer, address or onchain from this mint at this amount; the top-up source",
     "flow": "the pay step skips a mint whose melt limits don't fit and names the limit",
     "source": "../../nuts/05.md:245-272"},
    {"field": "nuts.5 bolt11 options.amountless", "gates": "paying an invoice with no amount",
     "flow": "see FAILURES bolt11 rows", "source": "../../nuts/23.md:258-270"},
    {"field": "nuts.11.supported", "gates": "locking a token to a key (P2PK)",
     "flow": "no lock control for a mint without it; a pasted key or locked request only uses mints with it",
     "source": "../../nuts/06.md:70-90 (supported flags), ../../nuts/11.md"},
    {"field": "nuts.7.supported", "gates": "watching whether a sent token was claimed (receipt 'Claimed')",
     "flow": "without it the receipt can't show Claimed; it says so instead of waiting forever (not yet on the page)",
     "source": "../../nuts/07.md"},
    {"field": "nuts.12.supported", "gates": "checking an offline token's signature (DLEQ)",
     "flow": "offline receive counts a locked token as pending only with DLEQ", "source": "../../nuts/12.md"},
    {"field": "nuts.15 (MPP)", "gates": "one Lightning payment split across mints", "flow": "not modelled yet", "source": "../../nuts/15.md"},
    {"field": "nuts.17 (WebSockets)", "gates": "live quote and proof state updates instead of polling",
     "flow": "affects the receipt timeline latency only", "source": "../../nuts/17.md"},
    {"field": "nuts.20 / nuts.25 / nuts.30", "gates": "signed mint quotes, BOLT12, onchain",
     "flow": "BOLT12 receive needs NUT-20; each is a separate method in nuts.4/5", "source": "../../nuts/25.md, ../../nuts/30.md"},
]

# Receive with a set amount: which ways to offer.
RECEIVE_METHODS = {
    "choices": ["Lightning", "Ecash", "Onchain", "All"],
    "default": "none: a 'Get paid by' step asks (one tile per way, disabled with the reason when no mint can issue it); skipped when only one way is open",
    "why": "each Lightning or onchain choice makes the mint create a quote (NUT-04); All creates one per method, so it is opt-in",
    "any_amount": "one reusable code (Cashu request + Lightning address + BOLT12 offer + onchain address): no per-receive quote",
    "tension": "bruteforce.py: unified QR 1.76 vs preselected Lightning 1.85 screens (69% of weightings); "
               "preselecting wins once one mint quote costs more than ~2 screens. See results.md 'cost of mint quotes'",
}

# ---------------------------------------------------------------------------
# Failures: stage | failure | signal | funds | next step. Verified rows cite a
# source; the rest are marked unverified. Mirrors the table in LOOP_NOTES.md.
# ---------------------------------------------------------------------------
FAILURES = [
    {"rail": "bolt11", "stage": "choose", "failure": "mint can't pay invoices with no amount",
     "signal": "mint info: bolt11 melt options.amountless absent", "funds": "spendable",
     "next": "another mint with amountless; else ask for an invoice with an amount",
     "source": "../../nuts/23.md:258-270", "verified": True},
    {"rail": "bolt11", "stage": "quote", "failure": "amountless quote rejected",
     "signal": "11011 (nutshell, cdk with option); 50000 backend error (cdk+CLN without option)", "funds": "spendable",
     "next": "another mint with amountless",
     "source": "LOOP_NOTES.md pass 3", "verified": True},
    {"rail": "ecash", "stage": "choose", "failure": "chosen mint not responding while online",
     "signal": "no answer to /v1/info within the timeout", "funds": "spendable (unknown, not failed)",
     "next": "exact amount from another reachable mint; else round from held pieces; last resort send labelled unclaimable-until-back",
     "source": "../../nuts/03.md:21", "verified": True},
    {"rail": "ecash", "stage": "pay", "failure": "mint rejects the swap",
     "signal": "error on POST /v1/swap", "funds": "spendable (inputs not spent)",
     "next": "next mint the receiver accepts", "source": "", "verified": False},
    {"rail": "lightning", "stage": "pay", "failure": "no route from this mint",
     "signal": "20004 Lightning payment failed", "funds": "spendable after the melt settles UNPAID; check the melt quote",
     "next": "next mint that can pay it", "source": "../../nuts/error_codes.md:29", "verified": True},
    {"rail": "top_up", "stage": "pay", "failure": "app killed between the melt, the mint and the send",
     "signal": "melt quote PAID but the target mint quote not yet minted", "funds": "at the target mint's quote, unminted",
     "next": "on restart, re-check the mint quote (NUT-04) and mint it, then offer to finish paying the request",
     "source": "", "verified": False},
    # ---- Catalogue from the reference wallets (LOOP_NOTES pass 18). `best` names the
    # wallet whose handling the flow copies; paths relative to ../../ unless noted.
    {"rail": "lightning", "stage": "pay", "failure": "melt stuck PENDING", "signal": "quote state PENDING / 20005",
     "funds": "reserved until the quote settles", "next": "re-check the quote in the background; offer take-back only once UNPAID",
     "best": "cashu.me src/stores/walletMelt.ts:316-327; Minibits guarded Revert (revertTask.ts:66-76)", "verified": True},
    {"rail": "lightning", "stage": "pay", "failure": "melt UNPAID after proofs were reserved", "signal": "20004 / quote UNPAID",
     "funds": "back to spendable", "next": "release them, then try the next mint that can pay it",
     "best": "coco BaseQuoteMeltHandler.ts:475-515 restoreProofsToReady; Sovran rollbackMelt", "verified": True},
    {"rail": "receive_lightning", "stage": "after", "failure": "quote PAID but minting failed or the app was killed",
     "signal": "PAID then network error / 11003 outputs already signed", "funds": "owed by the mint until minted",
     "next": "retry minting automatically (deterministic outputs), including after quote expiry",
     "best": "cdk issue/mod.rs mint_unissued_quotes (incl. expired); cashu.me wallet.ts:470-495 counter bump", "verified": True},
    {"rail": "receive_token", "stage": "pay", "failure": "token already spent", "signal": "11001 (or NUT-07 SPENT)",
     "funds": "none to settle", "next": "check proof state before redeeming and say so plainly; offer to ask the sender",
     "best": "Zeus CashuStore.ts:4926-4990 checks NUT-07 first; coco recovers its own swap outputs", "verified": True},
    {"rail": "ecash", "stage": "after", "failure": "recipient never claims", "signal": "NUT-07 state stays UNSPENT",
     "funds": "still the sender's", "next": "take it back (swap it) any time, or after the locktime if locked",
     "best": "cashu.me wallet.ts:1002-1066 checkTokenSpendable; cdk send revoke_send", "verified": True},
    {"rail": "ecash", "stage": "pay", "failure": "swap fails mid-send", "signal": "11002 proofs pending / timeout",
     "funds": "unknown until checked", "next": "check proof state (NUT-07) before calling them spendable; retry only non-definite errors",
     "best": "coco SendOperationService.ts:79-81 definite-code list; NOT macadamia (marks proofs valid unchecked)", "verified": True},
    {"rail": "receive_token", "stage": "choose", "failure": "token from a mint you don't use", "signal": "mint not in wallet",
     "funds": "spendable at the sender's mint", "next": "add it (asks), or move it to your primary over Lightning",
     "best": "cashu.me receiveTokensStore.ts:90-104 meltTokenToMint; Sovran never auto-trusts (redeemOrchestrator.ts:175-184)", "verified": True},
    {"rail": "lightning", "stage": "quote", "failure": "invoice or quote expired", "signal": "20007 / expiry passed",
     "funds": "spendable", "next": "check expiry before quoting; ask for a new invoice", "best": "Minibits transferOperationApi.ts:290-295", "verified": True},
    {"rail": "lightning", "stage": "quote", "failure": "fee reserve larger than the balance", "signal": "local check",
     "funds": "spendable", "next": "another mint with enough, or Max after fees", "best": "Minibits transferOperationApi.ts:284", "verified": True},
    {"rail": "any", "stage": "choose", "failure": "amount outside the mint's limits", "signal": "11006 / NUT-04/05 min/max",
     "funds": "spendable", "next": "check limits before offering the mint (the page greys it out)", "best": "coco MintService.ts:427 (only pre-check found)", "verified": True},
    {"rail": "any", "stage": "pay", "failure": "keyset inactive or rotated", "signal": "12001 / 12002",
     "funds": "spendable", "next": "refresh keysets and retry once, silently", "best": "cashu.me wallet.ts:480-484 StaleKeysetError", "verified": True},
    {"rail": "payment_request", "stage": "after", "failure": "Nostr/HTTP delivery not acknowledged", "signal": "publish throws / HTTP not ok",
     "funds": "reserved", "next": "take it back automatically, or show the token as a QR to hand over",
     "best": "Sovran defaultOperations.ts:451-480 attemptRollback; cdk PaymentRequestDeliveryFailed → revoke_send", "verified": True},
    {"rail": "payment_request", "stage": "after", "failure": "same request paid twice", "signal": "none on the payer side",
     "funds": "paid twice", "next": "payer remembers paid request ids; receiver refuses single-use repeats",
     "best": "cashubtc/wallet payer guard; coco PaymentRequestReceiveService.ts:976", "verified": True},
    {"rail": "lightning", "stage": "after", "failure": "overpaid fee change missing (NUT-08)", "signal": "change absent in the melt response",
     "funds": "owed until restored", "next": "store blank outputs before melting; restore them if the change is missing",
     "best": "cashu.me walletMelt.ts:208,221; cdk change_blinded_messages (macadamia TODO, Minibits log only)", "verified": True},
    {"rail": "receive_token", "stage": "pay", "failure": "locked to another key, or before its locktime", "signal": "10001",
     "funds": "the owner's", "next": "say whose it is and when it unlocks (if ever)", "best": "Minibits cashuUtils.ts:660 isTokenP2PKLocked", "verified": True},
    {"rail": "receive_token", "stage": "choose", "failure": "offline receive of an unverified token", "signal": "no mint reachable",
     "funds": "unknown", "next": "count it only if locked to you with a DLEQ; otherwise hold it aside and redeem when online",
     "best": "Sovran redeemOrchestrator.ts:131-210 queue; cdk verify_token_dleq", "verified": True},
    {"rail": "nfc", "stage": "pay", "failure": "tap lost mid-transfer", "signal": "TagLost / 3.5 s without an APDU (numo)",
     "funds": "payer: reserved token; receiver: nothing", "next": "payer rolls back the prepared send; both say 'tap again, or scan the QR'",
     "best": "Sovran app/shared/lib/nfc/apdu.ts:138 + effects.ts:1740-1781 rollback", "verified": True},
    {"rail": "nfc", "stage": "after", "failure": "payer treats 90 00 as paid", "signal": "UPDATE BINARY 90 00 (acked before checking)",
     "funds": "unknown until the receiver redeems", "next": "payer watches proof state (NUT-07); receiver's screen is the truth",
     "best": "numo NdefUpdateBinaryHandler.java:205-231; docs/research/nfc-payment-requests.md", "verified": True},
    {"rail": "nfc", "stage": "during", "failure": "second tap while a payment is processing", "signal": "numo ignores it silently",
     "funds": "the payer keeps it but may think it paid", "next": "receiver answers 6A82 (not armed) so the payer sees 'not taken'",
     "best": "numo PaymentRequestActivity.kt:1256-1262 (the silent drop is the thing to avoid)", "verified": True},
    {"rail": "any", "stage": "any", "failure": "mint unreachable or timeout", "signal": "network error",
     "funds": "unknown during pay, spendable during quote", "next": "next mint (primary first), back off and retry in the background",
     "best": "Sovran redeemOrchestrator.ts:66-78; Zeus per-mint timeout", "verified": True},
]

# ---------------------------------------------------------------------------
# The final send state. Every receipt shows these, when they apply.
# ---------------------------------------------------------------------------
RECEIPT = {
    "always": ["to (person, key, address or terminal)", "amount (and fiat)", "method", "from mint", "status timeline"],
    "ecash": ["lock (to whom, until when) or unlocked", "claim fee added or not (NUT-02)",
              "transport (Nostr DM, payment-request transport, NFC, QR, link)",
              "the token as a QR with copy / share / write to card, whatever the transport",
              "claimed yet? (watched with NUT-07 state checks)"],
    "lightning": ["fee reserve and actual fee (unused reserve refunded, NUT-08)", "preimage once paid"],
    "timeline": "see TIMELINE",
}

# ---------------------------------------------------------------------------
# The receipt timeline, designed from first principles.
#
# 1. One step per question the sender has: did it leave my wallet, did it reach
#    them, is it final? Nothing that doesn't answer one of those.
# 2. A step keeps its noun; only the tense changes: future "Alice claims it" →
#    active "Waiting for Alice to claim it" → done "Claimed by Alice". Earlier
#    lines read as history, never as rewrites.
# 3. Only the active step speaks: what is happening and what it waits on.
#    Done steps shrink to past tense and a time; future steps are muted labels
#    and promise nothing.
# 4. The last done step keeps one short result when it is the outcome
#    (the fee paid, who claimed it).
# 5. A failure replaces the active step with: what happened, where the money
#    is now, one next step. Later steps are removed, not left pending.
# 6. Facts that stay true (lock, mint, fee limits) live in the rows below,
#    never in the timeline.
# 7. Everything else on the receipt follows the timeline, never ahead of it:
#    the header verb (Sending → Sent / Couldn't send / Queued / Paid); the
#    token (a same-size placeholder until it exists, none if making it failed,
#    the QR once ready and after a failed delivery since it's still yours,
#    "spent" once claimed); the transport line's tense; and "Send another",
#    shown only once nothing is still in flight.
#
# label = (future, active, done). Placeholders: {to} {mint} {src} {amt} {fee} {via}.
# `active_locked` / `active_exact` replace `active` when the token is locked / made
# from pieces already held. Every string ≤ 150 chars.
# ---------------------------------------------------------------------------
STEP = {
    "topup": {"label": ("Top up {mint}", "Moving {amt} sats to {mint}", "Moved {amt} sats to {mint}"),
              "active": "From {src} over Lightning; fee up to {fee} sats",
              "fail": ("Couldn't move the sats", "Nothing moved; your sats are still at {src}.", "Try another mint")},
    "prepare": {"label": ("Token", "Preparing the token", "Token ready"),
                "active": "{mint} is making change for the exact amount",
                "active_exact": "Taking the exact pieces from your {mint} balance",
                "active_locked": "{mint} is locking it so only {to} can claim it",
                "fail": ("Couldn't make the token", "{mint} didn't answer. Nothing left your wallet.", "Try another mint")},
    "send": {"label": ("Delivery to {to}", "Sending to {to}", "Sent to {to}"),
             "active": "{via}",
             "queued": ("Waiting for a connection", "It goes out as soon as you're back online."),
             "fail": ("Not delivered", "No one accepted the message. The token is still yours.", "Show a QR instead")},
    "hand": {"label": ("The tap", "Handing it to the terminal", "Handed to the terminal"),
             "active": "Hold your phone to the terminal",
             "fail": ("The tap ended early", "The terminal didn't get the token. It is still yours.", "Tap again")},
    "claim": {"label": ("{to} claims it", "Waiting for {to} to claim it", "Claimed by {to}"),
              "active": "Until then it is still yours; you can take it back.",
              "active_locked": "Only {to} can claim it. {reclaim}",
              "result": "Final: it can't be taken back now.",
              "fail": ("Not claimed yet", "Still yours. Take it back, or leave it for them.", "Take it back")},
    "redeem": {"label": ("The terminal redeems it", "The terminal is redeeming it", "Redeemed by the terminal"),
               "active": "It swaps the token at {mint}",
               "result": "Final.",
               "fail": ("The terminal couldn't redeem it", "Check with the merchant; the token may still be spendable.", "Check the token")},
    "pay": {"label": ("Payment", "Paying over Lightning", "Paid"),
            "active": "{mint} is finding a route; up to {fee} sats in fees",
            "result": "Unused fee reserve came back to {mint}.",
            "fail": ("Payment failed", "No route was found. Your sats are back at {mint}.", "Try another mint")},
    "broadcast": {"label": ("Onchain send", "Sending onchain", "Sent onchain"),
                  "active": "{mint} is broadcasting the transaction",
                  "fail": ("Couldn't send onchain", "{mint} refused it. Your sats are still there.", "Pay over Lightning")},
    "confirm": {"label": ("Confirmation", "Waiting for a confirmation", "Confirmed"),
                "active": "Usually 10 to 60 minutes",
                "result": "Final."},
    # ---- receive (each step is a protocol state, as in Sovran's state-driven timeline:
    # app/features/settings/screens/designSystemTimelineScenarios.ts:18,58)
    "paid": {"label": ("Payment", "Waiting for the payment", "Paid by {via}"),
             "active": "The QR stays valid until it expires",
             "fail": ("Expired", "Nobody paid it and nothing was taken. Make a new one.", "New request")},
    "mint_in": {"label": ("Your ecash", "Minting your ecash", "Minted at {mint}"),
                "active": "{mint} issues ecash for the paid quote (NUT-04)",
                "result": "Final: it's in your balance.",
                "fail": ("Paid, not minted yet", "The quote is paid and safe; minting retries (NUT-04).", "Retry now")},
    "confirm_in": {"label": ("Confirmation", "Waiting for a confirmation", "Confirmed"),
                   "active": "Usually 10 to 60 minutes; the ecash is minted after it"},
    "tap_in": {"label": ("Tap", "Receiving the tap", "Token received by tap"),
               "active": "Hold still: the token is written to your phone over NFC",
               "fail": ("The tap ended early", "Nothing arrived; the token is still theirs. Tap again, or they scan the QR.", "Tap again")},
    "check": {"label": ("Check", "Checking the token", "Unspent"),
              "active": "Asking {mint} whether it has been spent (NUT-07)",
              "fail": ("Already spent", "Someone claimed it first. Nothing was added.", "Ask the sender")},
    "claim_in": {"label": ("Claim", "Claiming it", "Claimed"),
                 "active": "Swapping it at {mint} so only you can spend it (NUT-03)",
                 "result": "Final: in your balance; the sender can't take it back.",
                 "fail": ("Couldn't claim it", "{mint} didn't answer. The token is kept and retried.", "Retry now")},
    "verify": {"label": ("Offline check", "Checking it offline", "Verified offline"),
               "active": "Signed by {mint} (NUT-12) and locked to your key (NUT-11)",
               "fail": ("Can't verify it", "It isn't locked to you, so it's held aside and not counted.", "Keep aside")},
    "redeem_later": {"label": ("Claim", "Waiting for {mint}", "Claimed"),
                     "active": "It counts as pending and is claimed as soon as {mint} answers",
                     "result": "Final: in your balance."},
    "hold": {"label": ("Claim", "Held aside", "Claimed"),
             "active": "Not counted until {mint} confirms it; checked when you're online",
             "result": "Final: in your balance.",
             "fail": ("Already spent", "The sender spent it before you could claim it. Nothing was added.", "Ask the sender")},
    "add_mint": {"label": ("New mint", "Adding {mint}", "Added {mint}"),
                 "active": "Saving its keys so you can hold ecash there"},
    "move": {"label": ("Move", "Moving it to {dest}", "Moved to {dest}"),
             "active": "Paid out over Lightning; fee up to {fee} sats",
             "result": "Final: in your balance at {dest}.",
             "fail": ("Couldn't move it", "No route from {mint}. You can still keep it there.", "Keep it there")},
}
# Which steps each kind of payment walks through, in order.
TIMELINE = {
    "ecash_person": ["prepare", "send", "claim"],
    "ecash_request": ["prepare", "send", "claim"],
    "ecash_token": ["prepare", "claim"],
    "ecash_tap": ["prepare", "hand", "redeem"],
    "lightning": ["pay"],
    "onchain": ["broadcast", "confirm"],
    # A top-up puts "topup" first; a queued send starts with "send" in its queued state.
    # Receive: the QR screen was the waiting, so a paid receive starts with "paid" done.
    # A tap: the write lands in-band, then the token is checked and claimed like a pasted one.
    # "90 00" on the write is not acceptance (numo acks before checking); the check/claim steps are.
    "recv_tap": ["tap_in", "check", "claim_in"],
    "recv_ln": ["paid", "mint_in"],
    "recv_btc": ["paid", "confirm_in", "mint_in"],
    "recv_ecash": ["paid", "claim_in"],
    "claim": ["check", "claim_in"],
    "claim_offline": ["verify", "redeem_later"],
    "claim_later": ["hold"],
    "claim_add": ["add_mint", "check", "claim_in"],
    "claim_move": ["check", "move"],
}

# Settings a wallet exposes for these flows (each backed by spec + shipping-wallet evidence in README.md).
SETTINGS = [
    {"id": "max_lightning_fee_pct", "default": 2, "why": "melt fee_reserve (NUT-05); unused reserve refunded (NUT-08)"},
    {"id": "max_offline_overpay_pct", "default": 2, "why": "offline, tokens come only from held pieces; Minibits sendOfflineApproxMatch"},
    {"id": "add_receiver_claim_fee", "default": True, "why": "input fee (NUT-02); cashu.me includeFeesInSendAmount"},
    {"id": "top_up_trusted_mint", "default": True, "why": "pay single-mint requests; cashubtc/wallet AcquireThenPay"},
]

FLOW = {"send": SEND_STEPS, "settings": SETTINGS, "mint_info": MINT_INFO, "receive_methods": RECEIVE_METHODS, "timeline_steps": STEP, "timelines": TIMELINE, "receive": RECEIVE_STEPS, "mint_selection": MINT_SELECTION,
        "failures": FAILURES, "receipt": RECEIPT}

if __name__ == "__main__":
    out = Path(__file__).with_name("flow.json")
    out.write_text(json.dumps(FLOW, indent=2) + "\n")
    print(out)
