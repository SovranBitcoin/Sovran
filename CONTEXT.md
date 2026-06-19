# Context — sovran-app glossary

Canonical domain terms for this app. Glossary only — no implementation
details, no specs. Add a term the moment it's resolved; keep entries short.

## Amount entry

**Amount tint** — the color of the large amount number on the amount-entry
surface. Encodes the _validity_ of the entered amount, **not** the transaction
direction: neutral foreground on send and receive alike, red only in a genuine
problem state. In the fiat path the typed digits take the full tint and the
unfilled decimal prefill ("00") is dimmed.

**Notice** — the transient, danger-tinted line shown directly under the amount
when the entry can't proceed (e.g. "Insufficient balance"). Derived from the
disabled-`Next` reason. The Amount tint turns red in lockstep with a Notice.

**Warning** — the persistent, warning-tinted disclaimer under the amount (e.g.
the Nut-Drop "sent over public mesh, anyone can claim" note). Distinct from a
Notice: a Warning is an always-on caveat, not a condition-driven error.

**Genuine problem state** — an amount-entry condition where input is present
but the amount cannot proceed (insufficient balance, out of range, or it
**exceeds the spendable balance**). Surfaced as a Notice and/or an
`exceedsBalance` signal from the payment engine, and mirrored by a red Amount
tint. Distinct from merely-incomplete input (empty field), which stays a
neutral placeholder.

**exceedsBalance** — an amount-entry signal from colada: the entered amount is
larger than the spendable balance. Needed because an over-balance ecash send
still resolves (it rounds down to the balance) and so produces no blocking
Notice — only lightning, which can't round down, would otherwise reveal the
shortfall. Drives the red Amount tint independently of a Notice.
