"""Brute-force the send and receive flows with the fewest steps.

A *design* is an order of questions plus a few merge choices. A *scenario*
is something a user wants to do (task) in a situation (context: network,
mint reachability, mint capabilities, whether held proofs add up exactly).
For every design we walk every scenario and count the screens where the user
must act. The best design minimises the weighted average, and never offers a
step that leads nowhere.

Run:  python3 docs/research/payment-flows/bruteforce.py
Writes: docs/research/payment-flows/results.md
"""

from __future__ import annotations

import itertools
import sys
from dataclasses import dataclass, replace
from pathlib import Path

# --------------------------------------------------------------------------
# Context: what the world looks like when the user starts
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Context:
    online: bool
    mint_up: bool  # the chosen mint answers (only meaningful online)
    bolt12: bool  # mint advertises NUT-04/05 bolt12 (+ NUT-20)
    onchain: bool  # mint advertises NUT-30 onchain (+ NUT-20)
    p2pk: bool  # mint advertises NUT-11
    exact: bool  # held proofs add up to the amount exactly
    in_bounds: bool  # amount within the mint's NUT-04/05 min/max
    # A token's or request's mint is one we already trust (Macadamia auto-claims
    # only these; an unknown mint needs "Add mint" or "Transfer to my mint").
    mint_known: bool
    # A scanned/tapped NUT-18 request is payable by us: a held mint is in its
    # list (m), our keysets charge no input fee, and it asks for no P2PK lock.
    req_payable: bool
    # A received token is P2PK-locked to our key (NUT-11). Offline, a lock to
    # us plus a valid DLEQ (NUT-12) against keys we already saved for that mint
    # proves the mint signed it and only we can spend it.
    locked_to_us: bool
    # Held pieces add up to at least the amount within the user's overpay
    # limit (e.g. 2%), when they don't make it exactly. The receiver of a
    # NUT-18 request is online and redeems whatever is given (sum - fee >= a).
    overpay_ok: bool
    weight: float

    @property
    def mint(self) -> bool:
        return self.online and self.mint_up


# Probability that each context flag is true. Estimates; robustness.py
# resamples them to check the ranking does not hinge on these numbers.
BASE_P = {
    "online": 0.85,
    "mint_up": 0.95,  # given online
    "bolt12": 0.3,
    "onchain": 0.2,
    "p2pk": 0.9,
    "exact": 0.4,
    "in_bounds": 0.95,
    "mint_known": 0.7,
    "req_payable": 0.8,
    "locked_to_us": 0.3,
    "overpay_ok": 0.5,
}
FLAGS = ("online", "mint_up", "bolt12", "onchain", "p2pk", "exact", "in_bounds", "mint_known", "req_payable", "locked_to_us", "overpay_ok")


def context_weight(c: "Context", P: dict[str, float]) -> float:
    w = 1.0
    for flag in FLAGS:
        if flag == "mint_up" and not c.online:
            continue
        p = P[flag]
        w *= p if getattr(c, flag) else 1 - p
    return w


def contexts(P: dict[str, float] = BASE_P) -> list[Context]:
    out = []
    for values in itertools.product(*([(True, False)] * len(FLAGS))):
        flags = dict(zip(FLAGS, values))
        if not flags["online"] and not flags["mint_up"]:
            continue  # offline already implies no mint; don't double count
        c = Context(**flags, weight=0.0)
        out.append(replace(c, weight=context_weight(c, P)))
    total = sum(c.weight for c in out)
    return [replace(c, weight=c.weight / total) for c in out]


# --------------------------------------------------------------------------
# Tasks: what the user wants to do
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Task:
    id: str
    direction: str  # send | receive
    label: str
    weight: float
    # send: what the user starts from. contact / token (create one) / scanned kind
    entry: str = "none"
    # rails that complete it, in preference order (first feasible wins)
    rails: tuple[str, ...] = ()
    # the destination fixes the amount (scanned invoice / request with amount)
    amount_fixed: bool = False
    # receive: the user doesn't want to set an amount
    any_amount: bool = False
    # the user wants to lock (contact ecash only)
    wants_lock: bool = False
    # the user wants to send the whole balance of a mint
    send_all: bool = False


