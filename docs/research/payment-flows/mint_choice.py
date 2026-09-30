"""Challenge the mint-choice assumptions behind the concept page.

The page never asks which mint to pay from. It orders mints reachable-first
and moves to the next mint when one fails (LOOP_NOTES pass 5). That rests on
assumptions nobody has measured:

  A1  Reachability is known before the user picks an option. It may be stale:
      the wallet thinks a mint is up when it's down, or the reverse.
  A2  A failure is usually one mint's problem (no route, rejected swap), so
      the next mint is likely to work.
  A3  Users who meet an error retry the same doomed mint rather than open
      a mint picker.
  A4  Ecash from an unreachable mint, delivered over Nostr, is a bad outcome
      because the receiver can't claim it (NUT-03: settled only by their swap).

This script simulates random wallets and payments under four policies and
sweeps each assumption to see where "auto, reachable-first" stops winning.
All rates are guesses; the question is where the ranking flips, not the numbers.

Policies
  auto_reach   no question; try mints reachable-first, next on failure (the concept)
  auto_order   no question; try mints in the user's order, next on failure
  default_pick use the default mint; on failure show the error, and the user
               either retries the same mint or opens the picker (Sovran today)
  ask_first    always ask which mint (one screen), then as default_pick

Score per payment: screens the user acts on beyond the happy path, plus
3 for a payment left unmade and 5 for ecash sent that the receiver can't
claim yet (the same weights spirit as bruteforce.py: an unmade payment costs
more than a screen; unclaimable ecash costs more than an unmade payment
because the sender's funds sit pending and the receiver sees nothing).

Run:  python3 docs/research/payment-flows/mint_choice.py
Writes: docs/research/payment-flows/mint_choice.md
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from pathlib import Path

UNMADE, UNCLAIMABLE = 3.0, 5.0
POLICIES = ("auto_reach", "auto_order", "default_pick", "ask_first")


@dataclass
class World:
    down: float = 0.08  # chance a given mint isn't responding
    stale: float = 0.10  # chance the wallet's view of a mint's reachability is wrong (A1)
    fail: float = 0.06  # chance a reachable mint fails this payment (no route, rejection) (A2)
    correlated: float = 0.0  # chance a failure is the payment's fault, so every mint fails (A2)
    retry_same: float = 0.5  # chance a user retries the same mint after an error (A3)
    ecash_share: float = 0.5  # share of payments that are ecash to a Cashu request / contact
    samples: int = 20000


def payment(rng: random.Random, w: World):
    n = rng.choice((2, 3, 4, 5))
    mints = []
    for i in range(n):
        up = rng.random() > w.down
        seen_up = up if rng.random() > w.stale else not up
        mints.append({"up": up, "seen_up": seen_up, "funded": rng.random() < (0.9 if i == 0 else 0.6)})
    ecash = rng.random() < w.ecash_share
    # A Cashu request or contact accepts a subset of mints (NUT-18 `m`, NIP-61).
    accepted = [m for m in mints if rng.random() < 0.6] if ecash else mints
    doomed = rng.random() < w.correlated  # the payment itself can't succeed anywhere
    return mints, accepted, ecash, doomed


def attempt(rng, m, ecash, doomed, w):
    """One try at one mint: 'ok', 'fail', or 'unclaimable'."""
    if not m["up"]:
        # Offline mint: ecash from held pieces can still leave over Nostr, unclaimed (A4).
        return "unclaimable" if ecash else "fail"
    if doomed or rng.random() < w.fail:
        return "fail"
    return "ok"


def run(policy: str, w: World, seed: int = 7) -> dict:
    rng = random.Random(seed)
    tot = {"score": 0.0, "screens": 0.0, "unmade": 0, "unclaimable": 0}
    for _ in range(w.samples):
        mints, accepted, ecash, doomed = payment(rng, w)
        usable = [m for m in accepted if m["funded"]]
        screens, outcome = 0.0, "fail"
        if not usable:
            outcome = "none"
        elif policy.startswith("auto"):
            order = sorted(usable, key=lambda m: not m["seen_up"]) if policy == "auto_reach" else usable
            # auto_reach tries every mint it thinks is up first; one it believes
            # is down comes last, as a labelled last resort.
            for m in order:
                outcome = attempt(rng, m, ecash, doomed, w)
                if outcome != "fail":
                    break
        else:
            if policy == "ask_first":
                screens += 1
                pick = next((m for m in usable if m["seen_up"]), usable[0])  # the user picks one that looks up
            else:
                pick = usable[0]
            tried = set()
            for _ in range(4):  # a user gives up after a few tries
                outcome = attempt(rng, pick, ecash, doomed, w)
                tried.add(id(pick))
                if outcome != "fail":
                    break
                screens += 1  # the error screen
                if rng.random() < w.retry_same:
                    continue  # same mint again (A3)
                rest = [m for m in usable if id(m) not in tried]
                if not rest:
                    break
                screens += 1  # open the picker and choose
                pick = rest[0]
        tot["screens"] += screens
        if outcome in ("fail", "none"):
            tot["unmade"] += 1
            tot["score"] += screens + UNMADE
        elif outcome == "unclaimable":
            tot["unclaimable"] += 1
            tot["score"] += screens + UNCLAIMABLE
        else:
            tot["score"] += screens
    n = w.samples
    return {k: v / n for k, v in tot.items()}


def table(title: str, param: str, values, base: World) -> list[str]:
    out = [f"### {title}", "", f"| {param} | " + " | ".join(POLICIES) + " | best |", "| --- | " + "--- | " * (len(POLICIES) + 1)]
    for v in values:
        w = World(**{**base.__dict__, param: v})
        scores = {p: run(p, w)["score"] for p in POLICIES}
        best = min(scores, key=scores.get)
        out.append(f"| {v} | " + " | ".join(f"{scores[p]:.3f}" for p in POLICIES) + f" | {best} |")
    return out + [""]


def main() -> None:
    base = World()
    lines = [
        "# Mint choice: challenging the assumptions",
        "",
        "Generated by `mint_choice.py`. Lower score is better: extra screens, + 3 per unmade",
        "payment, + 5 per ecash the receiver can't claim yet. Rates are guesses; look for where",
        "the best policy changes.",
        "",
        "## Baseline",
        "",
        "| Policy | Score | Extra screens | Unmade | Unclaimable |",
        "| --- | --- | --- | --- | --- |",
    ]
    for p in POLICIES:
        r = run(p, base)
        lines.append(f"| {p} | {r['score']:.3f} | {r['screens']:.3f} | {r['unmade']:.1%} | {r['unclaimable']:.1%} |")
    lines += ["", "## Sweeps", ""]
    lines += table("A1: stale reachability", "stale", (0.0, 0.1, 0.3, 0.5), base)
    lines += table("A2: failures that are the payment's fault (every mint fails)", "correlated", (0.0, 0.3, 0.6, 0.9), base)
    lines += table("A2: per-mint failure rate", "fail", (0.01, 0.06, 0.2, 0.4), base)
    lines += table("A3: users who retry the same mint", "retry_same", (0.0, 0.5, 0.9), base)
    lines += table("A4: mints not responding", "down", (0.0, 0.08, 0.25, 0.5), base)
    Path(__file__).with_name("mint_choice.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
