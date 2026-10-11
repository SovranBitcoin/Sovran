/**
 * Holds a `nostrconnect://` link from the moment the system hands it to the
 * app until the connect route opens it. The link embeds the pairing secret,
 * so it stays here, in memory, and the route is given only a ticket: a route
 * param lives on in navigation state and history.
 *
 * One slot. A second link replaces the first, and a ticket is good once.
 * Imported by `+native-intent`, which must never throw: keep this free of
 * imports and of anything that can fail.
 */
let pending: { ticket: string; uri: string } | null = null;
let issued = 0;

/** Keep the link and return the ticket that redeems it. */
export function holdPairingUri(uri: string): string {
  issued += 1;
  const ticket = String(issued);
  pending = { ticket, uri };
  return ticket;
}

/** The link held for this ticket, removed from the slot. Null when there is none. */
export function takePairingUri(ticket: string): string | null {
  if (pending?.ticket !== ticket) return null;
  const { uri } = pending;
  pending = null;
  return uri;
}
