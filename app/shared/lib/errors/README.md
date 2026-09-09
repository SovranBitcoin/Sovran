# User-facing service errors

This module owns translations of upstream failures into Sovran UI copy. Improve
an existing message in `catalog.ts`; every caller using that message benefits.
`describeError(error, service)` returns a stable `{ id, text }`. It is a total
presentation formatter: unknown or unreadable values get a curated fallback.
The inspector uses `neverthrow` to contain failures while reading SDK objects.

Use the original error at the presentation boundary:

```ts
staticPopup('send-message-failed', {
  failure: { service: 'routstr', error },
});

// Inline error text uses exactly the same catalog.
const { text } = describeError(error, 'nagg');
```

`failure` is supported by `popup`, `staticPopup`, and `paramPopup`, for both
toasts and sheets. It takes precedence over `text`. The popup log records the
stable message ID and service, never the error object. Use `text` for intentional
application copy (validation, progress, confirmed outcomes), not raw exceptions.

Choose the service from the operation, not by guessing from a message:

| Service   | Scope                                                                       |
| --------- | --------------------------------------------------------------------------- |
| `routstr` | AI completion, balance and credit requests                                  |
| `cashu`   | Wallet/Coco operations and Cashu mint responses, including CDK and Nutshell |
| `nostr`   | Relay reads, signing, publishing and direct messages                        |
| `nagg`    | App-view/backend requests and response validation                           |
| `app`     | Other application failures                                                  |

## Adding or correcting a translation

1. Capture a sanitized example and identify the producing SDK/server and version.
   Verify the code's meaning in that source. Do not store real tokens, keys,
   invoices, messages, or request bodies in fixtures.
2. Preserve structured fields (`code`, `status`, `type`, `cause`) through wrappers.
   Do not flatten an error to its message before calling the formatter. Legacy
   payment callbacks that expose only strings use narrowly scoped fallback rules.
3. Add or update the stable ID and copy in `catalog.ts`. Add classification in
   `index.ts` only when the existing code/type/status rules cannot identify it.
   `inspect.ts` handles known envelopes and bounded, cycle-safe cause traversal.
4. Add a regression in `app/__tests__/serviceErrors.test.ts`, including other
   services that must not match. For wrapped errors, use the installed Coco
   constructors; for mint differences, add CDK and Nutshell response fixtures.
   Tests for popup rendering, payment status and the real Routstr adapter cover
   the paths into this module.
5. Run the focused tests from `sovran-app/app`:

   ```sh
   bun run test -- serviceErrors serviceErrorPopup paymentStatusStore routstr402BalanceSync --runInBand
   ```

Never feed display text or presentation IDs back into retries, payment state,
refunds, balance accounting, or recovery. These remain owned by their existing
SDK/state-machine code. Preserve original errors for existing redacted logs.
Do not automatically retry because a message suggests waiting. Do not infer
that an interrupted payment failed, funds were returned, or a balance is zero.
Unknown messages never pass through to the user.

## Cashu, Coco, CDK and Nutshell

The installed Coco 2.0.0 reexports cashu-ts 5.0.0-rc.4 errors. A
`MintOperationError` carries a numeric Cashu `code`, HTTP `status`, and a
`message` derived from mint `detail`. Coco errors such as `MintFetchError` and
`ProofOperationError` can wrap that error in `cause`. Follow the cause and prefer
the Cashu code over generic HTTP 400 and wrapper prose. Never interpret a Cashu
code outside the `cashu` service, or infer the mint implementation from a code.
Unknown numeric mint codes stay generic even if their detail resembles a known
error. Mixed aggregate failures stay generic; one child's status cannot explain
an entire operation.

Source references checked 2026-09-10:

- [NUT error registry](https://github.com/cashubtc/nuts/blob/main/error_codes.md)
- [Nutshell error definitions](https://github.com/cashubtc/nutshell/blob/main/cashu/core/errors.py)
- [CDK error mappings](https://github.com/cashubtc/cdk/blob/main/crates/cdk-common/src/error.rs)
- Installed `@cashu/coco-core` and `@cashu/cashu-ts` package error constructors.
- [Routstr API endpoints](https://docs.routstr.com/api/endpoints/)
- [NIP-01 relay messages](https://github.com/nostr-protocol/nips/blob/master/01.md)
- In-repo Nagg discriminants in `nostr/src/errors.ts` and Nostr publish errors in
  `app/shared/lib/nostr/publish/types.ts`.

Important distinctions encoded in the copy:

- `20002` means ecash was already issued for a quote, not merely that an invoice
  was paid.
- CDK can use `20003` for disabled melting as well as minting.
- CDK can use `20006` for a duplicate invoice that is paid **or pending**.
- CDK maps NUT-11 witness failures to `20008` too. Do not assume a mint-quote-only
  signature error or claim that the ecash belongs to another person.
- A generic Lightning failure does not prove a routing problem. Signed outputs
  do not justify blindly retrying a payment.
- Generic Routstr 404 means the requested model or endpoint was not found. A
  single response cannot establish a whole-provider outage. Explicit model codes
  get different guidance. Authentication/payment failures keep their own meaning.

## Connected surfaces

AI sends and top-ups; payment status toasts and payment failure/cancellation
popups; mint transfers; wallet recovery; Nostr DMs and engagement publishing;
Nagg notification and mint-change loading all use this module. Local validation,
confirmed operation-state copy, NFC-specific prompts, and success/progress copy
remain with their owning features. New upstream error surfaces should use
`failure` or `describeError` rather than creating another message map.
