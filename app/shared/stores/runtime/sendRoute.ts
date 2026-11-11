import type { ContactSendTarget } from './contactSendStore';
import type { NearPayRecipient } from './nearPayStore';

/**
 * Where a bearer ecash send goes once its token exists, read from the routing
 * context its entry point set (`clearPaymentContext` clears both at every
 * root): to a nearby phone over the mesh, to a contact as a Nostr message, or
 * handed over on screen. The amount screen says which before the send and
 * `sendComplete` acts on it after, both from this one value.
 */
type SendRoute =
  | { kind: 'nearby'; recipient: NearPayRecipient }
  | { kind: 'contact'; target: ContactSendTarget }
  | { kind: 'handOff' };

/**
 * The route for a send. No entry point sets both a nearby recipient and a
 * contact; were both set, the nearby recipient wins, as the amount screen has
 * always shown it.
 */
export function sendRouteOf(context: {
  nearby: NearPayRecipient | null;
  contact: ContactSendTarget | null;
}): SendRoute {
  if (context.nearby) return { kind: 'nearby', recipient: context.nearby };
  if (context.contact) return { kind: 'contact', target: context.contact };
  return { kind: 'handOff' };
}