SEND = [
    Task("send.contact.ecash", "send", "Send ecash to a contact", 0.18, "contact", ("ecash",)),
    Task("send.contact.ecash.lock", "send", "Send locked ecash to a contact", 0.06, "contact", ("ecash",), wants_lock=True),
    Task("send.contact.ln", "send", "Pay a contact over Lightning", 0.08, "contact", ("lightning",)),
    Task("send.token", "send", "Share a token (link, copy)", 0.14, "token", ("ecash",)),
    Task("send.invoice", "send", "Pay a scanned Lightning invoice", 0.22, "bolt11", ("lightning",), amount_fixed=True),
    Task("send.lnaddr", "send", "Pay a Lightning address", 0.12, "lnaddr", ("lightning",)),
    Task("send.bolt12", "send", "Pay a Lightning offer", 0.03, "bolt12", ("bolt12",)),
    Task("send.onchain", "send", "Pay a bitcoin address", 0.04, "btc", ("onchain",)),
    Task("send.creq", "send", "Pay a Cashu payment request", 0.08, "creq", ("creq",), amount_fixed=True),
    Task("send.bip321", "send", "Pay a unified (BIP-321) QR", 0.05, "bip321", ("creq", "lightning", "onchain"), amount_fixed=True),
    # NFC: a terminal (e.g. numo) emits bitcoin:?creq=…&lightning=…; the phone
    # writes a token back inside ~5 s. Everything is decided during the tap.
    Task("send.nfc.terminal", "send", "Tap to pay a terminal", 0.07, "nfc_creq", ("creq", "lightning"), amount_fixed=True),
    Task("send.nfc.lightning", "send", "Tap a Lightning-only tag", 0.01, "nfc_bolt11", ("lightning",), amount_fixed=True),
    Task("send.nfc.card", "send", "Write a token to an NFC card", 0.01, "token", ("ecash",)),
    # Send all: every proof at one mint needs no swap, so it works offline; the
    # receiver pays the input fee on their swap. Over Lightning a max needs
    # quotes (amount + fee_reserve + input fee <= balance) and only works when
    # the payer sets the amount (Lightning address / LNURL), never a fixed invoice.
    Task("send.all.ecash", "send", "Send everything at a mint as ecash", 0.03, "token", ("ecash",), send_all=True),
    Task("send.all.ln", "send", "Empty a mint to a Lightning address", 0.01, "lnaddr", ("lightning",), send_all=True),
    # A pasted P2PK key: a locked send, which needs the mint's swap. Offline
    # the only honest options are "lock and send later" or unlocked in person.
    Task("send.p2pk", "send", "Pay a pasted P2PK key", 0.03, "p2pk", ("ecash",)),
    # Someone in front of you: the same "Share token" flow, shown as a QR they scan.
    Task("send.inperson", "send", "Share a token in person (they scan)", 0.05, "inperson", ("ecash",)),
]
RECEIVE = [
    Task("recv.token", "receive", "Claim a token I was given", 0.27, "token", ("claim",), amount_fixed=True),
    Task("recv.token.nfc", "receive", "Claim a token from an NFC card", 0.03, "nfc_token", ("claim",), amount_fixed=True),
    Task("recv.nfc", "receive", "Get paid by tap (phone acts as the tag)", 0.03, rails=("creq",)),
    Task("recv.fixed", "receive", "Get paid a set amount, any wallet", 0.30, rails=("bip321", "creq", "lightning", "onchain")),
    Task("recv.any", "receive", "Get paid any amount", 0.20, rails=("lnaddr", "creq", "bolt12", "onchain"), any_amount=True),
    Task("recv.cashu", "receive", "Get paid by a Cashu wallet", 0.10, rails=("creq",)),
    Task("recv.lightning", "receive", "Get a plain Lightning invoice", 0.10, rails=("lightning",)),
]


sys.path.insert(0, str(Path(__file__).parent))
from requirements import RAILS  # noqa: E402  (same directory)

RAIL = {r.id: r for r in RAILS}
# Task-level rail families -> the requirement rows that can complete them.
FAMILY = {
    "ecash": ("send.ecash.exact", "send.ecash.swap"),  # offline non-exact rounds to an exact amount
    "lightning": ("send.bolt11", "send.lnaddr", "recv.bolt11"),
    "bolt12": ("send.bolt12", "recv.bolt12"),
    "onchain": ("send.onchain", "recv.onchain"),
    "creq": ("send.request", "recv.request"),
    "claim": ("recv.token",),
    "lnaddr": ("recv.lnaddr",),
    "bip321": ("recv.request",),  # always carries creq, plus whichever mint rails are up
}


def capability_ok(cap: str | None, c: Context) -> bool:
    if cap is None or cap.startswith("nut03"):
        return True
    if "bolt12" in cap:
        return c.bolt12
    if "onchain" in cap:
        return c.onchain
    if cap.startswith("nut11"):
        return c.p2pk
    return True  # bolt11 is advertised by every mint in the model


def rail_ok(rail_id: str, c: Context) -> bool:
    r = RAIL[rail_id]
    if r.needs_mint and not c.mint:
        return False
    if r.needs_network and not c.online:
        return False
    if r.needs_mint and not c.in_bounds:
        return False  # outside the mint's NUT-04/05 min/max
    return capability_ok(r.mint_capability, c)


