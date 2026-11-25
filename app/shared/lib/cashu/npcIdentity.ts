import type { NostrClient } from 'nostr/client';
import { validateEvent } from 'nostr-tools/pure';
import { getToken } from 'nostr-tools/nip98';
import { z } from 'zod';
import { verifyNip05 } from 'wallet';
import { safeFetch, withTimeout } from 'wallet/safeFetch';
import { NPC_BASE_URL, NPC_DOMAIN } from './npc';

const UserInfo = z.object({
  error: z.literal(false),
  data: z.object({ user: z.object({ pubkey: z.string(), name: z.string().optional() }) }),
});
type NpcIdentityResult =
  | { status: 'verified'; identifier: string }
  | { status: 'no-username' | 'unverified' | 'unavailable' };

/** Read an existing username; this never registers or purchases one. */
export async function loadNpcIdentity(
  client: NostrClient,
  pubkey: string,
  signal: AbortSignal
): Promise<NpcIdentityResult> {
  const signer = client.signer;
  if (!signer || signal.aborted) return { status: 'unavailable' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  const current = () => !controller.signal.aborted && client.signer === signer;
  try {
    return await withTimeout(
      (async (): Promise<NpcIdentityResult> => {
        const url = `${NPC_BASE_URL}/api/v2/user/info`;
        const authorization = await getToken(
          url,
          'GET',
          async (template) => {
            if (signer.pubkey !== pubkey || !current()) throw new Error('Profile changed');
            const event = signer.sign({ ...template, pubkey });
            if (!current() || event.pubkey !== pubkey) throw new Error('Profile changed');
            if (!validateEvent(event)) throw new Error('Invalid signed event');
            return event;
          },
          true
        );
        if (!current()) return { status: 'unavailable' };
        const response = await safeFetch(
          url,
          { signal: controller.signal, timeoutMs: 5_000 },
          {
            headers: { Authorization: authorization },
            redirect: 'error',
            credentials: 'omit',
          }
        );
        if (!response.ok || response.redirected || (response.url && response.url !== url))
          return { status: 'unavailable' };
        const parsed = UserInfo.safeParse(await response.json());
        if (!current() || !parsed.success || parsed.data.data.user.pubkey !== pubkey)
          return { status: 'unavailable' };
        const username = parsed.data.data.user.name?.trim();
        if (!username) return { status: 'no-username' };
        const verified = await verifyNip05(`${username}@${NPC_DOMAIN}`, pubkey, {
          signal: controller.signal,
        });
        return current() && verified.status === 'verified' ? verified : { status: 'unverified' };
      })(),
      12_000,
      'npc.identity'
    );
  } catch {
    // Authentication failures are presented without credentials or raw server errors.
    return { status: 'unavailable' };
  } finally {
    controller.abort();
    signal.removeEventListener('abort', abort);
  }
}
