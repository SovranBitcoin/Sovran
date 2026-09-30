# Payment-flow research loop

Use with `/goal Follow docs/research/payment-flows/LOOP_PROMPT.md for one pass.`
or `while :; do claude -p "$(cat docs/research/payment-flows/LOOP_PROMPT.md)"; done`
from `Sovran/sovran-app`.

---

You are one pass of a self-improving loop over the Cashu payment-flow research in
`docs/research/payment-flows/` (run from `Sovran/sovran-app`). Its purpose: help a user make
a payment in the fewest screens, online or offline, and be exactly right about the protocol,
including what happens when something fails. Each pass finds one real problem, fixes it,
verifies it, and records it. Change nothing if nothing is wrong.

## Sources (local checkouts first, then read-only GitHub or the web)

- `../../nuts` (cashubtc/nuts): the Cashu spec, including `error_codes.md`; the final word on protocol behaviour
- Lightning: BOLT 11 and BOLT 12 (lightning/bolts), LNURL LUD-01/06/09/16/21 (lnurl/luds), and the BOLT 4 failure messages
- Nostr: NIP-05, NIP-17, NIP-44, NIP-57, NIP-60 and NIP-61 (nostr-protocol/nips; `../../nips` if cloned); npub.cash
- Bitcoin: BIP-21 and BIP-321
- `./` Sovran (SovranBitcoin/Sovran), `../../coco` (cashubtc/coco), `../../cashu-ts` (cashubtc/cashu-ts)
- `../../cdk` (cashubtc/cdk), `../../nutshell` (cashubtc/nutshell)
- `../../cashu.me` (cashubtc/cashu.me), `../../wallet` (cashubtc/wallet), `../../macadamia` (zeugmaster/macadamia), `../../minibits_wallet` (minibits-cash/minibits_wallet)
- `../../zeus` (ZeusLN/zeus): a Lightning-first wallet with Cashu; use it for Lightning-wallet
  conventions (fee limits, amountless invoices, LNURL, BOLT12, onchain, how route failures and
  retries are shown) and for how a Lightning wallet presents ecash

Start behavioural questions with jevgrep: `jg "<question>" <path>`. Use grep or direct reads for
exact symbols. Use `gh` read-only (`gh search issues`, `gh pr list --state all`, `gh api graphql`
for discussions) for open problems, edge cases and ideas. Never post, comment, push or commit.

## Artifact

`requirements.py` (rails as data), `bruteforce.py` → `results.md`, `robustness.py` →
`robustness.md`, `concept/` (`body.html`, `head.css.html`, `icons.js`; `build.py` builds,
`check.cjs` checks), `README.md` (max 1,500 words), `LOOP_NOTES.md` (loop memory; create if missing).

## Failure resolution

Every failure is described by four things:

a. **Stage**, meaning when it can first be known:
   - **Choose**: before the user picks the option. A cheap check (LNURL or `.well-known`
     lookup, NIP-05, kind 10019, mint `/v1/info`, NUT-04/05 method limits, balance per mint,
     connectivity) greys out, reorders or annotates the option. Do this only if the check is
     fast and has no side effects, and state its timeout and what a stale cache means.
   - **Quote**: after the amount (a mint quote or melt quote, LNURL callback min/max, invoice
     expiry, fee reserve above the user's limit).
   - **Pay**: while running (melt fails or stays pending, the mint can't find a route, proofs
     already spent, keyset inactive, a Nostr or HTTP delivery isn't acked, the NFC session drops).
   - **After**: after the user thinks it's done (the receiver can't claim, the token was spent
     elsewhere, the fee refund is missing, the mint quote is paid but the ecash was never minted).

b. **Signal**: the exact error code, HTTP status, LNURL `{status:"ERROR"}`, melt state, or
   timeout that shows it. Cite it.

c. **Funds**: are they spendable, reserved/pending (and until when), spent, or unknown? What
   does the wallet do next to settle them: check state (NUT-07), restore, or re-check the melt quote?

d. **Next step**: the smallest recovery the page offers. For example: pay from another mint
   that has the balance and a route; another rail from the same QR or contact (ecash to
   Lightning to onchain); a lower amount or a higher fee limit; retry later or send later;
   share a token instead. Recommend the most likely one first. Hide the others unless they
   can work. A failure with no next step is a dead end and counts as a bug.

Catch a failure at the earliest stage where it can be detected reliably. Never make an option
look broken because a check was merely slow (unknown is not failed).

## Each pass

1. Read `LOOP_NOTES.md`. Pick the single most valuable open item. If there are none, audit one
   area nobody has verified yet:
   - one rail's failure table: for each stage, the failures, their signals, what happens to the
     funds, and the next step (for example, a Lightning address via npub.cash, a bolt11 melt,
     a NUT-18 request over Nostr, a tap-to-pay, or a token claim)
   - pasteable/scannable strings: tokens v3/v4, creqA/creqB fields, bolt11 with and without an
     amount, bolt12, LNURL, Lightning addresses, BIP-21/321 combinations, bitcoin addresses,
     npub/NIP-05, P2PK keys, mint URLs, UR QR, NFC records, prefixes, upper case
   - mint configurations that change a flow or a failure
   - settings (only with spec plus shipping-wallet evidence)
   - numbers on the page matching the latest results
2. Look for a problem: something the page, model or README claims that the sources contradict;
   a failure that is found later than it could be, or earlier than is reliable; a failure with
   no next step, or with the wrong one; funds left in an unclear state; a case the page can't
   show or simulate; a confusing or wordy screen. Cite file:line or a URL for every fact. If you
   can't cite it, write it down as an open question instead.
3. Fix it with the smallest change that resolves it. Corrections come before additions.
   Choose-stage checks change the option (greyed, reordered or annotated with a reason). Quote,
   Pay and After failures go in the bottom bar's ⋯ menu on the step where they occur, each with
   its next step. New conditions go in the Scenario card, and new settings only with evidence.
   If recovery changes the screen count, model it in `requirements.py` and `bruteforce.py` (for
   example, a route failure means one more screen to pick another mint). Keep page strings at
   most 150 characters and the README under 1,500 words; if you add words, remove as many
   elsewhere. Label anything novel "idea" until a later pass verifies it.
4. Verify, and revert your change if any of these fail:
   ```
   python3 docs/research/payment-flows/bruteforce.py
   python3 docs/research/payment-flows/robustness.py 300
   python3 docs/research/payment-flows/concept/build.py
   node docs/research/payment-flows/concept/check.cjs
   ```
   If a ranking or number changed, update the page and README to match and say why.
5. Append to `LOOP_NOTES.md`: date, the problem, sources, the fix, verification output, and new
   open questions, each with where to look. Keep a running per-rail failure table there
   (stage | failure | signal | funds | next step | verified?). Then stop.

## Rules

Accuracy over coverage; never invent wallet or mint behaviour ("not confirmed" is fine); one
focused change per pass; no drive-by rewrites; don't commit or push.
