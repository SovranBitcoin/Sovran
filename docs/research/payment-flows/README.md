# Payment flows: fewest screens, online and offline

Which order of questions gets someone paid, or paid to, in the fewest screens,
for every rail a Cashu wallet can use, with and without a network?

- [`requirements.py`](requirements.py): each rail as data (network, mint,
  gating capability, who sets the amount, counterpart, BIP-321 param).
- [`bruteforce.py`](bruteforce.py) → [`results.md`](results.md): walks every
  design through every task × context and ranks them (~50 s).
- [`robustness.py`](robustness.py) → [`robustness.md`](robustness.md): re-scores
  under 600 random weightings and tests each decision against its best
  alternative (~90 s).

Copy budget: this file stays under 1,500 words; the concept page keeps every
description, hint and trace line under 150 characters.

## Principle: who first, then narrow the how

Ask who is being paid, never how. The how is narrowed from what the wallet
knows; only a real choice between two open ways becomes a question.

| Fact | Source | Opens or closes |
| --- | --- | --- |
| Lightning address | kind-0 `lud16` | Lightning; else npub.cash as a caution |
| Accepted mints, lock key | NIP-61 kind 10019 (cached 10 min, `nutzapProfileDiscovery.ts`) | Ecash from a mint they list; lock to their key, else their Nostr key (unconfirmed) |
| Balance per mint | wallet | Ecash needs enough at a mint they accept |
| Mint features | NUT-04/05/11/30 | Lightning, amountless, BOLT12, onchain, locking |
| Online / mint reachable | device | Reachable mints first, failed ones skipped; offline: held pieces |

## Model

- **Contexts (1,536):** online; mint up; bolt12; onchain; P2PK; exact pieces;
  amount in mint limits; token/request mint known; NFC request payable; token
  locked to us; overpay within limit. Weighted (e.g. 15% offline).
- **Tasks (17 send, 7 receive):** `SEND` and `RECEIVE` in `bruteforce.py`.
- **Modules:** every rail and feature is a build switch (`flow.py MODULES`,
  with dependencies, and `PRESETS` such as Lightning only, onchain only, no
  Nostr). A module that's off is hidden, not greyed out. A one-rail build
  skips "Get paid by". Balances stay at mints in every build.
- **Scoring:** screens the user acts on, plus wasted screens, plus 3 for a
  payment left unmade (equal across designs when none is possible), at least 1
  for a failed tap, and 10 for showing unverifiable ecash as received.

## Findings

| Decision | Winner | Lead | Samples |
| --- | --- | --- | --- |
| First send question | contact / scan / paste / tap / share token, not the kind of address | 0.64 | 100% |
| Skip a question with one answer | yes | 0.26 | 100% |
| Confirm | the last tap sends | 0.14 | 100% |
| Person you can't reach | send later, or share a token | 0.14 | 100% |
| NFC pay | armed, no review before the write | 0.07 / 0.22 | 100% |
| Amount chips (exact, round, all) | yes | 0.03 | 100% |
| Overpay offline on a tap | up to the limit | 0.01 | 100% |
| Order | recipient → amount → method | 0.008 | 100% |
| Send all | offered | 0.006 | 82%, else tie |
| Lock placement | slider or method option | 0 | tie |
| Unified BIP-321 receive QR | yes (quote under 2 screens) | 0.09 | 69% |
| Unverifiable offline tokens | hold aside | 0.44 | 100% |
| Tokens from known mints | claim at once | 0.18 | 100% |

The winning send family wins 98.8% of weightings,
receive 69%, else preselected Lightning. Average screens: send 1.95 (native Cashu Wallet and Macadamia
2.5, Sovran today and Zeus 2.6, cashu.me and Minibits 3.0); receive 1.8
(Macadamia 1.8, cashu.me, Cashu Wallet, Minibits and Zeus 2.1, Sovran 3.1). Receive starts with
Any amount / Set an amount / Paste a token by rule (one intent per choice);
the unconstrained best, a keypad with links, scores 1.26.

## Protocol facts the flows rely on

- **Offline send:** only ecash from held pieces (exact, rounded, or overpaid
  within the limit on a tap, since the terminal redeems online). Change,
  locking, Lightning and onchain need the mint.
- **Locking** (NUT-11) always needs the sender's mint (a swap). Offline, a
  pasted key or contact gets "lock and send later" or an unlocked shared token.
