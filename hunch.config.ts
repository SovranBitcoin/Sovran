import { choice, defineConfig } from "@kelbie/hunch";

// Semantic candidates for recurring PR review; validate each flag in source.
// Every in-scope window receives the explicit concerns below.
// Selected skills and contributor conventions also compile into hunch.lock.
const outcomes = {
  "preserved": "The relevant behavior visibly preserves the contract, including an explicitly allowed fallback or exception.",
  "unrelated": "The changed lines do not add, remove or alter the mechanism this question asks about. Mere shared vocabulary or possible unseen callers do not make a change relevant. Tests constructing the bad case are not violations.",
  "insufficient-context": "The changed lines directly alter the mechanism this question asks about, and a specific missing contract, guard or other fact is necessary to classify that change. Missing context for an unchanged mechanism is unrelated, not this option. Do not infer safety or a defect."
};

export default defineConfig({
  provider: "gateway",
  // Public repository; preserve the existing explicit non-ZDR routing decision.
  zeroDataRetention: false,
  include: ["**/*.{ts,tsx,js,jsx,mjs,cjs,swift,kt,java,cpp,h,mm,rs}"],
  ignore: ["hunch.config.ts", "**/dist/**", "**/build/**", "**/vendor/**", "**/BitChatVendor/**", "**/generated/**"],
  skills: ["./.agents/skills/codebase-design", "./.agents/skills/expo-router"],
  agentsMd: true,
  docs: ["docs/review/contributor-conventions.md"],
  failOnError: false,
  task: "pr",
  // Experimental attribution remains off until independently labeled evaluation supports it.
  review: { contextLines: 40, chunkLines: 150, overlapLines: 0, localize: false },
  // Whole-repository dry run: 4,460 chunks; explicit and compiled rules use separate requests.
  budget: { maxHunks: 5000, maxRulesPerHunk: 128, maxRequests: 10000, concurrency: 4, timeoutSeconds: 3600 },
  rules: {
    "ui/header-continuity": ["warn", choice({
      instructions: "Does this change visibly break the shared header contract: a page identity is duplicated or lost during its scroll handoff, header actions or content are obscured by incorrect inset ownership, a section selector becomes unreachable while scrolling its content, a fixed inset around a scrolling viewport prevents content from ever entering its gradient header, an opaque strip defeats the combined header/tab gradient, or identity handoff activates before the measured identity section clears navigation? Judge the visible layout and scroll ownership together, on iOS and Android; an isolated use of a header API without evidence of a broken behavior is unrelated.",
      criteria: { concern: "The changed layout or scroll wiring visibly causes one of these continuity or reachability failures.", ...outcomes },
      files: ["app/**/*.tsx"],
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/header-contract.md",
      message: "Header identity, content clearance, or pinned section navigation may lose continuity.",
    })],
    "ui/header-scroll-work": ["warn", choice({
      instructions: "Does header-only visual animation visibly cause page-wide React rerenders or repeated navigator updates during scrolling or identity handoff? Follow state ownership and its consumers; identify actual state writes, not speculative memoization opportunities. A shared UI-thread animation, an isolated development probe, or necessary list/media offset bookkeeping is allowed. Native smoothness cannot be proven from code alone.",
      criteria: { concern: "Scroll or handoff callbacks write header-only visual state into the owning page or repeatedly rebuild navigator options, rerendering content unrelated to that animation.", ...outcomes },
      files: ["app/**/*.tsx"],
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/header-contract.md",
      message: "Header-only animation may force unrelated page or navigator work.",
    })],
    "secrets/recovery-after-read-failure": ["warn", choice({
      instructions: "Does this change make a locked, failed or invalid secure-storage read lead to generating or overwriting recovery material rather than requiring confirmed absence? A write without a changed read-failure or initialization path is unrelated.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A secure-storage failure may replace existing recovery material.",
    })],
    "secrets/disclosure": ["warn", choice({
      instructions: "Given a visible secret/private value and sink, does this change expose secret or bearer wallet material or decrypted private messages to a visible unauthorized recipient, log, analytics sink, public payload or unencrypted persistent store? Exclude deliberate authorized backup/export and correctly encrypted storage or recipient transfer. A status-only change with no secret-bearing value or changed payload/storage path is unrelated.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Secret or private material may reach an unauthorized sink or plaintext persistent store.",
    })],
    "payments/uncertain-outcome": ["warn", choice({
      instructions: "Does this change turn an uncertain payment outcome into confirmed success or definitive failure without visible reconciliation evidence?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "An uncertain payment outcome may be recorded as final.",
    })],
    "payments/repeated-effect": ["warn", choice({
      instructions: "Consider only a payment/spend effect, not relay publication or ordinary repeated I/O. Does this change allow the same intended payment effect to execute again on retry or concurrent re-entry without a visible identity, deduplication or state guard? A change to status/error representation without a changed retry, effect initiation or re-entry path is unrelated. Require a visible repeat path; absence of an unseen guard is not evidence.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Retry or re-entry may repeat a payment effect.",
    })],
    "payments/cancellation-state": ["warn", choice({
      instructions: "Require a changed cancellation, rollback or proof-release path; an error-to-success status conversion alone is unrelated to this specific question. Does this change release spendable proofs, erase reconciliation evidence or claim rollback after an effect may already have committed, based only on cancellation or a local failure?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Cancellation may discard committed or uncertain payment state.",
    })],
    "payments/request-constraints": ["warn", choice({
      instructions: "Does this change drop or bypass an applicable validated amount, unit, mint or locking constraint on a visible path from payment request to execution?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Payment execution may lose a validated request constraint.",
    })],
    "state/stale-owner": ["warn", choice({
      instructions: "Does this change let a stale async result mutate state after a profile, wallet or mint switch or superseding flow/request generation? A status-only change with no changed identity/generation guard or asynchronous state write is unrelated. Require visible invalidated ownership; do not discard committed payment work just because preparation was superseded.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A stale async result may update a different owner or superseding flow.",
    })],
    "state/persisted-compatibility": ["warn", choice({
      instructions: "Does a schema, decoder or migration change make previously persisted user data invalid without tolerant decoding or migration, causing a value or store to reset? A read/write with no schema or decoding change is unrelated. Require evidence that the changed schema is persisted; use insufficient-context only when a relevant schema change needs missing compatibility evidence.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A persisted schema change may reset existing user data.",
    })],
    "state/authority-read-failure": ["warn", choice({
      instructions: "Does this change treat a failed or invalid durable wallet-authority read as an empty first-run store, allowing existing authority to be replaced? Exclude ephemeral cache defaults. Writes without a changed read-failure or initialization path are unrelated.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A durable-state read failure may replace existing wallet authority.",
    })],
    "nostr/retry-identity": ["warn", choice({
      instructions: "Does this change re-sign or alter an already signed event during a retry of the same publication, creating another event identity?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A publication retry may create a different signed event.",
    })],
    "nostr/delivery-claim": ["warn", choice({
      instructions: "Does this change claim recipient receipt or guaranteed delivery from only local queueing or a relay acknowledgment? Local optimistic publication success after the first relay OK is explicitly allowed.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Publication acknowledgment may be mistaken for recipient delivery.",
    })],
    "money/amount-meaning": ["warn", choice({
      instructions: "Require a changed amount value, conversion or numeric default; a payment status change without an amount change is unrelated. Does this change alter an executed or persisted monetary amount by losing its unit, precision or unknown-versus-zero meaning? Exclude display-only rounding with preserved execution values.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A monetary conversion or default may change the amount actually used.",
    })],
    // Not a lint rule: the tint and the icon are greppable, but deciding
    // whether a given tinted row is a status notice — rather than an empty
    // state, a badge or a field error — is a judgment about the rendered
    // shape. `when` keeps the rule off hunks with no icon or status tint at
    // all; every hand-built notice this rule exists to catch carries one.
    "ui/status-notice": ["warn", choice({
      instructions: "Require changed JSX that renders a status notice: a short warning, error, caution or informational message next to a status icon, on its own tinted or bordered surface, within a page, card or sheet. Does this change build that surface out of primitives — a View, Card, HStack, Icon and Text, or a status tint such as `bg-warning-soft`, `bg-danger-soft`, `bg-danger/[0.08]`, `withAlpha(dangerColor, …)` or a literal amber or red hex — where the shared `Notice` in `app/shared/ui/composed/Notice.tsx` would render it? Judge the rendered shape, not the vocabulary. A full-screen error or empty state, a screen-wide chrome banner, an interactive call-to-action card, a badge or pill carrying no status sentence, per-field validation text under an input, and bare tinted copy with no surface of its own are different shapes, not notices. A small named component whose body is a `Notice` at one surface's geometry is the intended pattern; so are `Notice`'s own implementation and the design-system catalogue screens under `app/features/settings`.",
      criteria: { concern: "The changed JSX hand-builds a status notice that `Notice` — with its `status`, `tone`, `size`, `icon` and `action` props — already renders.", ...outcomes },
      files: ["app/**/*.tsx"],
      when: /Icon|warning|danger|caution|alert/i,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A status notice may be hand-built instead of using the shared Notice component.",
    })],
  },
});
