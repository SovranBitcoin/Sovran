"""Requirements of every way value moves in a Cashu wallet, as data.

Each Rail is one way to pay or get paid. The brute force in `bruteforce.py`
reads only this file, so a change in the protocol or in a mint's configuration
is a change here, never in the search.

Sources: cashubtc/nuts (NUT-00..30), coco packages/core, cdk crates/cdk/src/wallet,
cashu-ts, and BIP-321 for unified QR codes. See README.md for citations.
"""

from dataclasses import dataclass, field
from typing import Literal

Direction = Literal["send", "receive"]
# Who fixes the amount:
#   "user"     the user types it
#   "fixed"    the counterpart already fixed it (invoice with amount, request with amount)
#   "optional" either: the counterpart may have fixed it, otherwise the user may type one
#   "any"      no amount at all is needed (reusable address, amountless offer)
AmountRule = Literal["user", "fixed", "optional", "any"]


@dataclass(frozen=True)
class Rail:
    id: str
    direction: Direction
    label: str
    # Needs the device online, for its own side of the payment.
    needs_network: bool
    # Needs the user's mint to answer (quote, swap, melt). Implies needs_network.
    needs_mint: bool
    # NUT or mint-info capability the chosen mint must advertise.
    mint_capability: str | None
    # What the counterpart must be able to use.
    counterpart: Literal["cashu", "lightning", "bitcoin", "any"]
    # How the counterpart reaches us, if they initiated (scan/paste of their data).
    destination_kind: str | None = None
    amount_rule: AmountRule = "user"
    # Options the rail can take, each one a potential question.
    options: tuple[str, ...] = ()
    # Can it ride inside a BIP-321 bitcoin: URI next to other rails.
    bip321_param: str | None = None
    notes: str = ""


RAILS: list[Rail] = [
    # ---------------- send ----------------
    Rail("send.ecash.exact", "send", "Ecash from held proofs", needs_network=False, needs_mint=False,
         mint_capability=None, counterpart="cashu", amount_rule="user",
         notes="Exact subset of held proofs; cdk SendKind::OfflineExact, coco ops.send.prepare({offline}). "
               "Offline and not exact: round down/up to a composable amount."),
    Rail("send.ecash.swap", "send", "Ecash with change", needs_network=True, needs_mint=True,
         mint_capability="nut03", counterpart="cashu", amount_rule="user",
         notes="NUT-03 swap to make change; input_fee_ppk applies (NUT-02)."),
    Rail("send.ecash.p2pk", "send", "Locked ecash", needs_network=True, needs_mint=True,
         mint_capability="nut11", counterpart="cashu", amount_rule="user", options=("lock_duration",),
         notes="NUT-11 lock needs a swap (coco p2pk send always swaps). Receiver can verify a locked token offline (NUT-12) but redeems online. Locktime + refund keys make it reclaimable."),
    Rail("send.request", "send", "Pay a Cashu payment request", needs_network=True, needs_mint=False,
         mint_capability=None, counterpart="cashu", destination_kind="creq", amount_rule="optional",
         bip321_param="creq",
         notes="NUT-18. Transport nostr/post needs network; in-band (NFC/QR back) does not. "
               "Request may restrict mints (m) and unit (u) and require a lock (nut10)."),
    Rail("send.bolt11", "send", "Pay a Lightning invoice", needs_network=True, needs_mint=True,
         mint_capability="nut05:bolt11", counterpart="lightning", destination_kind="bolt11",
         amount_rule="fixed", bip321_param="lightning",
         notes="Amount in the invoice. Amountless invoices need mint 'amountless' option (NUT-23)."),
    Rail("send.lnaddr", "send", "Pay a Lightning address", needs_network=True, needs_mint=True,
         mint_capability="nut05:bolt11", counterpart="lightning", destination_kind="lnaddr",
         amount_rule="user", notes="LUD-16/LNURL-pay: payer picks within min/maxSendable. Resolved by the app in coco and cashu-ts; cdk resolves it in-library (melt_lightning_address_quote)."),
    Rail("send.bolt12", "send", "Pay a Lightning offer", needs_network=True, needs_mint=True,
         mint_capability="nut05:bolt12", counterpart="lightning", destination_kind="bolt12",
         amount_rule="optional", bip321_param="lno", notes="NUT-25; offer may carry an amount."),
    Rail("send.onchain", "send", "Pay a bitcoin address", needs_network=True, needs_mint=True,
         mint_capability="nut05:onchain", counterpart="bitcoin", destination_kind="btc",
         amount_rule="optional", options=("fee_tier",),
         notes="NUT-30 melt; BIP-21 may carry amount. Mint quotes fee tiers."),
    # ---------------- receive ----------------
    Rail("recv.token", "receive", "Claim a token", needs_network=True, needs_mint=True,
         mint_capability="nut03", counterpart="cashu", destination_kind="token", amount_rule="fixed",
         notes="Swap makes it ours. No library receives offline (coco, cdk, cashu-ts all swap); offline pending after a NUT-12 DLEQ check is a concept."),
    Rail("recv.request", "receive", "Cashu payment request", needs_network=False, needs_mint=False,
         mint_capability=None, counterpart="cashu", amount_rule="optional", bip321_param="creq",
         notes="NUT-18 (creqA) / NUT-26 (creqB) created locally. Online it arrives over its transport (Nostr NIP-17 or HTTP). Offline it is only safe with nut10 set to our key: the online payer locks the token to us (NUT-11), sends it in-band (they show it, we scan, or NFC), and we verify lock + DLEQ against saved keys (NUT-12). BIP-321 carries it as creq= (NUT-26); only cdk builds bitcoin: URIs today."),
    Rail("recv.bolt11", "receive", "Lightning invoice", needs_network=True, needs_mint=True,
         mint_capability="nut04:bolt11", counterpart="lightning", amount_rule="user",
         bip321_param="lightning", notes="Amount required (NUT-04 bolt11)."),
    Rail("recv.bolt12", "receive", "Lightning offer", needs_network=True, needs_mint=True,
         mint_capability="nut04:bolt12+nut20", counterpart="lightning", amount_rule="optional",
         bip321_param="lno", notes="NUT-25; reusable, amount optional; NUT-20 pubkey required."),
    Rail("recv.lnaddr", "receive", "Lightning address (npub.cash)", needs_network=False, needs_mint=False,
         mint_capability=None, counterpart="lightning", amount_rule="any",
         notes="Static address; showing it needs nothing, claiming needs network."),
    Rail("recv.onchain", "receive", "Bitcoin address", needs_network=True, needs_mint=True,
         mint_capability="nut04:onchain+nut20", counterpart="bitcoin", amount_rule="any",
         bip321_param="address", notes="NUT-30: no amount in the request; each UTXO must be >= min_amount; waits for confirmations."),
]