def feasible(rail: str, c: Context) -> bool:
    """Whether a task-level rail can complete here, derived from requirements.py."""
    if rail == "claim":
        return True  # online swap; offline DLEQ-verified pending (concept, see requirements.py)
    if rail == "creq":
        return True  # created locally (receive); paying one is checked in walk_send
    return any(rail_ok(i, c) for i in FAMILY[rail] if RAIL[i].direction in ("send", "receive"))


def lock_feasible(c: Context) -> bool:
    return rail_ok("send.ecash.p2pk", c)


# methods a contact send can take (what a "method" question would list)
def contact_methods(c: Context, lock_as_option: bool) -> list[str]:
    m = ["ecash"]
    if lock_as_option and lock_feasible(c):
        m.append("locked")
    if feasible("lightning", c):
        m.append("lightning")
    return m


# --------------------------------------------------------------------------
# Designs
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SendDesign:
    order: tuple[str, ...]  # permutation of entry / amount / method
    auto_skip: bool  # skip a question with one possible answer
    lock: str  # method_option | review_slider | sheet_after_method
    confirm: str  # separate | tap_to_send | melt_only (review only before paying Lightning/onchain)
    amount_chips: bool  # amount step offers exact / round-down / round-up amounts inline
    # How the recipient arrives: "channel" asks contact / scan / paste / create
    # and detects the kind; "kind" asks invoice / address / bitcoin first,
    # and the user still has to paste or scan after that.
    entry: str = "channel"
    # NFC pay: "armed" the wallet screen listens (Sovran's Android ambient
    # mode), "button" the user opens Tap to pay first.
    nfc_arm: str = "button"
    # NFC pay review: "none" (pay inside the tap), "before_write" (a review
    # screen while the terminal waits: breaks numo's 5 s budget).
    nfc_review: str = "none"
    # A "Send all" amount: all proofs as they are (ecash), or the largest
    # amount the fee quote allows (Lightning to a payer-set amount).
    send_all: bool = True
    # A tap offline or without the mint: overpay up to the user's limit from
    # held pieces (the terminal redeems online), or refuse when not exact.
    nfc_overpay: bool = True
    # A person who can't be reached (offline, or no way open): offer "send
    # when back online" and "show a QR they scan", or just say it can't be done.
    unreachable: str = "queue_or_qr"

    def name(self) -> str:
        return (f"entry={self.entry} · nfc={self.nfc_arm}/{self.nfc_review}/{'overpay' if self.nfc_overpay else 'exact'} · all={'y' if self.send_all else 'n'} · unreachable={self.unreachable} · {' → '.join(self.order)} · skip={'y' if self.auto_skip else 'n'} · lock={self.lock}"
                f" · confirm={self.confirm} · chips={'y' if self.amount_chips else 'n'}")


@dataclass(frozen=True)
class ReceiveDesign:
    order: tuple[str, ...]  # permutation of method / amount
    auto_skip: bool
    bip321: bool  # final screen is one unified QR of every feasible rail
    any_in_amount: bool  # "Any amount" is a choice on the amount step
    # First screen: "amount_first" (amount keypad with extra links) or
    # "three_way" (Any amount / Set an amount / Paste a token, one choice each).
    start: str = "amount_first"
    # Claiming a token: "confirm" always (Minibits), "auto_known" claims at
    # once when the mint is known (Macadamia autoRedeem).
    claim: str = "confirm"
    # An offline token we cannot verify: "hold" keeps it aside as unverified
    # and out of the balance; "count" shows it as received anyway (Minibits
    # PREPARED_OFFLINE without a DLEQ check).
    offline_unverified: str = "hold"
    # Set-amount receive without a unified QR: preselect Lightning (one quote)
    # with switch chips on the QR screen, so a screen is spent only when the
    # payer needs another rail. Ignored when bip321 is on.
    default_rail: bool = False
    # Being paid by tap (phone acts as the tag): "passive" = Android listens
    # while the request is on screen (numo arms HCE ~1 s after the screen opens,
    # PaymentRequestActivity.kt:1401), iPhones start it by hand; "button" = a
    # tap-to-receive button on every phone; "qr_only" = no tap, the payer scans.
    nfc_recv: str = "qr_only"

    def sensible(self) -> bool:
        # The first screen offers every receive intent as a peer choice. An
        # amount keypad with "Any amount" and "claim a token" tucked in as
        # links mixes three intents on one screen and hides two of them.
        return self.start == "three_way"

    def name(self) -> str:
        return (f"start={self.start} · claim={self.claim} · offline-unverified={self.offline_unverified} · {' → '.join(self.order)} · skip={'y' if self.auto_skip else 'n'} · bip321={'y' if self.bip321 else 'n'}{' · default-rail=y' if self.default_rail and not self.bip321 else ''} · nfc={self.nfc_recv}"
                f" · any-in-amount={'y' if self.any_in_amount else 'n'}")


