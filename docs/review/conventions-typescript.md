# TypeScript, errors and data handling

Rules for mistakes that compile cleanly under `tsc --strict` and pass the enabled lint rules, then misbehave at runtime (TypeScript 5.9, neverthrow 8). Same format and standing as the [contributor conventions](contributor-conventions.md): human and agent guidance that Hunch compiles into review questions. Every rule here has a reproduction that compiles with this repository's compiler flags. Anything a lint rule can decide is deliberately absent.

## errors/unused-result

Scope: `repository-wide`

A neverthrow `Result` or `ResultAsync` that is computed and dropped loses its error silently: it never throws, never rejects, and `await` or `void` in front of it satisfies `no-floating-promises`.

Does `hunk` call a function that the hunk shows returning a neverthrow `Result` or `ResultAsync` — its signature, a `ResultAsync.from*`/`ok(`/`err(` body, or a sibling call site that checks `.isErr()`/`.match(` — as a bare statement (`save(x);`, `await publish(x);`, `void respond(x);`, or an `await Promise.all(` over such calls) so that the returned Result is never read?

Allowed cases: The Result is returned, assigned and then checked, or consumed by `.match(`, `.isErr()`/`.isOk()`, `.mapErr(` that logs or reports, `.orElse(` or `._unsafeUnwrap()` in a test; `void` on a chain whose last link is a `.mapErr(`/`.orElse(` handler that logs or surfaces the error; a documented best-effort path (telemetry, cleanup, cache warm-up) with a comment saying the failure is deliberately ignored; a callee whose return type is not visible in the hunk.

## errors/safe-promise-can-reject

Scope: `repository-wide`

`ResultAsync.fromSafePromise` types the error channel as `never`, so a rejection from the wrapped promise bypasses every `.mapErr`, `.orElse` and `.match` and surfaces as an unhandled rejection.

Does `hunk` pass to `ResultAsync.fromSafePromise(` a promise that can visibly reject — a `fetch`, SDK, storage, crypto or native-module call, an `async` function whose body the hunk shows containing `throw` or an un-caught `await`, or a `.then(` chain with no `.catch(`?

Allowed cases: The wrapped promise cannot reject by construction (a function documented or typed as returning `Promise<Result<…>>` that catches internally, a `Promise.resolve(value)`, a timer promise, a promise that already ends in `.catch(`); `ResultAsync.fromPromise(p, mapError)` or `ResultAsync.fromThrowable(fn, mapError)` is used instead.

## errors/result-callback-throws

Scope: `repository-wide`

neverthrow does not catch a throw inside a combinator callback: it escapes a function whose signature promises a `Result`, and no caller is written to catch it.

Does `hunk` contain a `throw`, or a call that visibly throws on bad input (`JSON.parse(`, `new URL(`, `BigInt(`, `decodeURIComponent(`, a cashu-ts or nostr-tools decoder, a zod `.parse(`), inside the callback of `.map(`, `.mapErr(`, `.andThen(`, `.orElse(`, `.andThrough(` or `.match(` on a neverthrow `Result` or `ResultAsync`, without a try/catch inside that callback?

Allowed cases: The throwing call is wrapped with `Result.fromThrowable(fn, mapError)()` or `ResultAsync.fromThrowable` and chained with `.andThen(`; the callback returns `err(…)` instead of throwing; an `async` callback passed to `ResultAsync.fromPromise(…, mapError)`, which does capture the rejection; `.andTee(`, the one combinator that contains a throw; `.map(`/`.match(` on arrays, zod or other non-neverthrow values; tests.

## types/spread-undefined-clobbers-default

Scope: `repository-wide`

Without `exactOptionalPropertyTypes` an optional property may hold an explicit `undefined`, and `{ ...DEFAULTS, ...options }` lets that `undefined` overwrite the default while the merged type still says the field is defined.

Does `hunk` build a configuration, policy or options object by spreading a caller-supplied object with optional properties over defaults (`{ ...DEFAULTS, ...opts }`, `{ ...DEFAULT_POLICY, ...opts.retry }`, `Object.assign({}, defaults, opts)`) and then read the merged fields as always defined — or build such an argument from possibly-undefined values (`fn({ timeoutMs: props.timeoutMs })`) for a callee the hunk shows merging that way?

Allowed cases: Each field is merged with `??` (`timeoutMs: opts.timeoutMs ?? DEFAULTS.timeoutMs`); the override object is validated or stripped of `undefined` first (a zod schema with defaults, a `definedOnly`/`omitUndefined` helper); the override's fields are all required in its type; the merged fields are typed `T | undefined` and the readers handle `undefined`; React style or props spreads, where `undefined` means "unset".

## narrowing/stale-after-await

Scope: `repository-wide`

