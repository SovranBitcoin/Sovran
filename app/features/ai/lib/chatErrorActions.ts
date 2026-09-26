/**
 * What a failed AI turn offers the user, decided from the error catalogue id
 * alone.
 *
 * `describeError(error, 'routstr')` already did the classification work: it
 * turns an unknown thrown value into a stable `ErrorId` plus curated copy.
 * This module is the second half of that contract — the id says *what went
 * wrong*, and this says *what the user can do about it*. Nothing here reads a
 * message, a status or an upstream body; adding another way to classify an
 * error belongs in `shared/lib/errors`, not here.
 *
 * The table is total over `ChatErrorId` by construction, so a new
 * `routstr.*` id in the catalogue fails the type-check here until someone
 * decides what it offers. That is the point: an id with no answer would
 * otherwise silently fall through to a bare "Retry" that cannot help.
 */
import type { ErrorId } from '@/shared/lib/errors/catalog';

/**
 * Every id `describeError(…, 'routstr')` can return.
 *
 * The `routstr.*` half is derived from the catalogue so it can never drift.
 * The three bare ids are the generic ones the routstr path still reaches:
 * `cancelled` (its `TRANSPORT_COPY` entry for an abort), `forbidden` (HTTP
 * 403, which routstr does not override) and `rate_limited` (HTTP 429 and the
 * `RateLimitError` type rule). Every other generic id is shadowed by a
 * `routstr.*` one in `SOURCE_HTTP` / `TRANSPORT_COPY`.
 */
export type ChatErrorId =
  Extract<ErrorId, `routstr.${string}`> | 'cancelled' | 'forbidden' | 'rate_limited';

/**
 * The four things a user can do about a failed turn from inside the chat.
 * Each one has an existing destination — the send flow's retry, the model
 * picker, the AI provider list and the wallet's receive flow — so this stays
 * a vocabulary, not a feature list.
 */
export type ChatErrorActionId = 'retry' | 'change-model' | 'change-provider' | 'top-up';

/**
 * Ordered, most-likely-to-help first: the leading action is the one whose copy
 * in `ERROR_COPY` leads, so the pill's buttons read in the same order as the
 * sentence above them.
 */
const CHAT_ERROR_ACTIONS: Readonly<Record<ChatErrorId, readonly ChatErrorActionId[]>> = {
  // Our AI credit cannot cover the request. Only money fixes it, and a cheaper
  // model is the free way to spend less. Retrying spends nothing and changes
  // nothing, so it is deliberately absent.
  'routstr.balance': ['top-up', 'change-model'],
  // The node would not take our credit key at all. A different provider mints
  // a fresh payment; a retry against the same one repeats the refusal, so it
  // trails rather than leads.
  'routstr.auth': ['change-provider', 'retry'],
  // The model is gone from this node's catalogue. Only another model helps.
  'routstr.model_unavailable': ['change-model'],
  // The node rejected this message or its attachments. Re-sending the same
  // bytes cannot pass; a model with a larger window or vision support can.
  'routstr.invalid_request': ['change-model'],
  // An upstream 402 the node forwarded verbatim: the provider behind this
  // model declined. Another model usually sits behind another account.
  'routstr.provider_declined': ['change-model', 'retry'],
  // One chosen provider, and it refused. Switching provider is the action the
  // copy names; a retry is worth one tap because a refusal can be momentary.
  'routstr.provider_refused': ['change-provider', 'retry'],
  // Our own verdict after walking every candidate. The shortlist itself is
  // what has to change — the model first, then who serves it.
  'routstr.no_providers': ['change-model', 'change-provider'],
  // Nothing was ever chosen. There is exactly one thing to do.
  'routstr.no_provider': ['change-provider'],
  // The catalogue never arrived, so there was no model id to send. A retry
  // re-resolves it once the fetch lands; another provider serves its own.
  'routstr.catalog_unavailable': ['retry', 'change-provider'],
  // No retry: the same node answers the same. Only the shortlist can change.
  'routstr.no_usable_models': ['change-provider', 'change-model'],
  // This node serves no encrypted model. Both offers are a deliberate choice
  // the user has to make: another provider may run an enclave, and the model
  // picker is where they would knowingly drop to an unencrypted model.
  // Retry is absent — the same node answers the same way, and a retry that
  // silently landed somewhere plaintext is the whole failure being fixed.
  'routstr.e2ee_unavailable': ['change-provider', 'change-model'],
  // The node answered; the model service behind it failed. Retrying the same
  // model usually repeats it, so another model leads.
  'routstr.upstream_failed': ['change-model', 'retry'],
  // The provider takes none of our mints. Retrying re-runs the same mismatch.
  'routstr.mint_not_accepted': ['change-provider'],
  // Our mint could not settle the payment. A provider that accepts another of
  // our mints sidesteps it; the mint may also just have been busy.
  'routstr.mint_refused': ['change-provider', 'retry'],
  // Transport-shaped: the node was unreachable or answered 404. Try it again,
  // then try someone else.
  'routstr.not_found': ['retry', 'change-provider'],
  'routstr.unavailable': ['retry', 'change-provider'],
  // Slow, not broken.
  'routstr.timeout': ['retry'],
  // The node kept working after the connection dropped and holds the change.
  // Nothing here needs changing; the same request can simply be sent again.
  'routstr.change_pending': ['retry'],
  // Unclassified. Retry is the only honest offer — anything else would claim
  // we know which knob is wrong.
  'routstr.unknown': ['retry'],
  // The send was abandoned. The turn is intact, so re-running it is the whole
  // recovery. (The send flow drops aborted turns before they reach a pill;
  // this entry exists so the table stays total.)
  cancelled: ['retry'],
  // 403: this node will not serve us, whatever we ask it.
  forbidden: ['change-provider'],
  // 429: the same request will work shortly.
  rate_limited: ['retry'],
};

/**
 * A total record is a valid partial one, so this widening needs no cast — and
 * indexing it with any `ErrorId` is typed as possibly-absent, which is what
 * makes the fallback below reachable code rather than a lie.
 */
const BY_ERROR_ID: Readonly<Partial<Record<ErrorId, readonly ChatErrorActionId[]>>> =
  CHAT_ERROR_ACTIONS;

/** Reserved for ids outside the chat's vocabulary (a cashu or nostr id routed
 *  here by mistake). Retry is the one offer that is true of any failure. */
const FALLBACK_ACTIONS: readonly ChatErrorActionId[] = ['retry'];

/** Actions to offer for a failed AI turn. Pure: same id, same answer. */
export function chatErrorActions(id: ErrorId): readonly ChatErrorActionId[] {
  return BY_ERROR_ID[id] ?? FALLBACK_ACTIONS;
}

/** What each action calls itself, on the button and to a screen reader. */
export const CHAT_ERROR_ACTION_LABELS: Readonly<Record<ChatErrorActionId, string>> = {
  retry: 'Retry',
  'change-model': 'Change Model',
  'change-provider': 'Change Provider',
  'top-up': 'Top up',
};