@dataclass
class Walk:
    steps: int = 0
    dead_end: int = 0  # steps spent before learning the task cannot happen
    completed: bool = True
    # The wallet showed money as received that it could not verify offline
    # (an unlocked token the sender can still spend, or any token from a mint
    # whose keys we don't hold).
    unsafe: bool = False
    # Completed by queueing: it goes out when the network is back.
    deferred: bool = False
    # Mint quotes created for this receive (NUT-04): each Lightning invoice or
    # onchain address for a set amount is one request the mint must serve.
    quotes: int = 0


PASTED = ("bolt11", "lnaddr", "bolt12", "btc", "creq", "bip321")
NFC = ("nfc_creq", "nfc_bolt11")


def walk_nfc_send(d: SendDesign, t: Task, c: Context) -> Walk:
    """A tap: the terminal fixes the amount; unit, mint and fees are decided
    during the tap (createMachine NFC loop). Only a fallback asks the user."""
    w = Walk()
    w.steps += 0 if d.nfc_arm == "armed" else 1  # open Tap to pay
    if t.entry == "nfc_creq":
        # Pays from held ecash: exact proofs offline, a swap online.
        payable = c.req_payable and (c.exact or c.mint or (d.nfc_overpay and c.overpay_ok))
        if payable:
            if d.nfc_review == "before_write":
                w.completed = False  # the terminal times out while the user reads
                w.dead_end = w.steps + 1
                w.steps += 1
            return w
        # No mint qualifies: fall back to the tag's Lightning invoice (bitcoin:?…&lightning=)
        if feasible("lightning", c):
            w.steps += 1  # confirm the melt preview after the session is released
            return w
        w.completed = False
        w.dead_end = max(w.steps, 1)  # a failed tap still cost the user an attempt
        return w
    # Lightning-only tag: like a pasted invoice
    if not feasible("lightning", c):
        w.completed = False
        w.dead_end = max(w.steps, 1)  # a failed tap still cost the user an attempt
        return w
    w.steps += 1  # confirm
    return w


def walk_send(d: SendDesign, t: Task, c: Context) -> Walk:
    if t.entry in NFC:
        return walk_nfc_send(d, t, c)
    if t.entry == "p2pk":
        w = Walk(steps=1)  # paste the key
        if c.mint and c.p2pk:
            w.steps += 1  # amount; its button creates the locked token
            if d.confirm == "separate":
                w.steps += 1
            return w
        if d.unreachable == "queue_or_qr":
            w.steps += 1  # "Lock and send when back online" (or unlocked in person)
            w.deferred = not c.online
            return w
        w.completed, w.dead_end = False, w.steps
        return w
    if t.entry == "inperson":
        w = Walk(steps=2)  # "In person", then the amount whose button shows the QR
        if not c.mint and not c.exact and not d.amount_chips:
            w.steps += 1  # separate round-down / round-up
        if d.confirm == "separate":
            w.steps += 1
        return w
    if t.entry == "contact" and not c.online:
        # Nothing can reach them: a private message needs the network.
        w = Walk(steps=1)
        if d.unreachable == "queue_or_qr":
            w.steps += 1  # "Send when back online" or "They're here: show a QR"
            w.deferred = True
            return w
        w.completed, w.dead_end = False, w.steps
        return w
    w = Walk()
    # A pasted/scanned request is delivered over its transport (Nostr or
    # HTTP), so the payer needs the network; the pieces come from held ecash:
    # exact, overpaid within the limit, or change from the mint.
    rail_ok = any(feasible(r, c) for r in t.rails if r != "creq") or (
        "creq" in t.rails and c.online and c.req_payable
        and (c.exact or c.mint or (d.nfc_overpay and c.overpay_ok)))
    known_entry = False
    method_chosen = False
    entry_step = 0
    for q in d.order:
        if q == "entry":
            w.steps += 1  # pick a contact / scan / paste / "create a token"
            if d.entry == "kind" and t.entry in PASTED:
                w.steps += 1  # chose "a Lightning address", then still had to paste it
            known_entry = True
            entry_step = w.steps
            if not rail_ok:
                # the scan/paste screen tells them straight away
                w.dead_end = w.steps
                w.completed = False
                return w
        elif q == "amount":
            if t.amount_fixed and known_entry:
                continue
            w.steps += 1
            if t.amount_fixed:
                w.steps += 1  # typed an amount the invoice/request then overrides: re-confirm
        elif q == "method":
            if not known_entry:
                w.steps += 1  # generic "ecash / lightning / onchain" choice before we know the recipient
                if not rail_ok:
                    w.dead_end = w.steps
                    w.completed = False
                    return w
                method_chosen = True
                continue
            if t.entry == "contact":
                n = len(contact_methods(c, d.lock == "method_option"))
                if n > 1 or not d.auto_skip:
                    w.steps += 1
            elif not d.auto_skip:
                w.steps += 1
            method_chosen = True
    is_ecash = t.rails[0] == "ecash" and t.entry in ("contact", "token")
    # A method picked before the amount can turn out unusable for that amount:
    # over the mint's NUT-05 max, or (offline) not composable from held proofs.
    # The user then goes back and picks again.
    method_first = d.order.index("method") < d.order.index("amount")
    if method_first and not t.amount_fixed:
        if not c.in_bounds and any(r in t.rails for r in ("lightning", "bolt12", "onchain")):
            w.steps += 1
        if t.entry == "contact" and c.mint and not c.in_bounds:
            w.steps += 1  # Lightning offered, then refused for the amount
    if is_ecash and t.entry == "contact" and lock_feasible(c):
        if d.lock == "sheet_after_method":
            w.steps += 1  # "Lock to Alice?" sheet on every online contact ecash send
    if t.wants_lock and not lock_feasible(c):
        pass  # hidden; they send unlocked or wait — not a step
    if is_ecash and not c.mint and not c.exact:
        if not d.amount_chips:
            w.steps += 1  # separate round-down / round-up sheet
    if t.send_all and not d.send_all:
        # Typing the balance by hand: over Lightning the fee reserve pushes it
        # over and the quote fails once before a lower amount works.
        if "lightning" in t.rails and c.mint:
            w.steps += 1
    if t.id == "send.nfc.card":
        w.steps += 1  # hold the card to the phone after the token is made
    # Money never leaves on the scan itself: when nothing was asked after the
    # recipient, "last tap sends" still needs a screen showing the amount.
    if d.confirm != "separate" and w.steps == entry_step:
        w.steps += 1
        return w
    is_melt = not is_ecash and t.rails[0] in ("lightning", "bolt12", "onchain")
    if d.confirm == "separate" or (d.confirm == "melt_only" and is_melt):
        w.steps += 1
    return w


