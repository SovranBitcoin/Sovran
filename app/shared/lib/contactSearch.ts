/**
 * Shared policy for contact ("People") search.
 *
 * A leaf module on purpose. The threshold is enforced by
 * `features/payments/hooks/useContactSearch` and read by five other surfaces,
 * including `shared/ui/composed/search` — and `shared` must not import from
 * `features`. Keeping it here also means a screen that only needs the number
 * does not pull the search hook's `nostr-tools` graph in behind it.
 */

/** Minimum trimmed query length before a contact search runs. */
export const CONTACT_SEARCH_MIN_LENGTH = 3;
