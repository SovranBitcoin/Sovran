# Async, errors, network and tests

Rules for concurrency and re-entry, error channels (neverthrow 8), HTTP handling, numeric input, and test reliability (Jest 30, Vitest 3, react-test-renderer under React 19). Same format and standing as the [contributor conventions](contributor-conventions.md): human and agent guidance that Hunch compiles into review questions. Every rule here was reproduced by running code against the installed versions. Dropped-Result, combinator-throw, `fromSafePromise`, `Promise.all` and in-flight-map rules live in [TypeScript](conventions-typescript.md) and [state](conventions-state.md).

## async/race-loser

Scope: `repository-wide`

`Promise.race` does not stop the loser: the timed-out work keeps running and can write state later, and an un-cleared timer keeps firing.

Does `hunk` add a `Promise.race([` between work and a timeout or fallback where (a) the timer is never cleared once the work wins, or (b) the losing work is neither cancelled nor prevented from writing state, storing a result or resolving a flow after the race has been decided?

Allowed cases: The timer is cleared in `finally` (as `withTimeout` in `app/shared/lib/wallpaperStorage.ts`); the loser is cancelled (an `AbortController`, `task.cancelAsync()` as in `blossomClient.ts`) or its late result is dropped by a generation, `isStaleGeneration` or `cancelled` check; the deadline comes from `timeoutSignal` / `combineSignals` passed into `fetchJson` or `safeFetch`; a `setTimeout(resolve, 0)` yield that carries no deadline meaning; a payment whose late result is reconciled rather than ignored.

## async/signal-dropped

Scope: `repository-wide`

A function that accepts cancellation must pass it on, otherwise callers believe they cancelled work that is still running.

Does `hunk` define or change a function that accepts `signal`, `AbortSignal` or `RequestControls` and then (a) calls `fetchJson`, `safeFetch`, a facade method or another signal-accepting function without forwarding it, or (b) after an `await`, writes state or starts the next network step without checking `signal.aborted` / `throwIfAborted()`?

Allowed cases: The signal is forwarded to every awaited call that accepts one; the post-await write is guarded by `signal.aborted`, `isAbortError`, a generation id or a `cancelled` flag; the inner call cannot take a signal (a native module, a Coco manager call) and the result is checked against the signal before use; a payment effect that must run to completion once started, with only its UI updates gated.

## async/guard-before-await

Scope: `repository-wide`

A re-entrancy guard only works if it is taken synchronously, before the first `await`, in storage that updates immediately.

Does `hunk` guard an async action against re-entry with a flag that (a) is set only after the first `await`, or (b) lives in React state (`if (busy) return; setBusy(true)`), a Zustand field read from a render closure, or any other value that does not change until a later render or tick?

Allowed cases: A `useRef`, module variable or machine field checked and set in the same synchronous block before any `await` (`sendLocked` in `wallet/src/machine/createMachine.ts`, `isRunningRef` in `useMintRebalanceOrchestrator`); `useSingleFlight` / `useKeyedSingleFlight` or the shared `Pressable` / `Button`; React state used only to render the disabled or busy look while a ref or the owner's state machine is the actual guard.

## async/guard-released-on-every-path

Scope: `repository-wide`

A busy flag released only on the happy path wedges the action forever after one throw or early return.

Does `hunk` set a busy, in-flight, locked or posting flag before awaited work and clear it with plain statements after the `await` (or in only some branches), so that a thrown error or an early `return` between set and clear leaves the flag set?

Allowed cases: The release is in a `finally` block; every exit path visibly clears the flag and the awaited calls return `Result` values and cannot throw; a stale-generation path that deliberately leaves the newer generation's flag untouched (the `isStaleGeneration` returns in `createMachine.ts`); a flag owned by a state machine whose transitions release it.

## async/guard-covers-effect

Scope: `repository-wide`

A single-flight guard protects only what the guarded function awaits; a detached effect escapes it.

Does `hunk` pass a handler to `useSingleFlight`, `useKeyedSingleFlight`, the shared `Pressable` / `Button`, or a hand-written busy guard, where the handler starts a pay, send, melt, mint, publish or other side effect with `void …`, an un-awaited call or a `.then(` chain it does not return — so the guard is released while the effect is still running — or releases the guard before the operation's pending record is durably written?

Allowed cases: The handler awaits or returns the effect's promise; the effect is handed to an owner that has its own re-entry guard (a payment machine event, `publishEvent`'s in-flight map); detached work that is not the guarded effect (haptics, logging, navigation, analytics).

## async/coco-listeners

Scope: `app/**/*.{ts,tsx}`, `wallet/**/*.{ts,tsx}`