def walk_receive(d: ReceiveDesign, t: Task, c: Context) -> Walk:
    w = Walk()
    if t.id in ("recv.token", "recv.token.nfc"):
        w.steps = 1  # "Paste a token" / scan / tap the card
        if c.mint:
            if not c.mint_known:
                w.steps += 1  # "Add this mint" or "Transfer to my mint" (Lightning swap)
            elif d.claim == "confirm":
                w.steps += 1  # Claim
            return w
        # Offline: only a lock to us, checked against saved keys, is safe to count.
        verified = c.mint_known and c.locked_to_us
        if verified and d.claim in ("auto_known", "auto_verified"):
            return w  # queued as "Received, pending redeem" (Sovran's Nut Drop rule)
        w.steps += 1  # "Save for later"
        if not verified:
            if d.offline_unverified == "count":
                w.unsafe = True  # shown as received though the sender could still spend it
            # "hold": kept aside as unverified, not in the balance, redeemed when online
        return w
    if t.id == "recv.nfc":
        # Set an amount, then hold the phone out (card emulation). The request is
        # in-band, so it works offline; claiming the token needs the mint.
        w.steps = 2 if d.start == "three_way" else 1
        # Only Android and iPhones in the EEA can be tapped (iOS CardSession needs an
        # Apple-managed entitlement and a manual start; docs/research/nfc-payment-requests.md
        # §3). Elsewhere, and with qr_only, the payer scans the QR instead.
        android, eea_ios = 1 - P_IOS, P_IOS * P_EEA
        tap_ok = android + eea_ios if d.nfc_recv != "qr_only" else 0.0
        start = (eea_ios if d.nfc_recv == "passive" else android + eea_ios if d.nfc_recv == "button" else 0.0)
        w.steps += start + (1 - tap_ok) * QR_INSTEAD + tap_ok * P_TAP_LOST  # a lost tap costs one retry
        return w
    wants_specific = t.id in ("recv.cashu", "recv.lightning")
    feasible_rails = [r for r in t.rails if feasible(r, c)]
    # A unified QR for a set amount asks the mint for every quote-backed rail
    # up front; asking the method first creates at most the one picked.
    # Any-amount codes (offer, address, npub.cash) are reusable: no per-receive quote.
    if not t.any_amount:
        backed = [r for r in feasible_rails if r in ("lightning", "onchain")]
        w.quotes = len(backed) if d.bip321 else (1 if backed and t.id != "recv.cashu" else 0)
    # Default rail: a switch is needed when the payer can't use Lightning. Certain
    # for a Cashu-only payer; for an unknown payer a guess (DEFAULT_RAIL_MISS).
    # With Lightning infeasible the page defaults to ecash instead, so no switch.
    miss = 0.0
    if d.default_rail and not d.bip321 and not t.any_amount and "lightning" in feasible_rails:
        miss = 1.0 if t.id == "recv.cashu" else 0.0 if t.id == "recv.lightning" else DEFAULT_RAIL_MISS
    if not feasible_rails:
        w.completed = False
        w.dead_end = 1
        return w
    if d.start == "three_way":
        w.steps += 1  # Any amount / Set an amount
        if not t.any_amount:
            w.steps += 1  # the amount itself
        if d.default_rail and not d.bip321 and not t.any_amount:
            w.steps += miss  # switch chips on the QR screen
        elif wants_specific or not d.bip321:
            w.steps += 1  # pick one rail
        return w
    for q in d.order:
        if q == "method":
            if d.bip321 and not wants_specific:
                continue  # unified QR: the payer picks
            if d.bip321 and wants_specific:
                w.steps += 1  # switch the QR to one rail
                continue
            if d.default_rail and not t.any_amount:
                w.steps += miss  # preselected Lightning, switch only if needed
                continue
            w.steps += 1
        elif q == "amount":
            if t.any_amount:
                if d.any_in_amount:
                    w.steps += 1  # tap "Any amount"
                else:
                    w.steps += 2  # a "fixed or any?" question, then the rail
            else:
                w.steps += 1
    return w


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------


