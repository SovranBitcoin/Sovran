# Context — sovran-app glossary

Canonical domain terms for this app. Glossary only — no implementation
details, no specs. Add a term the moment it's resolved; keep entries short.

## Amount entry

**Amount tint** — the color of the large amount number on the amount-entry
surface. Encodes the _validity_ of the entered amount (plus a positive
affordance on the receive flow), **not** the transaction direction. A valid
amount is neutral; only a genuine problem state is red.

**Notice** — the transient, danger-tinted line shown directly under the amount
when the entry can't proceed (e.g. "Insufficient balance"). Derived from the
disabled-`Next` reason. The Amount tint turns red in lockstep with a Notice.

**Warning** — the persistent, warning-tinted disclaimer under the amount (e.g.
the Nut-Drop "sent over public mesh, anyone can claim" note). Distinct from a
Notice: a Warning is an always-on caveat, not a condition-driven error.

**Genuine problem state** — an amount-entry condition where input is present
but the amount cannot proceed (insufficient balance, out of range). Surfaced as
a Notice and mirrored by a red Amount tint. Distinct from merely-incomplete
input (empty field), which stays a neutral placeholder.
