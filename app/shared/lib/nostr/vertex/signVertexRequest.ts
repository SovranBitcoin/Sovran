import { err, Result, type Result as ResultType } from 'neverthrow';
import type { facade } from 'nostr';
import type { NostrClient } from 'nostr/client';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

export function vertexAutomationDisabled(): boolean {
  return useSettingsStore.getState().mockMode || !!process.env.EXPO_PUBLIC_E2E_STATE_MIRROR;
}

type SignError = { type: 'no-signer' | 'disabled' | 'sign-failed' };
/** Signs with the account's signer, as publishEvent does; never reads private material. */
export async function signVertexRequest(
  unsigned: facade.UnsignedVertexRequest,
  client?: NostrClient
): Promise<ResultType<facade.SignedVertexRequest, SignError>> {
  if (vertexAutomationDisabled()) return err({ type: 'disabled' });
  const signer = client?.signer;
  if (!client || !signer) return err({ type: 'no-signer' });
  return Result.fromThrowable(
    () => signer.sign(unsigned),
    (): SignError => ({ type: 'sign-failed' })
  )();
}