UNSAFE_PENALTY = 10.0  # one unsafe outcome outweighs any number of saved screens
# A payment the design could not make: the user still has to find another way.
# Tasks impossible in a context cost every design the same, so only designs
# that leave a possible payment unmade are ranked down.
UNMET_PENALTY = 3.0


# Tap to receive (guesses; LOOP_NOTES pass 18): share of iPhones, share of those
# in the EEA (the only iPhones that can emulate a tag), extra cost when the payer
# must scan a QR instead of tapping, and the chance a tap is lost mid-write
# (numo fails the tap after 3.5 s without an APDU, NdefHostCardEmulationService.java:49).
P_IOS = 0.5
P_EEA = 0.2
QR_INSTEAD = 0.5
P_TAP_LOST = 0.1

# Share of set-amount payers who can't pay the preselected Lightning invoice
# (Cashu-only or onchain-only wallets). A guess; see LOOP_NOTES pass 12.
DEFAULT_RAIL_MISS = 0.3


def quote_load(design, tasks, ctxs):
    """Expected mint quotes per receive, weighted like score()."""
    tw = sum(t.weight for t in tasks)
    return sum(t.weight / tw * c.weight * walk_receive(design, t, c).quotes for t in tasks for c in ctxs)


def score(walk_fn, design, tasks, ctxs):
    total, dead, blocked = 0.0, 0.0, 0.0
    tw = sum(t.weight for t in tasks)
    for t in tasks:
        for c in ctxs:
            w = walk_fn(design, t, c)
            p = t.weight / tw * c.weight
            total += p * w.steps
            dead += p * (w.dead_end + (UNSAFE_PENALTY if w.unsafe else 0) + (0 if w.completed else UNMET_PENALTY))
            blocked += p * (0 if w.completed else 1)
    return total, dead, blocked


def all_send_designs() -> list[SendDesign]:
    # Two dimensions are fixed at values an earlier full run settled, to keep
    # the matrix small enough for robustness.py: asking the kind of address
    # first always lost (by 0.64 screens in every sample), and lock placement
    # always tied (method option vs slider), so one value stands for it.
    return [
        SendDesign(order, skip, "review_slider", confirm, chips, "channel", nfc_arm, nfc_review, send_all, overpay, unreachable)
        for order in itertools.permutations(("entry", "amount", "method"))
        for skip in (True, False)
        for confirm in ("separate", "tap_to_send", "melt_only")
        for chips in (True, False)
        for nfc_arm in ("button", "armed")
        for nfc_review in ("none", "before_write")
        for send_all in (True, False)
        for overpay in (True, False)
        for unreachable in ("queue_or_qr", "dead_end")
    ]


def all_receive_designs() -> list[ReceiveDesign]:
    return [
        ReceiveDesign(order, skip, bip321, anyin, start, claim, unverified, default_rail, nfc_recv)
        for default_rail in (False, True)
        for nfc_recv in ("passive", "button", "qr_only")
        for order in itertools.permutations(("method", "amount"))
        for skip in (True, False)
        for bip321 in (True, False)
        for anyin in (True, False)
        for start in ("amount_first", "three_way")
        for claim in ("confirm", "auto_known")
        for unverified in ("hold", "count")
        if not (start == "three_way" and (order != ("method", "amount") or anyin))  # order/any don't apply
        and not (bip321 and default_rail)  # a unified QR has no default rail
    ]