- **Offline receive:** a Cashu request with `nut10` set to our key (NUT-18)
  makes the online payer lock the token to us; with no transport it comes
  in-band (we scan theirs, or tap). We verify lock + DLEQ (NUT-12) against
  keys already saved for that mint. Unlocked or unknown-mint tokens are held
  aside, not counted. Tokens carry no keys, and a keyset id doesn't make
  foreign keys trustworthy.
- **Delivery:** a pasted request uses Nostr or HTTP, so the payer needs the
  network; a tap is in-band.
- **Send all:** all pieces at a mint, no swap, works offline; the receiver
  pays their input fee. Lightning "Max" only for payer-set amounts, found by
  quoting down (cdk `cross_mint_transfer_quote_max`).

## Unified QR and tap to pay

NUT-26 sets no preference between rails; every wallet checked prefers ecash
when a `creq` is present. Only Sovran and Cashu Wallet fall back to the
bundled invoice. Order: Cashu request → Lightning → bitcoin address.

| Check | Scanned or pasted | Tapped (NFC) |
| --- | --- | --- |
| No amount | You choose it | Refused |
| No held mint in `m` | Next rail | Next rail |
| `nut10` lock | Locked send, needs the mint | Refused (swap too slow), next rail |
| Receiver's input fee | Covered (setting) | Covered (Sovran today refuses) |
| Needs change | Mint swaps first | ~2.6 s swap vs numo's ~3 s per message |
| Offline, not exact | Needs the network to deliver | Overpay within the limit |

Lightning and onchain always need the mint and a confirmation; a tap releases
the NFC session first and never picks onchain.

## Amountless Lightning

| Rail | Receive | Send |
| --- | --- | --- |
| BOLT11 | Amount required (NUT-04/23) | Amountless needs the mint's NUT-23 `options.amountless` |
| BOLT12 | Optional, reusable (NUT-25, NUT-20) | Payer sets it when the offer has none |
| Lightning address | npub.cash, claimed into the chosen mint (`npc.ts`) | Payer sets it within LNURL limits |
| Onchain | No amount, reusable (NUT-30) | Amount required |

"Any amount" receive is npub.cash, a BOLT12 offer or an address, never a
bolt11 invoice. Sovran neither checks `options.amountless` nor sends an
amount, so these fail at every mint's quote; the concept checks first.

## Settings worth exposing

Checked against the specs and shipping wallets; everything else in the
survey (receive swaps, multi-mint payments, claiming, polling) works better
automatically.

| Setting | Why it's real | Scope |
| --- | --- | --- |
| Refuse Lightning fees above X% | The mint quotes `fee_reserve` (NUT-05); unused reserve is refunded (NUT-08); Sovran already has `maxFee` | Melts; tiny reserves (≤ 2 sats) always pass |
| Overpay offline at most X% | Offline a token can only be built from held pieces; Minibits already sends an approximate match offline (`sendOfflineApproxMatch`) | Only when no mint can make change |
| Add the receiver's claim fee to tokens I send | Claiming costs the receiver the input fee (NUT-02); cashu.me `includeFeesInSendAmount` | Shared tokens and ecash to contacts. Not a choice for payment requests: NUT-18 says the payer MUST cover it |

Mint features (amountless, BOLT12) and connectivity are demo conditions on
the concept page, not settings.

## Baselines, from the code

| App | Send | Receive |
| --- | --- | --- |
| cashu.me | method → destination → amount → pay | method → amount |
| Cashu Wallet | destination → amount (skipped when fixed) → confirm | Ecash / Bitcoin / paste → amount |
| Macadamia | one scan/paste button → amount → pay | Request / Ecash / Deposit; tokens from known mints auto-redeem |
| Minibits | Ecash or Bitcoin → destination → amount → mint → confirm | Ecash or Bitcoin → amount → mint |
| Sovran today | destination → amount → "Select option" (always) → lock sheet → confirm before a melt | hub → amount → "Select option" |
| Zeus | method → destination → amount if unset → swipe before a melt | tabs with amount; tokens need a tap |

## Caveats

- Weights are estimates; robustness tests the ranking, not numbers.
- Only cdk builds BIP-321 URIs; coco needs that for the unified receive QR.
- No library claims tokens offline; that path is a concept.
- Arming NFC pays with no review and no ceiling: a product call.
