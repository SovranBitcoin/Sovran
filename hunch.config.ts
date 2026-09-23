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
  // Published specification packs, installed into hunch.lock by `hunch install`
  // and reviewed there like any other rule. Selection principle: a pack rule is
  // kept only where this repository makes the decision the rule is about. Cashu's
  // cryptography and wire format belong to @cashu/cashu-ts and coco, and Nostr's
  // to nostr-tools and NDK; asking about those would review code we do not ship.
  // 115 of the 1,011 published rules survive that test.
  packs: [
    // ── Bitcoin BIPs ────────────────────────────────────────────────────
    // Only the wallet-level BIPs this app implements itself. It never builds a
    // script, signs a transaction or encodes an address: on-chain deposit
    // addresses come from the mint and are only displayed, so the address,
    // segwit, taproot, PSBT and descriptor families are not selected.
    //
    // bip39 + bip32: `app/shared/lib/nostr/keyDerivation.ts`,
    //   `wallet/src/wallet-seed.ts`, `features/backup/**` and
    //   `profile/keyRecovery.ts` own mnemonic generation, validation and the
    //   seed. @scure/bip39 and @scure/bip32 own the PBKDF2, the checksum bits
    //   and the HMAC/ser256 arithmetic, so those rules are left out; what is
    //   ours is which value is fed in and whether an imported phrase is
    //   checked. `seed-is-not-entropy` is the sharpest of them here, because
    //   `deriveCashuMnemonic` deliberately turns a derived private key back
    //   into entropy in the same file that also derives a seed.
    // bip43: our paths are `m/44'/1237'` (NIP-06) and `m/44'/129372'` (Cashu);
    //   the purpose level must stay hardened. `bip44/*` is not selected: the
    //   Cashu path adds a fourth hardened level and the coin type is not
    //   Bitcoin's, so BIP-44's five-level shape and `coin_type 0'/1'` would
    //   flag a deliberate scheme.
    // bip321: `wallet/src/bip321.ts`, `wallet/src/normalize.ts`,
    //   `wallet/src/detectors.ts` and the receive rails parse and build these
    //   URIs. `pop`/`req-pop` is not implemented, so those two are left out
    //   until it is.
    { pack: "bips-spec", rules: [
      "bip39/checksum-not-verified",
      "bip39/seed-is-not-entropy",
      "bip39/entropy-size",
      "bip39/wordlist-mismatch",
      "bip39/user-supplied-sentence",
      "bip32/hardened-boundary",
      "bip32/seed-length",
      "bip43/purpose-hardened",
      "bip321/req-prefix-unknown",
      "bip321/amount-is-decimal-btc",
      "bip321/user-authorisation",
      "bip321/case-insensitive-keys",
      "bip321/duplicate-keys",
      "bip321/empty-address-body",
      "bip321/address-is-one-time",
      "bip21/superseded-by-321",
    ] },
    // ── Nostr NIPs ──────────────────────────────────────────────────────
    // nostr-tools and NDK own the primitives, so the rules about them are not
    // selected: event id serialization, the Schnorr signature, NIP-44's
    // ChaCha20 and HKDF, NIP-19's bech32 and TLV encoding, NIP-05 resolution
    // (no `.well-known/nostr.json` fetch exists in this repo) and NIP-42 relay
    // AUTH (NDK answers the challenge). Relay-side obligations are left out
    // for the same reason: we are a client and a signer, not a relay.
    //
    // What remains is the layer this app writes:
    // nip46: `app/features/nostrSigner/**` is a remote signer, so all eleven
    //   apply — the request/response shape, the connect secret, per-method and
    //   per-kind grants, and that client metadata is never authorization.
    // nip17 + nip59: the DM envelope, thread history and the NUT-18 nostr
    //   transport unwrap gift wraps and seals themselves.
    //   `seal-pubkey-matches-rumor` is the impersonation check.
    // nip60 + nip61: the Cashu wallet and nutzap kinds are this app's own
    //   integration of the two protocols, not something coco or nostr-tools
    //   decides — which mint, which lock key, what stays unencrypted.
    // nip01: `nostr/src/**` is our own relay layer, with 53 places that build
    //   filters and subscriptions, so the filter, limit, EOSE, subscription-id
    //   and replaceable-storage rules are about our code.
    //   `verify-against-event-pubkey` is the one signature rule kept, because
    //   `app/shared/lib/nostr/moderation.ts` does that check by hand.
    // nip04: `app/shared/lib/nostr/nip04.ts` is the legacy path; the mention-
    //   tag leak and the deprecation notice are ours, the ECDH is not.
    // nip06 + nip19 + nip65: the derivation path, keeping bech32 identifiers
    //   off the wire, and read/write relay direction.
    { pack: "nips-spec", rules: [
      "nip01/verify-against-event-pubkey",
      "nip01/kind-range-classification",
      "nip01/replaceable-storage-key",
      "nip01/replaceable-tie-break",
      "nip01/subscription-id-constraints",
      "nip01/req-replaces-subscription",
      "nip01/event-message-subscription-id",
      "nip01/filter-list-semantics",
      "nip01/tag-filter-intersection",
      "nip01/since-until-inclusive",
      "nip01/limit-initial-query-only",
      "nip01/limit-zero",
      "nip01/eose-after-stored",
      "nip01/single-connection-per-relay",
      "nip01/a-tag-coordinate",
      "nip04/deprecated-prefer-nip17",
      "nip04/no-mention-tagging-in-dms",
      "nip04/leaks-metadata",
      "nip06/derivation-path",
      "nip17/seal-pubkey-matches-rumor",
      "nip17/chat-content-plain-text",
      "nip17/room-identity",
      "nip17/subject-latest-wins",
      "nip17/publish-to-recipient-dm-relays",
      "nip17/dm-relay-list-shape",
      "nip17/file-message-shape",
      "nip17/expiration-on-both-layers",
      "nip19/bech32-not-on-the-wire",
      "nip19/length-limit",
      "nip46/request-event-shape",
      "nip46/rpc-message-shape",
      "nip46/distinguish-signer-and-user-pubkey",
      "nip46/nostrconnect-secret-validated",
      "nip46/bunker-secret-single-use",
      "nip46/client-metadata-not-authorization",
      "nip46/unknown-method-errors",
      "nip46/auth-url-challenge",
      "nip46/switch-relays",
      "nip46/logout-not-a-boundary",
      "nip46/client-keypair-disposable",
      "nip59/rumor-unsigned",
      "nip59/rumor-keeps-id",
      "nip59/seal-kind-and-empty-tags",
      "nip59/seal-signed-by-real-author",
      "nip59/wrap-ephemeral-key-per-message",
      "nip59/wrap-kind-and-p-tag",
      "nip59/wrap-encrypted-to-recipient-with-wrapper-key",
      "nip59/one-wrap-per-recipient",
      "nip59/timestamps-tweaked-and-past",
      "nip59/broadcast-selectively",
      "nip60/wallet-privkey-is-separate",
      "nip60/proofs-encrypted",
      "nip60/rollover-on-spend",
      "nip60/history-markers",
      "nip60/wallet-relay-discovery",
      "nip60/quote-event-expiration",
      "nip61/p2pk-to-declared-pubkey",
      "nip61/p2pk-key-prefix",
      "nip61/mint-must-be-declared",
      "nip61/nutzap-verification",
      "nip61/redemption-recorded-once",
      "nip61/filter-by-declared-mints",
      "nip65/relay-list-shape",
      "nip65/read-write-direction",
      "nip65/publish-relay-list-alongside",
    ] },
    // ── Cashu NUTs ──────────────────────────────────────────────────────
    // cashu-ts and coco implement the protocol: BDHKE, keysets, swap and melt,
    // token serialization, deterministic secrets and the P2PK signing itself.
    // Selecting those rules would review libraries we do not ship. What is
    // ours is the orchestration around them, and it is where the money is:
    //
    // nut12: `app/shared/lib/cashu/offlineReceiveDleq.ts` decides that an
    //   offline receive verifies the DLEQ before accepting ecash, and that a
    //   local verification failure is not a retryable transport failure.
    // nut18: `app/shared/lib/nutCreq.ts` builds and parses standing payment
    //   requests directly against cashu-ts because coco does not, and
    //   `paymentRequestNostrTransport.ts` is our own transport.
    // nut11 + nut10: `protocolIds.ts`, `nutCreq.ts` and the p2pk-import plugin
    //   choose the lock key, its `02` prefix and its locktime. The SIG_ALL
    //   message construction and threshold counting stay with cashu-ts.
    // nut06: `mintNuts.ts` reads what a mint supports before relying on it.
    // errors: AGENTS.md already forbids publishing raw error bodies; this is
    //   the same rule asked of mint responses.
    { pack: "nuts-spec", rules: [
      "nut06/nuts-settings-consulted",
      "nut06/feature-setting-shape",
      "nut06/max-array-length-batching",
      "nut06/motd-displayed",
      "nut10/unsupported-kind-is-anyone-can-spend",
      "nut10/secret-parsed-not-assumed",
      "nut10/conditions-are-per-proof",
      "nut10/tag-values-cast",
      "nut11/pubkey-compressed",
      "nut11/keys-compared-by-x-coordinate",
      "nut11/locktime-boundary",
      "nut11/locktime-permanent",
      "nut11/expired-without-refund-is-open",
      "nut11/tag-appears-once",
      "nut11/n-sigs-bounds",
      "nut12/wallet-verifies-mint-dleq",
      "nut12/wallet-verifies-received-dleq",
      "nut12/proof-dleq-includes-r",
      "nut12/strip-dleq-before-mint",
      "nut18/payment-request-fields",
      "nut18/unit-required-with-amount",
      "nut18/mint-list-strict-default",
      "nut18/supported-methods-constraint",
      "nut18/per-method-fee-scope",
      "nut18/amount-is-net-of-input-fees",
      "nut18/nut10-option-shape",
      "nut18/payee-validates-incoming-token",
      "nut18/transport-shape-and-preference",
      "nut18/empty-transport-is-in-band",
      "nut18/nostr-transport",
      "nut18/payment-payload-shape",
      "nut18/single-use-honoured",
      "errors/no-raw-error-leakage",
      "errors/codes-used-as-specified",
    ] },
  ],
  // Vetted against the installed library versions and the contributor
  // conventions before selection (.agents/skills/sources.json). Compiled rules
  // that contradict a house convention are switched off by id below.
  skills: [
    "./.agents/skills/codebase-design",
    "./.agents/skills/expo-router",
    "./.agents/skills/expo-animation",
    "./.agents/skills/typescript-best-practices",
    "./.agents/skills/principle-type-system-discipline",
    "./.agents/skills/principle-model-the-domain",
    "./.agents/skills/react-native-testing",
  ],
  agentsMd: true,
  docs: [
    "docs/review/contributor-conventions.md",
    "docs/review/conventions-zod.md",
    "docs/review/conventions-react-native.md",
    "docs/review/conventions-state.md",
    "docs/review/conventions-typescript.md",
    "docs/review/conventions-async-tests.md",
  ],
  failOnError: false,
  task: "pr",
  // Experimental attribution remains off until independently labeled evaluation supports it.
  // `inferred`: each compiled rule is asked where its `appliesTo` and `when` in hunch.lock say.
  // Those were rewritten by hand to one policy — `appliesTo` carries only structural facts (file
  // extension, test files, the `app/app` route tree, native module sources), never a guess at which
  // feature directory a concern lives in, and the topic filter is a deliberately loose `when`
  // alternation. `everywhere` asked all 346 compiled rules of all 2,460 files, which the hosted
  // App's 3,000-request cap truncated; the relaxed restrictions cover more of a PR, not less.
  review: { contextLines: 40, chunkLines: 150, overlapLines: 0, localize: false, compiledScope: "inferred" },
  // Sized from `check --all --dry-run`: 4,585 chunks, 815k questions in 23,099 requests — 280k in
  // 12,394 before the packs, since their 115 rules carry no `when` and are asked of every chunk.
  // That is the whole-repository audit; a pull request pays about two extra requests per chunk,
  // which is why this stays unscoped. Narrow it with `--only nut18/*` for a targeted audit, or
  // scope a family to the directory that owns it with an override if the audit cost bites.
  // Earlier reference points: 1.43M questions in 25,980 under `compiledScope: "everywhere"`. The
  // hosted App applies its own caps to a PR (3,000 requests, 8 in flight, 240 seconds), which the
  // packs bring within reach at roughly 500 changed chunks instead of 750.
  budget: { maxHunks: 10000, maxRulesPerHunk: 1024, maxRequests: 40000, concurrency: 16, timeoutSeconds: 43200 },
  rules: {
    // ── Compiled skill rules switched off ─────────────────────────────────
    // Each skill was vetted before selection; these compiled rules either
    // duplicate something a tool or a house convention already decides, or
    // contradict a deliberate practice. The skills stay available to agents.
    //
    // Decided by lint (`no-explicit-any`, `no-console`,
    // `consistent-type-assertions`, the legacy-Animated ban) or better decided
    // by one (`switch-exhaustiveness-check`, `no-non-null-assertion`,
    // `testing-library/*`): not semantic questions.
    "skill/typescript-best-practices/unknown-over-any": "off",
    "skill/typescript-best-practices/no-console-log": "off",
    "skill/typescript-best-practices/satisfies-over-as": "off",
    "skill/typescript-best-practices/exhaustive-switch-never": "off",
    "skill/typescript-best-practices/no-non-null-assertion": "off",
    "skill/principle-type-system-discipline/exhaustive-variant-match": "off",
    "skill/expo-animation/no-core-animated": "off",
    "skill/expo-animation/no-panresponder": "off",
    "skill/react-native-testing/no-destructuring-render": "off",
    // Same question as a house convention, which is corrected for the
    // installed versions and carries this codebase's allowed cases
    // (motion/*, ui/keyboard-tracking, types/illegal-states,
    // input/parse-at-boundary, skill/expo-router/* in the conventions).
    "skill/expo-animation/no-runonjs": "off",
    "skill/expo-animation/no-setstate-in-gesture-or-scroll": "off",
    "skill/expo-animation/no-schedule-on-rn-per-frame": "off",
    "skill/expo-animation/shared-value-get-set": "off",
    "skill/expo-animation/no-shared-value-in-render": "off",
    "skill/expo-animation/no-entering-on-virtualized-row": "off",
    "skill/expo-animation/no-cubic-bezier-string": "off",
    "skill/expo-animation/spring-velocity-handoff": "off",
    "skill/expo-animation/gesture-start-context": "off",
    "skill/expo-animation/dismissal-uses-velocity": "off",
    "skill/expo-animation/keyboard-controller-not-listeners": "off",
    "skill/typescript-best-practices/discriminated-union-over-optional-bag": "off",
    "skill/principle-type-system-discipline/boolean-flag-with-optional-companion": "off",
    "skill/principle-model-the-domain/second-boolean-for-same-state": "off",
    "skill/principle-type-system-discipline/no-type-checker-escape-hatch": "off",
    "skill/principle-type-system-discipline/parse-external-data-at-boundary": "off",
    "skill/expo-router/prefer-native-tabs": "off",
    "skill/expo-router/native-tab-icon-missing-md": "off",
    "skill/expo-router/stack-navigator-outside-layout": "off",
    "skill/expo-router/dynamic-native-tab-triggers": "off",
    "skill/expo-router/prefer-modal-route-over-custom-modal": "off",
    // Contradicts a deliberate practice here.
    // perf/memo: React Compiler memoizes; a gesture `useMemo` is allowed, not required.
    "skill/expo-animation/gesture-memoized": "off",
    "skill/expo-animation/layout-builder-not-inline": "off",
    // Duration tokens, `PressScale` and the 90-140ms decorative exits are deliberate.
    "skill/expo-animation/no-ease-in-on-ui": "off",
    "skill/expo-animation/no-scale-zero-entrance": "off",
    "skill/expo-animation/spring-designer-params": "off",
    // ui/shared-parts: colours come from `useThemeColor`, not expo-router's `Color`.
    "skill/expo-router/prefer-color-over-platformcolor": "off",
    // a11y/controls requires accessibilityLabel / Role / State.
    "skill/react-native-testing/prefer-aria-props": "off",
    // The shared Pressable wraps onPress in a single-flight guard; userEvent's
    // timing against it is unverified, so fireEvent is not a finding yet.
    "skill/react-native-testing/prefer-userevent-over-fireevent": "off",
    // Its compiler glob was `**/app/**`, which matched this whole workspace's
    // `app/` package rather than the `app/app/` route tree; hunch.lock now scopes
    // it to `app/app/**`. Still off: routes/thin already keeps non-route code out
    // of the route tree. Re-enable it if that convention ever needs a second pair of eyes.
    "skill/expo-router/no-colocation-in-app-dir": "off",
    // Fires on `react-test-renderer` tree walking (`root.findAll`, `findByProps`),
    // which 83 test files use by design and which is not RNTL's `UNSAFE_*`.
    "skill/react-native-testing/no-unsafe-apis": "off",
    // No branded types exist yet; a naming convention for them is premature.
    "skill/typescript-best-practices/brand-shape-convention": "off",
    "skill/typescript-best-practices/type-guard-naming": "off",

    "ui/header-continuity": ["warn", choice({
      instructions: "Does this change visibly break the shared header contract: a page identity is duplicated or lost during its scroll handoff, header actions or content are obscured by incorrect inset ownership, a section selector becomes unreachable while scrolling its content, a fixed inset around a scrolling viewport prevents content from ever entering its gradient header, an opaque strip defeats the combined header/tab gradient, or identity handoff activates before the measured identity section clears navigation? Judge the visible layout and scroll ownership together, on iOS and Android; an isolated use of a header API without evidence of a broken behavior is unrelated.",
      criteria: { concern: "The changed layout or scroll wiring visibly causes one of these continuity or reachability failures.", ...outcomes },
      // Scoped by file only: the failure is a rendered-layout judgment, and no
      // single token appears in every way it can be built. Every `.tsx` sees it.
      files: ["**/*.{tsx,jsx}"],
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/header-contract.md",
      message: "Header identity, content clearance, or pinned section navigation may lose continuity.",
    })],
    "ui/header-scroll-work": ["warn", choice({
      instructions: "Does header-only visual animation visibly cause page-wide React rerenders or repeated navigator updates during scrolling or identity handoff? Follow state ownership and its consumers; identify actual state writes, not speculative memoization opportunities. A shared UI-thread animation, an isolated development probe, or necessary list/media offset bookkeeping is allowed. Native smoothness cannot be proven from code alone.",
      criteria: { concern: "Scroll or handoff callbacks write header-only visual state into the owning page or repeatedly rebuild navigator options, rerendering content unrelated to that animation.", ...outcomes },
      files: ["**/*.{tsx,jsx}"],
      when: /scroll|Scroll|header|Header|handoff|setOptions|useState|setState|useAnimated/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/header-contract.md",
      message: "Header-only animation may force unrelated page or navigator work.",
    })],
    "secrets/recovery-after-read-failure": ["warn", choice({
      instructions: "Does this change make a locked, failed or invalid secure-storage read lead to generating or overwriting recovery material rather than requiring confirmed absence? A write without a changed read-failure or initialization path is unrelated.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /mnemonic|Mnemonic|seed|Seed|recovery|Recovery|privateKey|privkey|nsec|secretKey|signingKey|SecureStore|getItemAsync|setItemAsync|generate|restore|backup|Backup|catch/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A secure-storage failure may replace existing recovery material.",
    })],
    "secrets/disclosure": ["warn", choice({
      instructions: "Given a visible secret/private value and sink, does this change expose secret or bearer wallet material or decrypted private messages to a visible unauthorized recipient, log, analytics sink, public payload or unencrypted persistent store? Exclude deliberate authorized backup/export and correctly encrypted storage or recipient transfer. A status-only change with no secret-bearing value or changed payload/storage path is unrelated.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /mnemonic|seed|Seed|nsec|privateKey|privkey|secretKey|signingKey|proof|Proof|token|Token|decrypt|plaintext|nip44|nip04|console\.|log|Log|logger|analytics|captureException|setItem|publish|fetch\(|body|payload/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Secret or private material may reach an unauthorized sink or plaintext persistent store.",
    })],
    // ── Entropy ───────────────────────────────────────────────────────────
    // `secrets/randomness` in the contributor conventions already covers the
    // naive case: `Math.random` called to make a key. These three cover the
    // shapes every published wallet-entropy theft actually took, where the code
    // still reads as correct. Evidence and allowed cases: docs/review/entropy.md.
    "entropy/weakened-fallback": ["warn", choice({
      instructions: "Does this change let key material — seed entropy, a private key, proof secret, blinding factor, nonce, bunker secret, pairing code or auth token — be produced from something other than an approved entropy source in `reference`, without failing loudly? The shape is a fallback that still returns bytes: a `??` or `||` default, a `try`/`catch`, a `typeof`/platform/availability branch, an optional chain, a polyfill, shim or injected generator around an entropy read. A fallback that throws, returns an error Result, or refuses to produce the value is preserved, not a concern. Require a visible entropy read and a visible weaker path; the mere absence of a check you cannot see is not evidence.",
      criteria: { concern: "The changed code can return key material derived from a weaker, guessable or absent entropy source, and nothing raises an error when that path is taken.", ...outcomes },
      when: /random|Random|entropy|Entropy|crypto|Crypto|getRandomValues|randomBytes|seed|Seed|mnemonic|Mnemonic|nonce|Nonce|\bkey\b|Key|secret|Secret|polyfill|shim|fallback|\?\?|\|\||catch|typeof/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/entropy.md",
      message: "Key material may fall back to a weaker entropy source without failing.",
    })],
    "entropy/narrowed-seed": ["warn", choice({
      instructions: "Trace the key material this change produces back to the unguessable input it depends on. Does that input terminate at a timestamp, a counter, a device or install id, a user PIN, a single 32-bit draw, or a truncated, sliced, modulo'd, `Number()`-converted or base-36 portion of a wider value — rather than a full-width read from an approved source in `reference`? Hashing, stretching, or a non-cryptographic PRNG seeded from it (Mersenne Twister, `seedrandom`, `xorshift`, `mulberry32`, `chance`, `faker`) adds length, not entropy. This is a structural question about where the input comes from; do not count or compare bit widths. BIP-32 derivation, HKDF and passphrase stretching over an already-wide root are expansion by design.",
      criteria: { concern: "Key material traces back to a narrow or guessable input that is expanded rather than to a full-width read from an approved entropy source.", ...outcomes },
      when: /random|Random|entropy|Entropy|seed|Seed|mnemonic|Mnemonic|derive|Derive|\bkey\b|Key|secret|Secret|nonce|blind|Blind|strength|wordlist|slice\(|substring|toString\(|Number\(|parseInt|Date\.now|performance\.now|counter|Counter|uuid|UUID|%\s/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/entropy.md",
      message: "Key material may be expanded from a narrow, brute-forcible input.",
    })],
    "entropy/reused-nonce": ["warn", choice({
      instructions: "Does this change let a value that must be unique per use — an ECDSA or Schnorr signing nonce, an AEAD nonce or IV, a Cashu blinding factor, a NIP-44 nonce — repeat under the same key? The shapes are: drawn once and used for two operations; cached, persisted, or held in a module-level, closure or component-level variable across calls; derived deterministically from data that can recur; or carried unchanged through a retry or re-entry. Re-sending an already-signed event or an already-built encrypted payload is the correct retry and is unrelated to this question. Require a visible repeat path.",
      criteria: { concern: "A signing nonce, encryption nonce, IV or blinding factor can be used twice under the same key.", ...outcomes },
      when: /nonce|Nonce|\biv\b|\bIV\b|blind|Blind|\bsalt\b|Salt|sign|Sign|schnorr|ecdsa|ECDSA|encrypt|Encrypt|nip44|nip04|random|Random|counter|Counter|retry|Retry|cache|Cache/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/entropy.md",
      message: "A nonce, IV or blinding factor may be reused under the same key.",
    })],
    "payments/uncertain-outcome": ["warn", choice({
      instructions: "Does this change turn an uncertain payment outcome into confirmed success or definitive failure without visible reconciliation evidence?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /melt|Melt|\bmint\b|Mint|swap|Swap|quote|Quote|invoice|Invoice|payment|Payment|proof|Proof|status|Status|pending|Pending|success|Success|failed|Failed|reconcil|settle/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "An uncertain payment outcome may be recorded as final.",
    })],
    "payments/repeated-effect": ["warn", choice({
      instructions: "Consider only a payment/spend effect, not relay publication or ordinary repeated I/O. Does this change allow the same intended payment effect to execute again on retry or concurrent re-entry without a visible identity, deduplication or state guard? A change to status/error representation without a changed retry, effect initiation or re-entry path is unrelated. Require a visible repeat path; absence of an unseen guard is not evidence.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /retry|Retry|attempt|Attempt|again|melt|Melt|swap|Swap|send|Send|\bpay\b|Pay|spend|Spend|proof|Proof|idempot|dedupe|inFlight|singleFlight|SingleFlight/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Retry or re-entry may repeat a payment effect.",
    })],
    "payments/cancellation-state": ["warn", choice({
      instructions: "Require a changed cancellation, rollback or proof-release path; an error-to-success status conversion alone is unrelated to this specific question. Does this change release spendable proofs, erase reconciliation evidence or claim rollback after an effect may already have committed, based only on cancellation or a local failure?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /cancel|Cancel|abort|Abort|rollback|Rollback|revert|restore|release|unmount|cleanup|dismiss|proof|Proof|melt|Melt|swap|Swap|pending|Pending/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Cancellation may discard committed or uncertain payment state.",
    })],
    "payments/request-constraints": ["warn", choice({
      instructions: "Does this change drop or bypass an applicable validated amount, unit, mint or locking constraint on a visible path from payment request to execution?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /paymentRequest|PaymentRequest|creqA|allowedMints|\bmints?\b|Mint|\bunit\b|Unit|amount|Amount|p2pk|P2PK|\block\b|Lock|constraint/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Payment execution may lose a validated request constraint.",
    })],
    "state/stale-owner": ["warn", choice({
      instructions: "Does this change let a stale async result mutate state after a profile, wallet or mint switch or superseding flow/request generation? A status-only change with no changed identity/generation guard or asynchronous state write is unrelated. Require visible invalidated ownership; do not discard committed payment work just because preparation was superseded.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /await|\.then\(|profile|Profile|switch|Switch|generation|useEffect|subscribe|setState|set\(|abort|Abort|signal|\bmint\b|Mint|wallet|Wallet/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A stale async result may update a different owner or superseding flow.",
    })],
    "state/persisted-compatibility": ["warn", choice({
      instructions: "Does a schema, decoder or migration change make previously persisted user data invalid without tolerant decoding or migration, causing a value or store to reset? A read/write with no schema or decoding change is unrelated. Require evidence that the changed schema is persisted; use insufficient-context only when a relevant schema change needs missing compatibility evidence.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /persist|migrate|version|partialize|z\.(object|enum|literal|union|array|record)|schema|Schema|\.parse\(|safeParse|storage|Storage|setItem|getItem|decode|Decode/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A persisted schema change may reset existing user data.",
    })],
    "state/authority-read-failure": ["warn", choice({
      instructions: "Does this change treat a failed or invalid durable wallet-authority read as an empty first-run store, allowing existing authority to be replaced? Exclude ephemeral cache defaults. Writes without a changed read-failure or initialization path are unrelated.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /getItem|setItem|SecureStore|AsyncStorage|storage|Storage|hydrat|Hydrat|rehydrate|catch|\.default\(|init|Init|counter|Counter|keyset|Keyset|seed|Seed/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A durable-state read failure may replace existing wallet authority.",
    })],
    "nostr/retry-identity": ["warn", choice({
      instructions: "Does this change re-sign or alter an already signed event during a retry of the same publication, creating another event identity?",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /sign|Sign|finalizeEvent|publish|Publish|retry|Retry|republish|resend|\.sig\b|created_at|event|Event/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A publication retry may create a different signed event.",
    })],
    "nostr/delivery-claim": ["warn", choice({
      instructions: "Does this change claim recipient receipt or guaranteed delivery from only local queueing or a relay acknowledgment? Local optimistic publication success after the first relay OK is explicitly allowed.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /publish|Publish|relay|Relay|deliver|Deliver|\bsent\b|Sent|accepted|\bOK\b|status|Status|queue|Queue|\bdm\b|DM|message|Message/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "Publication acknowledgment may be mistaken for recipient delivery.",
    })],
    "money/amount-meaning": ["warn", choice({
      instructions: "Require a changed amount value, conversion or numeric default; a payment status change without an amount change is unrelated. Does this change alter an executed or persisted monetary amount by losing its unit, precision or unknown-versus-zero meaning? Exclude display-only rounding with preserved execution values.",
      criteria: { concern: "The supplied change and context visibly demonstrate this concern.", ...outcomes },
      when: /amount|Amount|\bsats?\b|Sats|msat|balance|Balance|\bunit\b|Unit|\bfee\b|Fee|convert|Convert|Number\(|parseInt|parseFloat|toFixed|Math\.|\?\?|\|\|/,
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A monetary conversion or default may change the amount actually used.",
    })],
    // Not a lint rule: the tint and the icon are greppable, but deciding
    // whether a given tinted row is a status notice — rather than an empty
    // state, a badge or a field error — is a judgment about the rendered
    // shape. It is asked of every `.tsx`/`.jsx` chunk, with no `when` prefilter,
    // so a notice built from an unforeseen tint is still seen.
    "ui/status-notice": ["warn", choice({
      instructions: "Require changed JSX that renders a status notice: a short warning, error, caution or informational message next to a status icon, on its own tinted or bordered surface, within a page, card or sheet. Does this change build that surface out of primitives — a View, Card, HStack, Icon and Text, or a status tint such as `bg-warning-soft`, `bg-danger-soft`, `bg-danger/[0.08]`, `withAlpha(dangerColor, …)` or a literal amber or red hex — where the shared `Notice` in `app/shared/ui/composed/Notice.tsx` would render it? Judge the rendered shape, not the vocabulary. A full-screen error or empty state, a screen-wide chrome banner, an interactive call-to-action card, a badge or pill carrying no status sentence, per-field validation text under an input, and bare tinted copy with no surface of its own are different shapes, not notices. A small named component whose body is a `Notice` at one surface's geometry is the intended pattern; so are `Notice`'s own implementation and the design-system catalogue screens under `app/features/settings`.",
      criteria: { concern: "The changed JSX hand-builds a status notice that `Notice` — with its `status`, `tone`, `size`, `icon` and `action` props — already renders.", ...outcomes },
      files: ["**/*.{tsx,jsx}"],
      report: ["concern"],
      abstain: ["insufficient-context"],
      reference: "docs/review/contracts.md",
      message: "A status notice may be hand-built instead of using the shared Notice component.",
    })],
  },
});