Coco's event bus awaits every listener one after another, so a listener that awaits I/O stalls the wallet operation that emitted the event, and a listener that throws is swallowed by Coco's own logger.

Does `hunk` register a Coco manager listener (`manager.on(`, `manager.once(`, an `on('proofs:saved' | 'history:updated' | 'mint-op:…' | 'melt-op:…' | 'send:…' | 'receive-op:…' | 'mint:…' …)` handler) that is an `async` function or returns a promise which awaits network, storage, database or Nostr work, or that can throw without catching and logging the failure itself?

Allowed cases: A synchronous handler that updates in-memory state; a handler that detaches its async work and handles its failure (`void load()`, `void (async () => { try … catch … })()`, a `.catch(` that logs through the logger), as `mintTestnutRefresh.ts` and `createSovranScreenActionsBridge.ts` do; work that must finish before the operation continues and is documented as such.

## async/unbounded-fanout

Scope: `repository-wide`

Mapping a user-sized list straight into concurrent requests opens as many sockets as the list is long.

Does `hunk` start one network, relay, mint or database request per element of a list whose size the user or the network controls — contacts, follows, relays, events, proofs, history entries, discovered mints — with `list.map(async …)` / `Promise.all` / `allSettled` and no chunking, slicing or concurrency limit?

Allowed cases: Lists bounded by design (the user's trusted mints, a fixed relay set, a page already capped by a schema `.max()` or a `slice(0, N)`); chunked loops (`for (i += MINT_INFO_MAX_URLS)` in `mintTestnutRefresh.ts`); a bulk endpoint that takes the whole list in one request; work behind a queue or pool that limits concurrency.

## async/sleep-ignores-cancel

Scope: `repository-wide`

A poll or backoff loop built on a bare timer promise keeps doing work after its owner cancelled.

Does `hunk` add a polling, retry or backoff loop that waits with `await new Promise((r) => setTimeout(r, …))` (or a `sleep`/`delay` helper) and then performs network, wallet or state work without re-checking an `AbortSignal`, generation id, `isActive()` callback or mounted/focused flag after each wake-up?

Allowed cases: The loop checks cancellation after every wait and before every effect; a bounded loop inside a wallet operation that must finish regardless of the screen (history linkage polling in `executeAutoRedeem`) and writes only to its own operation's record; test code; tooling under `app/codereview` and `app/scripts`.

## async/check-then-act

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,melt,swap,balance,proofs}/**/*.{ts,tsx}`, `**/stores/**/*.{ts,tsx}`

A balance, proof set, quote state or active mint read before an `await` may no longer be true after it.

Does `hunk` read a balance, proof list, quote or operation state, active mint, unit or profile into a local, `await` something, and then spend, select, send, persist or decide with the pre-await value — with no re-read, no lock or single-flight held across both steps, and no generation check?

Allowed cases: The check and the act happen inside one Coco or wallet operation that owns the lock (proof reservation, `sendLocked`, a prepared operation); the value is re-read or re-validated after the `await`; the snapshot is the deliberate identity of the flow (the mint and unit captured at flow start, compared by `isStaleGeneration` or a profile-id check); display-only values.

## async/intent-before-effect

Scope: `wallet/**/*.{ts,tsx}`, `**/{cashu,wallet,payment,payments,mint,mints,send,receive,melt,swap,nfc,nearPay}/**/*.{ts,tsx}`

If the app dies between a payment effect and the write that records it, only a record written first lets the next launch reconcile.

Does `hunk` perform an irreversible effect (melt, swap, send, token hand-off over NFC/BLE/Nostr, mint-quote payment) and only afterwards create the persisted record that identifies the operation, or create that record with a fire-and-forget write that is not awaited before the effect starts?

Allowed cases: A pending or prepared record is awaited before the effect and updated after it; the effect runs inside a Coco operation that journals itself; records that are pure presentation (toasts, optimistic list rows) whose loss costs nothing; idempotent reads.

## errors/catch-cannot-catch-result

Scope: `repository-wide`

`try/catch` around a Result-returning call catches nothing, so failure handling placed in the `catch` is dead code and the failure continues down the happy path.

Does `hunk` wrap calls that return `Result`, `ResultAsync` or `Promise<Result>` (`fetchJson`, facade reads, `openExternalUrl`, wallet effects built with `ResultAsync.fromThrowable`) in `try/catch` and put the user-visible or state-changing failure handling only in the `catch`, while the returned value's `isErr()` branch is missing?

Allowed cases: The result is checked with `isErr`/`match` and the `try/catch` exists for other throwing statements in the same block; `catch` that only guards programmer errors and rethrows; functions that genuinely reject (Coco manager calls, cashu-ts, native modules).

## errors/one-error-channel

Scope: `repository-wide`

A function that returns `Result` but can also throw forces every caller to handle two channels, and callers written against the signature handle only one.

Does `hunk` add or change a function whose declared return type is `Result<…>`, `ResultAsync<…>` or `Promise<Result<…>>` so that its body can still throw or reject — a `throw` statement, or a throwing call (`JSON.parse`, `new URL`, `BigInt(`, a decoder, an awaited SDK or native call) that is not inside a `try/catch` or `fromThrowable`/`fromPromise` wrapper?

Allowed cases: The whole body is inside `try/catch` that returns `err(…)` (as `fetchJson` does); every throwing call is wrapped; throws that signal programmer error only (`assertNever`, invariant checks on in-process values); functions that do not claim a `Result` type (the house allows ordinary throwing functions and `try/catch`).

## errors/default-hides-failure

Scope: `repository-wide`

Collapsing an `Err` into a normal-looking default makes "could not read" indistinguishable from "empty" or "zero".

Does `hunk` turn the failure of a read of a balance, amount, proof or transaction list, trust or permission flag, backup or consent status into an ordinary value with `.unwrapOr(0 | [] | false | '' | {})`, `.orElse(() => ok(default))`, `.match(v => v, () => default)` or `isErr() ? default : value`, where that value is then shown, persisted or used for a decision?

Allowed cases: The default is a distinct "unavailable" state (`{ status: 'unavailable' }` in `publishOwnProfileMetadata.ts`), `undefined` or `null` that the UI renders as a placeholder; presentational fallbacks (an npub that falls back to the hex it was derived from, an optional icon, a display label); the error is logged and the caller still receives a failure signal by another field.

## errors/non-error-throwables

Scope: `repository-wide`

This codebase and its libraries throw plain objects and strings; a `catch` that only understands `Error` loses them.

Does `hunk` handle a caught value or a rejected promise so that a non-`Error` throwable is dropped or flattened — `if (e instanceof Error) { … }` with no `else`, `(e as Error).message`, `e.message` on `unknown`, or `e instanceof Error ? e.message : String(e)` feeding a value that code (not just display) relies on, which yields `"[object Object]"` for a thrown `{ code, detail }` or `{ type: 'no-ndk' }`?

Allowed cases: The value goes through a house normaliser that keeps object fields (`errField`, `redactError`, `toError`, a named `classify*` function that reads `code`/`status`/`type`); the non-Error branch is handled explicitly (`typeof e === 'object' && e !== null && 'type' in e`); the string is produced only for display or as the message of a log call that also receives the error object; abort detection through `isAbortError`.

## errors/serialized-error

Scope: `repository-wide`

`JSON.stringify(error)` is `{}` and a persisted or cloned `Error` comes back as a plain object without message, name, cause or prototype.

Does `hunk` serialise, persist or clone an `Error` (or an object holding a caught error under `error`, `cause`, `lastError`) with `JSON.stringify`, object spread, `structuredClone`, a Zustand `persist` field, AsyncStorage/SQLite text, or a Nostr/HTTP payload, and later rely on its `message`, `name`, `cause`, `status` or `instanceof`?

Allowed cases: The error is first mapped to a plain typed record (`{ kind, code, status, message }`) or through `errField` / `redactError`; the logger receiving the error object itself (it serialises errors on its own); a fixed string code stored instead of the error.

## errors/subclass-name

Scope: `repository-wide`

Wallet and Nostr classifiers recognise errors by `err.name` so they survive duplicated packages, and a subclass that never sets `name` reports `"Error"`.

Does `hunk` declare `class … extends Error` without assigning `name` (`this.name = '…'`, a `name` class field or `override readonly name`), or check an error by `err.name === '…'` / `constructor.name` against a class that does not set it?

Allowed cases: The constructor or a class field sets `name` to the class's literal name (as `wallet/src/errors.ts` does); test doubles; classes that are only ever matched with `instanceof` inside the same module and never logged or classified by name.

## errors/aggregate-causes

Scope: `repository-wide`

`Promise.any` and Coco's `throwOnError` emit reject with an `AggregateError` whose message is generic; the real failures are in `.errors`.

Does `hunk` catch, log, map or classify the rejection of `Promise.any(` (or a Coco emit/restore error documented as an `AggregateError`) using only `.message` / the error itself, without reading `.errors`, so that every per-relay or per-handler cause is lost?

Allowed cases: `.errors` is logged or mapped (duck-typed on `Array.isArray(e.errors)` as `app/shared/lib/cashu/managerInternals.ts` does, not `instanceof AggregateError`); the rejection is only turned into a user-facing "could not send" with the aggregate passed to the logger as the error object.

## net/status-before-body

Scope: `repository-wide`

`fetch` resolves on 4xx/5xx; parsing the body first either throws a `SyntaxError` that hides the status or treats an error body as data.

Does `hunk` call `.json()`, `.text()`, `.arrayBuffer()` or `.blob()` on a `fetch`/`safeFetch` response, or pass the body to a parser, before checking `response.ok` or `response.status` on that path?

Allowed cases: `fetchJson`, which checks `res.ok` first; reading the body of a known-failed response to extract a typed protocol error (a NUT error `code`, an LNURL `{ status: 'ERROR' }`) inside a guarded parse; endpoints whose contract is a 200 with an in-band status field, validated by a schema; streaming handlers that checked the status before opening the stream.

## net/url-composition

Scope: `repository-wide`

A URL assembled from strings lets a value rewrite the path, the query or the host.

Does `hunk` (a) interpolate or concatenate a value that comes from user input, a relay, a mint, a QR code, a deep link or route params into a URL path or query without `encodeURIComponent` or `URL.searchParams`, (b) decide whether a URL belongs to an allowed host with `startsWith(` / `includes(` on the string instead of comparing `new URL(x).origin` or `.host`, or (c) join a path onto a mint or server base with `new URL('/…', base)` or `new URL('…', baseWithoutTrailingSlash)`, which drops the base path?

Allowed cases: Values already validated as hex ids, numbers or enum members (`protocolIds`, a Zod-parsed integer `limit`); `encodeURIComponent` / `searchParams.set` (as the `apiClient.ts` query builders use); scheme checks such as `startsWith('https://')` that gate transport only and are followed by a `new URL` host check where the host matters; module constants; `nostr/src/transport.ts`, which normalises base and path itself.

## input/numeric-strings

Scope: `repository-wide`

JavaScript's number parsers accept far more than digits: `Number('')` is `0`, `Number('1e3')` is `1000`, `parseInt('12abc')` is `12`, and anything above 2^53 silently changes value.

Does `hunk` convert an untrusted string or bigint — typed text, a route param, a relay tag, a mint or LNURL response field, a BOLT11 section, a token amount — into an amount, count, timestamp or index with `Number(`, unary `+`, `parseInt(` or `parseFloat(`, without first checking a digits-only pattern (or `typeof` for non-strings) and `Number.isSafeInteger` on the result?

Allowed cases: The value passes a Zod schema that already enforces `int()`, bounds and safe range (`z.number().int().nonnegative()`, `z.coerce` behind a non-empty digits check); `amountToNumber` in `wallet/src/amount.ts` and `wallet/src/amount-actions`, which own amount parsing; `parseInt(x, 10)` of values that are digits by construction (a regex capture of `\d+`, `Platform.Version`); display-only numbers; BigInt arithmetic that never narrows to `number`.

## tests/async-assertion-settled

Scope: `app/**/__tests__/**/*.{ts,tsx}`, `app/**/*.test.{ts,tsx}`

Under Jest 30 an un-awaited `.rejects` / `.resolves` assertion lets its own test pass; the failure is then blamed on the next test, or crashes the runner without naming any test.

Does a Jest test in `hunk` create an `expect(promise).rejects…` or `.resolves…` assertion, or put `expect(…)` inside a `.then(` / `.catch(` / `forEach(async` callback, that is neither awaited, returned, nor stored in a variable that is awaited before the test ends?

Allowed cases: `await expect(p).rejects…`; `return expect(…)`; the house fake-timer idiom `const assertion = expect(p).rejects.toThrow(…); await jest.advanceTimersByTimeAsync(…); await assertion;` (as in `drainSqlite.test.ts` and `moderationRelay.test.ts`); Vitest and Bun test files, whose runners wait for pending assertions themselves.

## tests/assertion-always-runs

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

An `expect` that lives only inside a `catch`, a callback or a branch proves nothing when that path is never taken.

Does a test in `hunk` place all assertions for a behaviour inside a `catch` block, an event or subscription callback, or an `if` branch, with no `expect.assertions(n)` / `expect.hasAssertions()`, no `.rejects` form and no unconditional assertion that forces that path to have run?

Allowed cases: The Result-narrowing idiom where an unconditional assertion precedes the branch (`expect(result.isOk()).toBe(true); if (result.isOk()) expect(result.value)…`, `expect(outcome.kind).toBe('answered'); if (outcome.kind === 'answered') …`); callbacks whose invocation is asserted separately (`expect(onEvent).toHaveBeenCalledTimes(1)`); `await expect(fn()).rejects…`.

## tests/throw-assertion-on-async

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

An async function never throws synchronously, so `toThrow` on it cannot pass and `not.toThrow` cannot fail.

Does a test in `hunk` assert `expect(() => asyncFn(…)).not.toThrow()`, `expect(asyncFn).not.toThrow()` or `expect(async () => …).toThrow(…)` for a function that is `async` or returns a promise or `ResultAsync`?

Allowed cases: `await expect(asyncFn()).rejects.toThrow(…)` / `.resolves`; `not.toThrow` on genuinely synchronous calls (an unsubscribe function, `JSON.stringify`, a synchronous emitter); Result-returning functions asserted through `isOk`/`isErr`.

## tests/fake-timers-with-promises

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

Synchronous timer advances do not run the promise continuations between timers, so retry, backoff and polling code stops after its first step; modern fake timers also freeze `Date.now()` and `performance.now()`.

Does a test in `hunk` drive code that awaits between timers (retry or backoff loops, polling, a timeout raced against a request, `setTimeout` inside an `async` function) with `advanceTimersByTime(`, `runAllTimers()` or `runOnlyPendingTimers()` instead of the `…Async` variants, or expect `setSystemTime(` to fire pending timers?

Allowed cases: `await jest.advanceTimersByTimeAsync(…)` / `vi.advanceTimersByTimeAsync(…)` / `runAllTimersAsync()`; a synchronous advance wrapped in `act(() => …)` whose only consumer is a timer callback that sets React state, with no promise in the chain; debounce and animation timers with synchronous callbacks.

## tests/restore-global-fakes

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

Neither the Jest nor the Vitest config restores mocks, so fake timers, a mocked `Date.now`, `Math.random` or `global.fetch` leak into the following tests of the file unless restored on every path; `clearAllMocks` keeps mock implementations.

Does a test in `hunk` install fake timers, `setSystemTime`, `spyOn(Date | Math | console | global, …)` or assign `global.fetch` / `Date.now`, and restore it only with statements at the end of the test body (skipped when an assertion fails), only with `clearAllMocks()`, or not at all in the visible file section?

Allowed cases: Restoration in `afterEach` / `afterAll` / a `try … finally`: `useRealTimers()`, `restoreAllMocks()`, `mockRestore()`, reassigning the saved original; a file-level `beforeEach(useFakeTimers)` paired with `afterEach(useRealTimers)`; spies created by a helper that registers its own cleanup.

## tests/singleton-state-reset

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

Stores, caches and in-flight maps are module singletons, so state written by one test is still there in the next and the file only passes in its current order.

Does a test in `hunk` write to a module-level singleton — `useXStore.setState(…)`, a store action, a module cache, an in-flight map, a registered Coco/Nostr listener — without a `beforeEach` / `afterEach` in the file that resets it, or assert a starting value that only holds when an earlier test ran (or did not run) first?

Allowed cases: `beforeEach(() => useXStore.setState(initial, true))`, a store `reset()` action or `getInitialState()`; state created inside the test (a fresh manager, a store factory, a new `Map`); `jest.isolateModules` / `vi.resetModules` with the module re-imported afterwards.

## tests/reset-modules-reimport

Scope: `**/__tests__/**/*.{ts,tsx}`, `**/*.test.{ts,tsx}`

After `resetModules()` the file's top-level imports still point at the old module instances, so the test can configure one instance and assert on another.

Does a test in `hunk` call `jest.resetModules()` / `vi.resetModules()` (or `isolateModules`) and then keep using a binding imported at the top of the file for the module under test, or for a collaborator whose state or mock it sets up or asserts on?

Allowed cases: The module under test and every collaborator the test touches are re-acquired after the reset with `require(…)` / `await import(…)`; top-level imports of pure constants, types and test helpers that hold no state.

## tests/renderer-inside-act

Scope: `app/**/__tests__/**/*.{ts,tsx}`, `app/**/*.test.{ts,tsx}`

With React 19, `react-test-renderer` renders nothing until `act` flushes it: a tree created outside `act` is `null`, so absence assertions pass without the component ever rendering.

Does a test in `hunk` call `TestRenderer.create(`, `renderer.update(`, `renderer.unmount(` or a state-changing prop callback (`props.onPress()`, `props.onChangeText()`) outside `act(…)` / `await act(async …)`, and then assert on `toJSON()`, `root.findAll…` results, or the absence of an element?

Allowed cases: The call is inside `act`; `@testing-library/react-native` `render`, `fireEvent`, `renderHook`, which wrap `act` themselves; a test whose purpose is to observe the pre-flush state and says so.
