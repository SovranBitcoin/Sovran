"""Does the winning order survive different assumptions?

bruteforce.py ranks designs under one set of guessed weights: how often each
task happens and how likely each context is (online, mint features, ...).
This script walks every design × task × context once, then re-scores all
designs under thousands of randomly perturbed weights and reports how often
each design family comes out on top.

A design family ignores choices the model scores identically (ties), so the
question answered is "does this *shape* of flow keep winning?".

Run:  python3 docs/research/payment-flows/robustness.py [samples]
Writes: docs/research/payment-flows/robustness.md
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from bruteforce import (  # noqa: E402
    BASE_P,
    FLAGS,
    RECEIVE,
    SEND,
    all_receive_designs,
    all_send_designs,
    contexts,
    walk_receive,
    walk_send,
)

RNG = np.random.default_rng(21)


def matrix(designs, tasks, ctxs, walk):
    """cost[d, t, c] = steps + dead-end steps for one walk."""
    cost = np.zeros((len(designs), len(tasks), len(ctxs)), dtype=np.float32)
    for i, d in enumerate(designs):
        for j, t in enumerate(tasks):
            for k, c in enumerate(ctxs):
                w = walk(d, t, c)
                cost[i, j, k] = w.steps + w.dead_end + (10.0 if w.unsafe else 0.0) + (0.0 if w.completed else 3.0)
    return cost


def ctx_flags(ctxs):
    return np.array([[getattr(c, f) for f in FLAGS] for c in ctxs], dtype=bool)


def ctx_weights(flags: np.ndarray, P: dict[str, float]) -> np.ndarray:
    w = np.ones(len(flags))
    online = flags[:, FLAGS.index("online")]
    for i, f in enumerate(FLAGS):
        p = P[f]
        col = np.where(flags[:, i], p, 1 - p)
        if f == "mint_up":
            col = np.where(online, col, 1.0)  # mint reachability only matters online
        w *= col
    return w / w.sum()


def perturb_p() -> dict[str, float]:
    # Each probability moves anywhere within ±50% of its odds, clipped to (0.02, 0.98).
    out = {}
    for k, p in BASE_P.items():
        odds = p / (1 - p) * np.exp(RNG.uniform(np.log(0.33), np.log(3.0)))
        out[k] = float(np.clip(odds / (1 + odds), 0.02, 0.98))
    return out


def perturb_tasks(tasks) -> np.ndarray:
    base = np.array([t.weight for t in tasks])
    return RNG.dirichlet(base / base.sum() * 12)  # task mix varies widely around the guess


def family(name: str) -> str:
    # Drop choices that never change a score in the model (ties) so families are comparable.
    parts = [p for p in name.split(" · ") if not p.startswith("lock=") and not p.startswith("skip=")]
    return " · ".join(parts)


SEND_DIMS = ("order", "confirm", "amount_chips", "send_all", "nfc_arm", "nfc_review", "nfc_overpay", "unreachable", "auto_skip")
RECV_DIMS = ("start", "claim", "offline_unverified", "bip321")


def run(kind: str, designs, tasks, walk, samples: int, keep=lambda d: True, dims=()):
    ctxs = contexts()
    flags = ctx_flags(ctxs)
    cost = matrix(designs, tasks, ctxs, walk)
    allowed = np.array([keep(d) for d in designs])
    names = [family(d.name()) for d in designs]
    wins: Counter[str] = Counter()
    margins = []
    samples_scores = []
    for _ in range(samples):
        cw = ctx_weights(flags, perturb_p())
        tw = perturb_tasks(tasks)
        score = np.einsum("dtc,t,c->d", cost, tw, cw)
        score = np.where(allowed, score, np.inf)
        order = np.argsort(score)
        best = order[0]
        wins[names[best]] += 1
        # how far the best *other* family trails
        other = next(i for i in order if names[i] != names[best])
        margins.append(score[other] - score[best])
        samples_scores.append(score)
    base_score = np.einsum("dtc,t,c->d", cost, np.array([t.weight for t in tasks]) / sum(t.weight for t in tasks),
                           np.array([c.weight for c in ctxs]))
    base_score = np.where(allowed, base_score, np.inf)
    winner = designs[int(np.argmin(base_score))]
    base_best = family(winner.name())
    # Per decision: the best design that answers it differently, sample by sample.
    ablation = []
    S = np.array(samples_scores)  # samples × designs
    win_idx = int(np.argmin(base_score))
    for dim in dims:
        value = getattr(winner, dim)
        alt = np.array([allowed[i] and getattr(d, dim) != value for i, d in enumerate(designs)])
        if not alt.any():
            continue
        best_alt = np.where(alt[None, :], S, np.inf).min(axis=1)
        lead = best_alt - S[:, win_idx]
        base_lead = float(np.where(alt, base_score, np.inf).min() - base_score[win_idx])
        ablation.append((dim, value, base_lead, float((lead > 1e-9).mean()), float((lead >= -1e-9).mean()), float(np.median(lead))))
    return base_best, wins, np.array(margins), ablation


def main() -> None:
    samples = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    out = ["# Robustness of the winning flow", "",
           f"{samples} samples. Each sample moves every context probability within a factor of 3 in "
           "odds and redraws the task mix from a Dirichlet around the guessed weights. "
           "Families ignore choices the model scores identically (lock placement, skipping).", ""]
    for kind, designs, tasks, walk, keep in (
        ("Send", all_send_designs(), SEND, walk_send, lambda d: True),
        ("Receive", all_receive_designs(), RECEIVE, walk_receive, lambda d: d.sensible()),
    ):
        base_best, wins, margins, ablation = run(kind, designs, tasks, walk, samples, keep,
                                                  SEND_DIMS if kind == "Send" else RECV_DIMS)
        share = wins[base_best] / samples
        out += [f"## {kind}", "",
                f"Winner under the guessed weights: `{base_best}`", "",
                f"It is also the best family in **{share:.1%}** of samples. "
                f"Median lead over the runner-up family: {np.median(margins):.3f} screens.", "",
                "| Family | Samples won |", "| --- | --- |"]
        for name, n in wins.most_common(6):
            out.append(f"| `{name}` | {n / samples:.1%} |")
        out += ["", f"### {kind}: each decision against its best alternative", "",
                "Lead = screens the best design with a different answer costs over the winner. "
                "'Strictly better' excludes ties; 'never worse' includes them.", "",
                "| Decision | Winning answer | Lead (guessed weights) | Strictly better | Never worse | Median lead |",
                "| --- | --- | --- | --- | --- | --- |"]
        for dim, value, base_lead, better, not_worse, med in ablation:
            v = " → ".join(value) if isinstance(value, tuple) else value
            out.append(f"| {dim} | {v} | {base_lead:.3f} | {better:.0%} | {not_worse:.0%} | {med:.3f} |")
        out.append("")
    text = "\n".join(out) + "\n"
    Path(__file__).with_name("robustness.md").write_text(text)
    print(text)


if __name__ == "__main__":
    main()
