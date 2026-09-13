import type NDK from '@nostr-dev-kit/ndk-mobile';
import {
  createNaggClient,
  facade,
  recipes,
  NaggProfilesEnvelopeSchema,
  type NaggProfilesEnvelope,
} from 'nostr';
import { z } from 'zod';
import { ResultAsync } from 'neverthrow';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { getVertexBudgetStore } from '@/shared/stores/profile/vertexBudgetStore';
import { getNostrTierConfig } from '@/shared/lib/nostr/nostrTierConfig';
import { nostrLog } from '@/shared/lib/logger';
import { signVertexRequest, vertexAutomationDisabled } from './signVertexRequest';

const responseSchema = z.union([recipes.VertexFailureSchema, NaggProfilesEnvelopeSchema]);
// In-memory only: never persist lookup targets or query text. Bound by the daily cap.
const attempted = new Map<string, Set<string>>();
const activePubkey = () => {
  const state = useProfileStore.getState();
  return state.profiles.find((p) => p.accountIndex === state.activeAccountIndex)?.pubkey;
};
const enabled = () =>
  useSettingsStore.getState().vertexCreditsEnabled &&
  getNostrTierConfig().nagg.enabled &&
  !vertexAutomationDisabled();

export function isVertexProfileStale(fetchedAt?: number | null): boolean {
  return fetchedAt == null || fetchedAt * 1000 <= Date.now() - 7 * 86_400_000;
}

/** Consent, hydration, identity, dedup and budget have one owner for both surfaces. */
export async function refreshVertex(
  input: Omit<facade.VertexRequestInput, 'kind'> & {
    kind: 'profile' | 'search';
    stale: boolean;
    ndk?: NDK;
    signal?: AbortSignal;
  }
): Promise<NaggProfilesEnvelope | null> {
  if (!input.stale || !enabled() || input.signal?.aborted) return null;
  const owner = activePubkey();
  const signer = input.ndk?.signer;
  if (!owner || !signer) return null;
  const budget = getVertexBudgetStore(owner);
  // Bound the wait if storage fails; spending fails closed until hydration succeeds.
  if (!budget.persist.hasHydrated()) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      };
      const unsubscribe = budget.persist.onFinishHydration(finish);
      const timer = setTimeout(finish, 2_000);
    });
  }
  if (!budget.persist.hasHydrated()) return null;
  const identity = await ResultAsync.fromPromise(signer.user(), () => null);
  const stillCurrent = () =>
    activePubkey() === owner &&
    input.ndk?.signer === signer &&
    enabled() &&
    !input.signal?.aborted &&
    !(
      budget.getState().blockedUntilDay &&
      budget.getState().blockedUntilDay! > new Date().toISOString().slice(0, 10)
    );
  if (identity.isErr() || identity.value.pubkey !== owner || !stillCurrent()) return null;
  const day = new Date().toISOString().slice(0, 10);
  const scope = `${owner}:${day}`;
  for (const key of attempted.keys()) if (!key.endsWith(`:${day}`)) attempted.delete(key);
  const key =
    input.kind === 'search'
      ? `search:${input.query?.trim().toLowerCase()}`
      : `${input.kind}:${input.target ?? ''}`;
  const seen = attempted.get(scope) ?? new Set<string>();
  if (seen.has(key)) return null;
  if (!budget.getState().reserve()) return null;
  seen.add(key);
  attempted.set(scope, seen);
  const signed = await signVertexRequest(facade.buildVertexRequest(input), input.ndk);
  if (signed.isErr() || signed.value.pubkey !== owner || !stillCurrent()) return null;
  const config = getNostrTierConfig();
  const client = createNaggClient({ appView: { baseUrl: config.nagg.appViewBaseUrl } });
  const binding =
    input.kind === 'search'
      ? recipes.profileSearchAppView({
          query: input.query ?? '',
          limit: input.limit,
          signedVertexRequest: signed.value,
        })
      : recipes.profileAppView({ pubkey: input.target ?? '', signedVertexRequest: signed.value });
  nostrLog.info('nostr.vertex.client_request', { kind: input.kind, reason: 'stale' });
  const result = await client.rest({
    ...binding,
    responseSchema,
    timeoutMs: 20_000,
    signal: input.signal,
    refresh: true,
  });
  if (result.isErr()) return null;
  const failure = recipes.VertexFailureSchema.safeParse(result.value);
  if (failure.success) {
    if (failure.data.reason === 'insufficient_credits' && budget.getState().block()) {
      nostrLog.info('nostr.vertex.credits_exhausted');
    }
    return null;
  }
  if (!stillCurrent()) return null;
  const parsed = NaggProfilesEnvelopeSchema.safeParse(result.value);
  return parsed.success ? parsed.data : null;
}