def main() -> None:
    ctxs = contexts()
    send_designs = all_send_designs()
    recv_designs = all_receive_designs()
    send_ranked = sorted(((score(walk_send, d, SEND, ctxs), d) for d in send_designs), key=lambda x: (x[0][0] + x[0][1], x[1].name()))
    recv_all = sorted(((score(walk_receive, d, RECEIVE, ctxs), d) for d in recv_designs), key=lambda x: (x[0][0] + x[0][1], x[1].name()))
    recv_ranked = [x for x in recv_all if x[1].sensible()]

    baselines_send = {
        # SendDialog: Ecash / Lightning / Onchain first, then destination and amount, then Send/Pay
        "cashu.me (method first)": SendDesign(("method", "entry", "amount"), False, "review_slider", "separate", False, "channel", send_all=False, nfc_overpay=False, unreachable="dead_end"),
        # SendView: destination, amount (skipped when the invoice has one), confirm; lock is a toggle
        "Cashu Wallet native (destination first)": SendDesign(("entry", "amount", "method"), True, "review_slider", "separate", False, send_all=False, nfc_overpay=False, unreachable="dead_end"),
        # selectDestination, amount, "Select option" always opens, lock sheet, confirm before a melt
        "Sovran today": SendDesign(("entry", "amount", "method"), False, "sheet_after_method", "melt_only", False, nfc_arm="armed", nfc_overpay=False, unreachable="dead_end"),
        # WalletView: one scan/paste button routes by kind; amount; Pay/Send; lock is optional on the ecash screen
        "Macadamia": SendDesign(("entry", "amount", "method"), True, "review_slider", "separate", False, send_all=False, nfc_overpay=False, unreachable="dead_end"),
        # Send → "Ecash or Bitcoin" modal → paste/scan/contact → amount → mint → confirm
        "Minibits": SendDesign(("method", "entry", "amount"), False, "review_slider", "separate", False, send_all=False, nfc_overpay=False, unreachable="dead_end"),
        # Send Ecash / Send → paste/scan/contact detects the kind → amount only when the invoice has none;
        # ecash sends on one tap, Lightning gets a swipe review; lock is a button on the ecash form
        "Zeus": SendDesign(("method", "entry", "amount"), True, "method_option", "melt_only", False, send_all=False, nfc_overpay=False, unreachable="dead_end"),
    }
    baselines_recv = {
        # ReceiveDialog: Ecash / Lightning / Onchain, then amount (BOLT12 can skip it)
        "cashu.me (method first)": ReceiveDesign(("method", "amount"), False, False, False),
        # ReceiveView: Ecash / Bitcoin / paste, then amount
        "Cashu Wallet native (method first)": ReceiveDesign(("method", "amount"), False, False, False, nfc_recv="button"),
        # ReceiveHub (QR display / fixed amount / scan / paste), amount, then "Select option" again
        "Sovran today (hub, amount, Select option)": ReceiveDesign(("method", "amount"), False, False, False),
        # Deposit with an empty amount makes a BOLT12 offer; tokens from known mints auto-redeem
        "Macadamia": ReceiveDesign(("method", "amount"), False, False, True, "amount_first", "auto_known", nfc_recv="button"),
        # Receive → "Ecash or Bitcoin" → amount → mint; tokens need a Receive tap
        "Minibits": ReceiveDesign(("method", "amount"), False, False, False, "amount_first", "confirm", "count"),
        # Receive tabs (Lightning invoice / Lightning address) with the amount on the same screen; tokens need a Receive tap.
        # The unified QR is node-side only, so not for Cashu. Offline tokens queue as pending (ReceiveEcash, CashuStore)
        "Zeus": ReceiveDesign(("method", "amount"), False, False, False, "amount_first", "confirm", nfc_recv="button"),
    }

    def per_task(walk_fn, d, tasks, online):
        rows = []
        for t in tasks:
            cs = [c for c in ctxs if c.online == online and (not online or c.mint_up)]
            wt = sum(c.weight for c in cs)
            s = sum(walk_fn(d, t, c).steps * c.weight for c in cs) / wt
            ok = sum((walk_fn(d, t, c).completed) * c.weight for c in cs) / wt
            later = sum((walk_fn(d, t, c).deferred) * c.weight for c in cs) / wt
            rows.append((t.label, s, ok if later < 0.99 else -1))
        return rows

    out = ["# Payment flow brute force", "",
           f"{len(send_designs)} send designs and {len(recv_designs)} receive designs, each walked through "
           f"{len(ctxs)} contexts × {len(SEND)} send / {len(RECEIVE)} receive tasks. "
           "Score = expected screens the user must act on, plus screens spent before learning a task is impossible.", ""]
    for title, ranked, base, walk_fn, tasks in (
        ("Send", send_ranked, baselines_send, walk_send, SEND),
        ("Receive", recv_ranked, baselines_recv, walk_receive, RECEIVE),
    ):
        if title == "Receive":
            (s0, _, _), d0 = recv_all[0]
            out += [f"Unconstrained best receive design (fails the one-choice-per-screen rule): {s0:.2f} · {d0.name()}", ""]
        out += [f"## {title}: best designs", "", "| Rank | Expected steps | Dead-end steps | Design |", "| --- | --- | --- | --- |"]
        for i, ((s, dead, _), d) in enumerate(ranked[:8], 1):
            out.append(f"| {i} | {s:.2f} | {dead:.3f} | {d.name()} |")
        out += ["", f"### {title}: baselines", "", "| Flow | Expected steps | Dead-end steps | Design |", "| --- | --- | --- | --- |"]
        for label, d in base.items():
            s, dead, _ = score(walk_fn, d, tasks, ctxs)
            extra = 1 if "Select option" in label else 0  # Sovran asks the method twice on receive
            out.append(f"| {label} | {s + extra:.2f} | {dead:.3f} | {d.name()} |")
        best = ranked[0][1]
        out += ["", f"### {title}: best design per task", "", "| Task | Steps online | Steps offline | Possible offline |", "| --- | --- | --- | --- |"]
        on = per_task(walk_fn, best, tasks, True)
        off = per_task(walk_fn, best, tasks, False)
        for (label, s_on, _), (_, s_off, ok_off) in zip(on, off):
            out.append(f"| {label} | {s_on:.2f} | {s_off:.2f} | {'queued, or in person' if ok_off == -1 else 'yes' if ok_off > 0.99 else 'no' if ok_off < 0.01 else f'{ok_off:.0%}'} |")
        out.append("")
    # Mint load: the unified QR saves a screen but asks the mint for every
    # quote-backed rail. Price one quote in screens and find where asking the
    # method first starts to win (LOOP_NOTES pass 12).
    scored = [(sc[0] + sc[1], quote_load(d, RECEIVE, ctxs), d) for sc, d in recv_ranked]
    out += ["### Receive: cost of mint quotes", "",
            "Each set-amount Lightning invoice or onchain address is a mint quote (NUT-04). Price one quote in",
            "screens; the ranking above is the 0 row. Quotes = expected quotes per receive.", "",
            "| Quote cost (screens) | Best design | Unified QR | Score | Quotes |", "| --- | --- | --- | --- | --- |"]
    for cost in (0, 0.5, 1.0, 2.0, 2.5, 4.0):
        s_, q_, d_ = min(scored, key=lambda x: (x[0] + cost * x[1], x[2].name()))
        out.append(f"| {cost} | {d_.name()} | {'yes' if d_.bip321 else 'no'} | {s_ + cost * q_:.3f} | {q_:.3f} |")
    uni = min((x for x in scored if x[2].bip321), key=lambda x: x[0])
    ask = min((x for x in scored if not x[2].bip321), key=lambda x: x[0])
    flip = (ask[0] - uni[0]) / (uni[1] - ask[1]) if uni[1] > ask[1] else float("inf")
    out += ["", f"Best unified: {uni[0]:.3f} screens, {uni[1]:.3f} quotes. Best asking the method: {ask[0]:.3f} screens, "
            f"{ask[1]:.3f} quotes. Asking wins once a quote costs more than **{flip:.2f} screens**.", ""]
    # Tap to receive: each mode on the "get paid by tap" task, holding the rest of
    # the best receive design fixed, and how the ranking moves with the guesses.
    nfc_task = next(t for t in RECEIVE if t.id == "recv.nfc")
    best_recv = recv_ranked[0][1]
    def tap_steps(mode):
        d = replace(best_recv, nfc_recv=mode)
        return sum(c.weight * walk_receive(d, nfc_task, c).steps for c in ctxs)
    out += ["### Receive: being paid by tap", "",
            f"Guesses: {P_IOS:.0%} iPhones, {P_EEA:.0%} of them in the EEA (the only iPhones that can be tapped),",
            f"scanning a QR instead of tapping costs {QR_INSTEAD} screens, a lost tap {P_TAP_LOST:.0%} (one retry).", "",
            "| Mode | Steps on 'Get paid by tap' |", "| --- | --- |"]
    for mode in ("passive", "button", "qr_only"):
        out.append(f"| {mode} | {tap_steps(mode):.2f} |")
    # Break-evens against qr_only, with q = QR_INSTEAD: button wins once q > (tap + lost) / tap_ok,
    # passive once q > (eea_ios + lost) / tap_ok.
    tap_ok = (1 - P_IOS) + P_IOS * P_EEA
    b_even = (tap_ok + tap_ok * P_TAP_LOST) / tap_ok
    p_even = (P_IOS * P_EEA + tap_ok * P_TAP_LOST) / tap_ok
    out += ["", f"A button on every phone beats showing the QR only once scanning costs the payer more than {b_even:.2f} screens;",
            f"passive listening beats it from {p_even:.2f}. The tap pays off when it needs no press (Android, passive).", ""]
    Path(__file__).with_name("results.md").write_text("\n".join(out) + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
