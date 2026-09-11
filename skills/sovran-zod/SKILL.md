---
name: sovran-zod
description: Review or change Zod schemas in Sovran, especially persisted fields, enum tolerance, protocol IDs, route inputs, and wire-to-domain parsing. Use before tightening accepted data or changing serialization.
---

Read [SYSTEM.md decision 13](../../SYSTEM.md#13-zod-persistence-and-migrations),
then the actual schema, producer, parsing boundary, and consumers. The installed
version in the root manifest/lockfile is authoritative; current online docs may
describe a newer minor release.

For the proposed change, identify:

- The accepted input, parsed output, unknown-key policy, and meaning of absent,
  null, invalid, empty, and zero values. Use `z.input` and `z.output` when transforms
  make these different; do not force a handwritten type onto an unchecked value.
- Whether any persisted projection embeds this schema, including indirect schema
  imports. Follow the migration/tolerance rule in SYSTEM.md before editing.
- Whether parsing supplies structural validity only or must establish additional
  protocol provenance, amount bounds, or authorization at another owner.
- The existing shared schema/brand to reuse. Read
  [protocolIds](../../app/shared/lib/protocolIds.ts) before adding key/ID regexes.

Use explicit boundary failures. Route user-visible validation through the shared
error/message policy, keeping raw issues for redacted diagnostics. A `.catch`
that invents valid money, consent, or attribution is not resilience. Avoid
unbounded coercion as a shortcut to parsing payment input.

Verify meaningful acceptance changes with old supported values and malformed
inputs, including unrelated persisted preferences surviving hydration. Keep
schemas outside render and hot loops. Do not install form libraries or migrate
syntax just because a generic Zod example does.

References: [Zod API](https://zod.dev/api),
[migration guidance](https://zod.dev/v4/changelog).
This is a project-authored workflow, not the third-party `zod-4` tutorial.
