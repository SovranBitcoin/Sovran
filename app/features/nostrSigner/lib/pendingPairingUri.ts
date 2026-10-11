/**
 * Holds a `nostrconnect://` link from the moment the system hands it to the
 * app until the connect route opens it. The link embeds the pairing secret,
 * so it stays here, in memory, and the route is given only a ticket: a route
 * param lives on in navigation state and history.
 *
 * One slot. A second link replaces the first; the same link handed over twice
 * (a cold start can deliver it as the initial URL and again as an event) keeps
 * its ticket. A ticket is good once, cannot be guessed by another app, and
 * lapses, so a link nobody opened is not left waiting for a later account.
 *
 * Imported by `+native-intent`, which must never throw: keep this free of
 * imports and of anything that can fail.
 */
const HELD_FOR_MS = 5 * 60_000;

let pending: { ticket: string; uri: string; heldAt: number } | null = null;
let issued = 0;

/** Keep the link and return the ticket that redeems it. */
export function holdPairingUri(uri: string): string {
  if (pending?.uri === uri) {
    pending.heldAt = Date.now();
    return pending.ticket;
  }
  issued += 1;
  const ticket = `${issued}${Math.random().toString(36).slice(2, 12)}`;
  pending = { ticket, uri, heldAt: Date.now() };
  return ticket;
}

/** The link held for this ticket, removed from the slot. Null when there is none. */
export function takePairingUri(ticket: string): string | null {
  if (pending?.ticket !== ticket) return null;
  const { uri, heldAt } = pending;
  pending = null;
  return Date.now() - heldAt > HELD_FOR_MS ? null : uri;
}
