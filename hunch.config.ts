import { defineConfig, noul } from '@kelbie/hunch';

// Sovran's code rules: the conventions a linter or type checker can't enforce.
// Hunch asks Jev whether each changed hunk breaks them. Run from the repo root:
//   npx @kelbie/hunch check --base origin/main

const UI = ['app/**/*.tsx'];
const UI_LOGIC = ['app/**/*.tsx', 'app/**/hooks/**/*.ts'];
const ROUTES = ['app/app/**'];
const STORES = ['**/stores/**/*.ts', '**/*Store.ts', '**/persist/**/*.ts', '**/cache/**/*.ts'];
const NOSTR = [
  'nostr/src/**/*.{ts,tsx}',
  'app/shared/lib/nostr/**/*.{ts,tsx}',
  'app/features/{feed,payments,contacts,composer,nostrSigner}/**/*.{ts,tsx}',
];
const WALLET = [
  'wallet/src/**/*.{ts,tsx}',
  'app/shared/lib/{cashu,nfc}/**/*.{ts,tsx}',
  'app/features/{send,receive,payments,mint,nearPay,transactions,wallet}/**/*.{ts,tsx}',
];

export default defineConfig({
  extends: ['hunch:recommended', 'hunch:typescript'],
  include: [
    'app/app/**/*.{ts,tsx}',
    'app/features/**/*.{ts,tsx}',
    'app/shared/**/*.{ts,tsx}',
    'wallet/src/**/*.{ts,tsx}',
    'nostr/src/**/*.{ts,tsx}',
  ],
  ignore: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/__mocks__/**'],
  // Standard skills only; Sovran's own rules live below.
  skills: ['./.agents/skills/codebase-design', './.agents/skills/expo-router'],
  agentsMd: true,
  // Public repository; the Vercel Hobby plan can't enforce zero data retention.
  zeroDataRetention: false,
  // Sized for a full `check --all` pass (about 2,500 chunks); the hosted App caps these lower.
  budget: {
    maxRulesPerHunk: 64,
    maxHunks: 3000,
    maxRequests: 3000,
    timeoutSeconds: 3600,
  },

  rules: {
    // Errors and uncertain outcomes
    'errors/structured': [
      'error',
      "Keep errors structured until they reach the UI: don't turn a caught error into a string, boolean, null or generic Error, and keep its cause, status, code and service.",
    ],
    'errors/not-for-decisions': [
      'error',
      'Never decide retry, balance, refund, proof state or payment recovery from display text or error messages.',
    ],
    'payments/uncertain-outcomes': [
      'error',
      'Treat timeouts, cancellations and relay acceptance as unknown outcomes, never as proof that a payment failed, succeeded or was delivered.',
    ],

    // Async work and networking
    'async/owner-scope': [
      'error',
      'Async work may only write to the profile, request or generation that started it; results that arrive after cancellation, a newer request or a profile switch are dropped.',
    ],
    'async/cleanup': [
      'warn',
      'Every subscription, timer, listener or background promise has an owner that handles its failure and tears it down; `void promise` and empty catch blocks must not hide errors.',
    ],
    'net/transport': [
      'warn',
      'Make requests through the domain transport (apiClient, wallet/safeFetch, the Nostr facade) with caller cancellation and a bounded deadline, not a screen-local fetch.',
    ],
    'net/retries': [
      'error',
      'Retry only idempotent reads, with bounded backoff; payments and other side effects are reconciled against persisted state, never simply repeated.',
    ],

    // Untrusted input
    'input/parse-at-boundary': [
      'warn',
      'Parse untrusted input (network, relays, route params, storage, QR codes, clipboard, native callbacks) with a Zod schema at the boundary, and infer the type from that schema instead of redeclaring it.',
    ],
    'input/structure-not-trust': [
      'error',
      'A successful schema parse proves shape only; never treat it as a verified signature, an authorization or a spendable proof.',
    ],

    // Money and time
    'money/exact': [
      'error',
      'Amounts that decide a payment use exact integer or SDK values with their unit and mint: no floating-point BTC math, toFixed, rounding, or coercion of invalid, negative or fractional input.',
    ],
    'time/units': [
      'warn',
      'Name time values with their unit (createdAtMs, timeoutSeconds), convert Nostr seconds once at the boundary, and store raw timestamps rather than formatted labels.',
    ],

    // Secrets and privacy
    'secrets/storage': [
      'error',
      'Mnemonics, private keys, nsec and signing secrets stay in secure storage and never appear in stores, AsyncStorage, route params, URLs, test IDs, fixtures or logs.',
    ],
    'secrets/logs': [
      'error',
      'Logs never include seed words, private keys, Cashu proofs or tokens, invoices, DM contents, PINs, raw NFC bytes or credential-bearing URLs.',
    ],
    'secrets/randomness': [
      'error',
      'Security-relevant randomness comes from the native crypto source; never Math.random or hand-rolled cryptography.',
    ],
    'mock/isolation': [
      'error',
      'Mock Mode data never enters Coco, transaction stores, Nostr or query caches, or persistence, and never publishes, zaps or pays.',
    ],

    // Structure and naming
    'arch/owner': [
      'warn',
      'Put code with the owner of its meaning (payment sequencing in wallet/, Nostr transport in nostr/, screens and device I/O in app/); no generic utils or helpers modules, and no shared helper switched by caller-specific flags.',
    ],
    'naming/verbs': [
      'warn',
      'Function names follow their verb: get is synchronous and local, fetch reads the network, load reads local persistence, build and compute are pure, format returns display text, parse decodes text.',
    ],
    'naming/protocol': [
      'warn',
      'Name protocol values by exact meaning (cashuTokenEncoded, proofSecret, mintQuoteId, nostrPubkeyHex, nostrEventId, lnInvoiceBolt11) rather than a bare token, secret, pubkey or quote, and reuse protocolIds instead of new ID regexes.',
    ],
  },

  overrides: [
    {
      files: UI,
      rules: {
        'ui/read-states': [
          'warn',
          'Async screens show distinct loading, empty, failed and stale-with-data states: a failed or unavailable read is never shown as empty, and existing rows stay visible while refreshing or after a refresh fails.',
        ],
        'ui/unknown-values': [
          'warn',
          'Unknown counts stay undefined and render as a placeholder, never 0; image fallbacks appear only once the source is known to be missing or failed (avatarStateFor).',
        ],
        'ui/honest-loading': [
          'warn',
          'No minimum skeleton durations, second list mounted just to crossfade, or loading animation that keeps running after a failure.',
        ],
        'ui/insets': [
          'warn',
          "Screen and useScreenInsets own safe-area, tab, footer and keyboard space; don't hard-code tab or footer heights or add safe-area padding twice.",
        ],
        'ui/shared-parts': [
          'warn',
          'Use the shared Icon registry, Spinner, SelectableCheck, Button, Text and semantic theme tokens instead of custom icons, spinners, checkmarks, fonts or screen-local colors.',
        ],
        'ui/platform': [
          'warn',
          'Choose glass or blur variants with the capability hook or defineVariants rather than Platform.OS or iOS version checks, and keep iOS-only native imports out of Android-reachable modules.',
        ],
        'ui/single-submit': [
          'error',
          "Prevent double submission of payments and other actions with the owner's busy state, not only a debounce.",
        ],
        'ui/permissions': [
          'warn',
          'Request camera, NFC, location, clipboard and other permissions when the user starts the related action, with denied and unavailable states, never at startup.',
        ],
        'copy/sentences': [
          'warn',
          'Write UI text as complete sentences with parameters; never concatenate fragments or append English plural endings.',
        ],
        'copy/truncation': [
          'error',
          'Shorten text only for display (numberOfLines or an authored short label): never slice strings or disable font scaling to fit, never cut amounts, fees, recipients, hosts or recovery steps, and always copy, sign, submit and compare the full value.',
        ],
        'copy/honest': [
          'warn',
          'UI text never claims more security, privacy, delivery or settlement than the code establishes, and never shows raw error messages, stack traces, Zod issues or server responses.',
        ],
        'a11y/controls': [
          'warn',
          'Interactive controls have an accessible name, expose busy, disabled, selected and expanded state, and carry a stable semantic testID based on entity identity, never an index or display text.',
        ],
        'perf/offscreen': [
          'warn',
          'Timers, animations and polling stop when their screen or row is not visible.',
        ],
      },
    },
    {
      files: UI_LOGIC,
      rules: {
        'state/selectors': [
          'warn',
          'Subscribe to Zustand with the smallest selector, never the whole store or a selector returning a new object, array or function fallback; use getState() only in handlers, never during render.',
        ],
        'perf/render': [
          'warn',
          "Don't fetch, decrypt, parse, sort or serialize data during render or once per list row; batch through the data owners and render long lists with the shared virtualized List.",
        ],
        'perf/memo': [
          'warn',
          'New components rely on React Compiler instead of adding useMemo, useCallback or memo without a measured need, and existing memoization is not removed without evidence.',
        ],
      },
    },
    {
      files: ROUTES,
      rules: {
        'routes/thin': [
          'warn',
          'Route files parse params, choose the screen and configure navigation only; route params are small serializable identifiers, never secrets, objects or large data.',
        ],
      },
    },
    {
      files: STORES,
      rules: {
        'persist/migrations': [
          'error',
          noul({
            instructions:
              'Does `hunk` rename, remove, or change the type or allowed values of a field in persisted state (for example a zustand `persist` store) without also bumping its `version` and handling the old shape in `migrate`?',
            message:
              "Changing persisted state needs a version bump and migration for existing users' data.",
            threshold: 0.85,
          }),
        ],
        'persist/data-only': [
          'warn',
          'Persisted state holds plain data only: no functions, managers, promises, loading flags or decrypted private messages.',
        ],
        'persist/fallbacks': [
          'error',
          'Schema defaults and .catch never turn invalid money, credentials, consent or trust into valid-looking state; unknown enum values fall back to a neutral member, never a privileged one.',
        ],
        'persist/scope': [
          'warn',
          'Identity-dependent data is profile-scoped, only identity-independent data is global, and cache keys include every input that changes the result (viewer, tier, filters, cursor).',
        ],
        'state/one-authority': [
          'warn',
          'Keep one authority per piece of data: no effect copying one store or cache into another, and no screen-level copy of balances, proofs or Nostr entities.',
        ],
        'state/shape': [
          'warn',
          'Store actions update immutably, fields that change together live in one object, and meaningful 0, false and empty values survive truthy checks and || defaults.',
        ],
        'state/clock': [
          'warn',
          'Freshness and expiry logic takes nowMs or an injected clock and reads it once per update; cache freshness never proves that a quote is valid or proofs are unspent.',
        ],
      },
    },
    {
      files: NOSTR,
      rules: {
        'nostr/facade': [
          'warn',
          "Read Nostr through the facade; screens don't build their own Nagg, Primal or relay fallback chains.",
        ],
        'nostr/signed-events': [
          'error',
          'Never alter a signed event and still treat it as verified; keep the raw event, derive display data separately, and retry a publish by resending the same signed event.',
        ],
        'nostr/delivery': [
          'warn',
          'Keep optimistic, signed, relay-accepted, delivered and failed as separate states; relay acceptance is not delivery.',
        ],
        'nostr/live': [
          'warn',
          "Live subscriptions don't auto-reconnect: pair them with cursor catch-up and dedupe by event ID.",
        ],
        'nostr/private-dms': [
          'error',
          'Decrypt DMs on the device only; never send private keys or plaintext to Nagg, or persist decrypted messages unencrypted.',
        ],
      },
    },
    {
      files: WALLET,
      rules: {
        'wallet/engine-owns': [
          'warn',
          'Screens trigger wallet actions or machine events; proof selection, mint, melt, swap, payment retries and history reconciliation stay in wallet/.',
        ],
        'wallet/cancel': [
          'error',
          'Leaving or cancelling a payment screen stops UI updates only; it never assumes the operation stopped or was refunded.',
        ],
        'wallet/locks': [
          'error',
          "A recipient-locked (P2PK/NUT-10) transfer never falls back to an unlocked bearer token, and a payment request's lock, mint list and unit constraints are never dropped.",
        ],
        'wallet/mint-trust': [
          'error',
          'Never bypass TLS checks or add a fake trusted mint record to hide a network failure.',
        ],
        'wallet/fresh-flow': [
          'warn',
          'A new Send, Receive, scan or NFC flow starts from cleared payment context without a previous recipient, amount, unit or mint, and offline sends never wait on network fetches.',
        ],
      },
    },
    {
      files: [
        'app/shared/lib/cta/**',
        'app/shared/blocks/Cta*',
        'app/features/backup/**',
        'app/app/\\(prompt-flow\\)/**',
      ],
      rules: {
        'cta/pure-eligibility': [
          'warn',
          "A CTA's shouldShow is pure and synchronous over its injected context and clock; it never waits on the network.",
        ],
        'cta/security-nags': [
          'error',
          "A security or backup prompt's primary action never dismisses it, blocking CTAs have no dismissal or back escape, and revealing the recovery phrase never marks the backup verified.",
        ],
      },
    },
  ],
});
