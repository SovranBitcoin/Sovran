---
name: sovran-app-copy
description: Write or review Sovran in-app labels, errors, permissions, onboarding, empty/loading states, translations, and constrained text. Use for UX microcopy and truncation decisions; not marketing or App Store claims.
license: Apache-2.0
---

Read [SYSTEM.md decision 9](../../SYSTEM.md#9-localization-and-text-length-contracts)
and its truncation policy, plus [errors](../../SYSTEM.md#8-error-handling-and-user-feedback)
and [terminology](../../SYSTEM.md#27-naming-terminology-and-display-derivation)
where relevant. Inspect the whole interaction and actual state transition before
rewriting an isolated label.

For each message, identify the fact the user needs, available action, consequence,
and supporting detail. Remove repetition between title, body, helper, and button.
Name actions by outcome, not gestures or implementation. Keep labels persistent;
placeholders are examples, not replacements for labels.

For errors, say what failed and how to recover only as far as the original
structured result establishes. Preserve uncertainty: a timeout does not prove a
payment failed, and relay acceptance does not prove delivery. Keep wallet terms
consistent, and never introduce a stronger security, privacy, or settlement claim
to make copy more reassuring. Use the shared error catalog.

For constrained surfaces, choose the content policy from SYSTEM.md: full/short
message variant, wrapping, tail/middle/head abbreviation, or full-detail view.
Do not shorten a safety instruction by cutting characters. Keep full machine
values separate from labels and never copy/submit an ellipsized string.

Write complete messages with typed parameters. Check plural forms, reordered
variables, emoji/graphemes, RTL mixed with identifiers, long names, and large text.
Use native layout evidence rather than an English character count as proof of fit.
Respect the same privacy policy in accessible labels and visible text.

For a copy-only proposal, return before/after text with the source state, reason,
and layout variant where needed. For an authorized implementation, update the
owning message/consumer and validate the relevant flow; do not stop at a proposal.

Adapted from Impeccable's `clarify` and `operate` references; exact source revision
and modifications are recorded in [sources.json](../sources.json). Adaptation:
native verification, shared Sovran errors/terminology, no launcher, no additional
design documents, and no automatic polish or external publishing step.