TypeScript keeps a property path narrowed across `await` and across function calls, but a mutable owner — a ref, a store, `this`, a module singleton — can be reset while the function is suspended, so the narrowed access crashes at runtime with no compile error.

Does `hunk` null-check a mutable property path (`ref.current`, `this.x`, `Class.staticField`, `session.quote`, `useStore.getState().x`, a module-level `let`) and then, after an `await` in the same function, dereference that same path again (`this.plugin.addAccount(…)`, `ref.current.focus()`, `session.quote.id`) without re-checking it or having captured it in a `const` before the `await`?

Allowed cases: The value is captured first (`const plugin = this.plugin; if (!plugin) return; await …; plugin.addAccount(…)`); the path is re-checked or accessed with `?.` after the `await`; the owner is visibly immutable for the function's lifetime (a `const` local, a `readonly` field assigned only in the constructor, a function parameter object that nothing else holds); no `await`, `yield` or callback boundary sits between the check and the use.

## input/prototype-key-lookup

Scope: `repository-wide`

A plain object literal used as a lookup table inherits `constructor`, `toString`, `__proto__` and friends, so indexing it with a string from a mint, relay, deep link or user returns an inherited function or object that `??`, `||`, `in` and truthiness checks all accept as a hit.

Does `hunk` index a plain-object lookup table (an object literal or `Record<string, …>` constant) with a string authored by someone outside this project — a mint-supplied unit, method, NUT number or state, a relay or event field, a route or deep-link param, a field of a remote JSON document, user text — and trust the result through `TABLE[key] ?? fallback`, `TABLE[key] || fallback`, `if (TABLE[key])`, `key in TABLE`, or by rendering or calling it?

Allowed cases: Membership is checked with `Object.hasOwn(TABLE, key)` (or `Object.prototype.hasOwnProperty.call`) before the read; the table is a `Map`, a `Set`, or an object with a null prototype (`Object.create(null)`); the key was already validated against a closed union (a zod enum, a registry guard such as `isFiatUnit`, a `switch` over literals) so it is no longer an arbitrary string; the key is a protocol identifier whose format cannot equal an inherited member name (a hex pubkey or event id, a digits-only string, a URL, a single character), validated or produced as such; the key is produced by this app's own code (an enum-like constant, `Object.keys` of the same table) or read from a file or artefact this project's own tooling wrote — origin is judged by who authors the value, not by whether it travelled as JSON; a `typeof value === 'string'` (or other exact type) check on the result before it is used.

## async/all-with-side-effects

Scope: `repository-wide`

`Promise.all` rejects on the first failure while the other operations keep running unobserved, so for writes the caller learns of one failure and loses every other outcome — which sends went out, which failed.

Does `hunk` pass to `Promise.all(` operations with side effects that may already have happened by the time one rejects — payments, melts, mints, swaps, sends, publishes, deletes, storage or database writes — where each outcome matters to what the caller records, retries or shows?

Allowed cases: `Promise.allSettled(` with every result inspected; each mapped operation catches its own failure inside the callback and returns a typed outcome (a try/catch per item, a neverthrow `Result`), so `Promise.all` cannot reject; `Promise.all` over reads only (fetches, queries, cache or storage reads, dynamic imports); operations that are all-or-nothing by design and rolled back together; tests.

## mutation/shared-in-place

Scope: `repository-wide`

`sort`, `reverse`, `splice`, `fill` and `copyWithin` mutate their receiver and return the same reference, so calling them on an array the function does not own reorders the caller's, the store's or the cache's data and hides the change from reference-equality checks.

Does `hunk` call `.sort(`, `.reverse(`, `.splice(`, `.fill(`, `.copyWithin(`, `.push(`, `.pop(`, `.shift(` or `.unshift(` on — or assign to or `delete` a property of — a value the enclosing function did not create and was not handed in order to mutate: a function parameter, a component prop, a hook, selector, query or `getState()` result, an imported or module-level constant (most clearly one mutated through an `as` cast that widens its literal or readonly type), or a property of one of those?

Allowed cases: The receiver is a fresh copy or a freshly built array in the same function (`[...items].sort(…)`, `items.slice().reverse()`, `items.map(…).sort(…)`, `.filter(…)`, `Array.from(…)`, `Object.keys(…)`, a local `const out = []` that is pushed to); `toSorted`/`toReversed`/`toSpliced`/`with`; an Immer draft, or the argument of an updater or producer callback passed to the owning store's `update`/`set`/`produce`, whatever it is named; a parameter whose documented purpose — in its name (`out`, `acc`, `draft`, `result`), its JSDoc or the file header — is to be mutated in place; a module's own mutable context, session or cursor object threaded through its private helpers so that they can maintain it (`ctx.stack.push(…)`); a class mutating its own private field; store files, which `state/shape` already covers; mutation during render, which `react/render-mutation` covers.

## math/empty-aggregate

Scope: `repository-wide`

Aggregates have no neutral answer for an empty list: `Math.max(...[])` is `-Infinity`, `Math.min(...[])` is `Infinity`, and `reduce` without an initial value throws `TypeError` — and proofs, mints, quotes and fee options are all legitimately empty at times.

Does `hunk` call `Math.max(...list)` or `Math.min(...list)` with only a spread argument, or `.reduce(fn)` with no initial value, on an array that can be empty at runtime when the call executes — a filtered or mapped list, a store or query result, wire data, a function parameter — with no length check that the hunk shows before it?

Allowed cases: A preceding `if (list.length === 0) return …` (or a `list.length ? … : …` ternary) in the same function; a literal non-spread operand that bounds the result (`Math.max(0, ...list)`, `Math.min(cap, ...list)`); `reduce` with an initial value; a non-empty tuple type (`[T, ...T[]]`); a list that the hunk shows being built with at least one element; a call that sits inside a `for…of`, `.map` or `.forEach` body iterating that same list, so it cannot run when the list is empty.

## time/invalid-date

Scope: `repository-wide`

`new Date(x)` never throws: a malformed value yields an Invalid Date whose `getTime()` is `NaN`, so every `<`/`>` expiry comparison is `false` (nothing ever expires, nothing is ever stale) and `toISOString()` or `Intl` formatting throws `RangeError`.

Does `hunk` construct a `Date` (or call `Date.parse`) from a value that comes from outside the app — a relay or mint field, an API response, a deep link, persisted or user-entered text — and then compare it, subtract it, store it, call `.toISOString()` on it or format it, without first checking `Number.isNaN(date.getTime())` (or validating the input with a schema such as `z.iso.datetime()` or a finite-number check)?

Allowed cases: The input is a finite number the hunk shows being validated (`Number.isFinite`, a zod `z.number().int()`); `new Date()` / `Date.now()` / a timestamp produced by this app; the result goes straight into the shared `formatDate`/`formatRelative` helpers, which own invalid-date handling; an explicit validity check before use; tests and fixtures.

## money/nan-passes-guard

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,transactions,nfc,nearPay,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/*{Wallet,Payment,Mint,Melt,Send,Receive,Proof,Token,Invoice,Amount,Balance,Cashu,Lightning,Onchain}*.{ts,tsx}`

Every comparison with `NaN` is `false`, so an amount check written as a list of rejections (`<= 0`, `> max`) or as `typeof x === 'number'` lets `NaN`, `Infinity` and fractional values through as valid, and `JSON.stringify` then turns the `NaN` into `null`.

Does `hunk` take an amount, fee, limit or balance that arrives from outside the function's own arithmetic — an event or machine-context field, a route or deep-link param, a parsed payload, user input, a store field — and let it continue into a quote, send, melt, mint or other payment step when the only checks on it are `typeof x === 'number'` or comparisons written in the rejecting direction (`if (amount <= 0) return …`, `if (amount > max) return …`, `amount < min || amount > max`), with no `Number.isSafeInteger`, `Number.isInteger`, `Number.isFinite` or schema check (`z.number().int().positive()`, `z.int()`) on that value anywhere the hunk shows?

Allowed cases: The value was already parsed by a zod number schema or came from an SDK amount type (cashu-ts amounts, `amountToNumber` of a validated amount); the guard is written as an acceptance test that `NaN` fails (`if (!(amount > 0 && amount <= max)) return …`, `if (amount != null && amount > 0) { … }`), including rejecting range checks nested inside such a test, or is preceded by `Number.isSafeInteger`/`Number.isFinite`; a later exact-match or set-membership acceptance that `NaN` and fractions fail; values the function computed itself from validated inputs or module constants (deltas, remainders, suggestion targets) and loop or bookkeeping conditions on them; a helper that only labels, filters or ranks candidates for display and sends nothing; a `typeof` check on a value that is only displayed; range checks on values that are not money and cannot be `NaN` (array indices, lengths, enum ordinals); display-only code.

## types/exhaustive-else

Scope: `repository-wide`

A final `else` or last ternary arm that stands for "the remaining member" silently absorbs every member added to the union later, and neither `tsc` nor `switch-exhaustiveness-check` looks at if-chains or ternaries.

Does `hunk` map ONE variable that ranges over a closed set of three or more literal values (a `kind`, `type`, `status`, `state`, `phase`, `mode` or unit compared with `===` against string literals) to results arm by arm — with an `if`/`else if` chain, a run of early returns or a nested ternary — so that the final `else`, fall-through or last arm produces the result that belongs to one specific unnamed member — a label, a colour, a state, a verdict such as `'finalized'`, `'deny'`, `true` for refund — rather than a genuinely neutral fallback?

Allowed cases: A `switch` (or lookup table typed `Record<Union, …>` / `satisfies Record<Union, …>`) over the union; a final branch that assigns the value to `never`, calls `assertNever`, throws, or returns a neutral value that is correct for members that do not exist yet (`null`, `undefined`, the input unchanged or echoed, "unknown"); a two-member union or boolean; a comparison against ONE literal whose `else` really does mean "everything else" (`unit === 'sat' ? … : …`); values that are open strings from the wire rather than a closed union; a ladder of guards over several different variables or conditions whose fall-through is the default or least-privileged outcome (`'ask'`, deny, not allowed); guards that skip an action for certain states and otherwise perform the same generic action for every remaining state; a final arm that handles absence (`undefined` or `null`) rather than a literal member; a discriminator the same function computes a few lines earlier with its own ternary or if-chain, so the set of values and the mapping are edited together.

## types/shared-empty-readonly

Scope: `repository-wide`

A module-level empty fallback (`EMPTY`, `NO_ITEMS`, `DEFAULT_TAGS`) is one object shared by every consumer, so when its type is mutable the compiler lets any of them `push`, `set` or assign into it and corrupt the "empty" value for the whole app.

Does `hunk` declare a module-level constant array, object, `Map` or `Set` that serves as a shared empty or default value — returned from a selector, hook or function, or used after `??` — with a mutable type (`const EMPTY: string[] = []`, `const EMPTY_AMOUNTS: Record<string, number[]> = {}`, `new Map<…>()`), rather than a read-only one?

Allowed cases: The constant is typed `readonly T[]`, `ReadonlyArray<T>`, `Readonly<Record<…>>`, `ReadonlyMap`/`ReadonlySet`, declared `as const`, or wrapped in `Object.freeze(`; a module-level collection that is deliberately mutable state owned by that module (a cache, a registry, a listener set) and is not handed out as a fallback; constants inside tests and fixtures.

## async/optional-call-noop

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,transactions,nfc,nearPay,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/*{Wallet,Payment,Mint,Melt,Send,Receive,Proof,Token,Invoice,Amount,Balance,Cashu,Lightning,Onchain}*.{ts,tsx}`

`await manager?.melt(…)` resolves to `undefined` without running anything when the owner is missing, so the code after it reports success for an operation that never started.

Does `hunk` invoke a wallet, payment, persistence or publish operation through optional chaining (`await machine?.startReceive(…)`, `manager?.wallet.send(…)`, `void store?.save(…)`) and then continue as if it ran — advancing a flow, returning success, clearing state or navigating — with no branch for the case where the owner was `undefined`?

Allowed cases: The missing owner is handled first (`if (!machine) return err(notReady)`) or the result of the optional call is checked for `undefined`; optional calls to callbacks and UI affordances where absence legitimately means "nothing to do" (`onClose?.()`, `ref.current?.focus()`, `sheetRef.current?.dismiss()`, `controller?.abort()`, `subscription?.remove()`); teardown and cleanup paths.

## regex/global-test

Scope: `repository-wide`

A regular expression with the `g` or `y` flag is stateful: `.test()` and `.exec()` advance `lastIndex`, so a shared instance alternates between `true` and `false` for the same input, and a later `matchAll` on it starts from the dirty offset.

Does `hunk` call `.test(` or `.exec(` on a regular expression that has the `g` or `y` flag and outlives the call — a module-level or imported constant, a class field, a value from `useRef` or `useMemo` — or add the `g` flag to a shared pattern that the hunk shows being used with `.test(`?

Allowed cases: The pattern used for `.test(` has no `g`/`y` flag; a regex literal created inline at the call site each time; `g`-flagged patterns used only with `replace`, `replaceAll`, `matchAll` or `split`; an `exec` loop that deliberately iterates matches and resets `lastIndex = 0` (or runs to `null`) before the instance is reused.

## strings/replace-first-only

Scope: `repository-wide`

`String.prototype.replace` with a string pattern replaces only the first occurrence, so stripping separators with it leaves the rest in place — `'1,000,000'.replace(',', '')` is `'1000,000'`, which `parseInt` reads as 1000.

Does `hunk` call `.replace(` with a string (not regex) first argument where every occurrence is meant to change — removing or swapping separators, whitespace, commas, dashes, slashes, zero-width or control characters, or normalising an amount, identifier, URL, testID or key?

Allowed cases: `.replaceAll(`, or a regex with the `g` flag; removing a single prefix, suffix or sigil that can occur only once or only matters at the start (`hex.replace('#', '')`, `handle.replace('@', '')`, `uri.replace('nostr:', '')`, a scheme or file extension); replacing a unique placeholder in a template the code owns.
