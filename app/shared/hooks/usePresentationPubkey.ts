import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { DEMO_VIEWER_PUBKEY } from '@/shared/stores/runtime/mockPublicProfile';

/** Header/drawer presentation only. Never use this hook for signing or payments. */
export function usePresentationPubkey(activePubkey: string): string {
  const mockMode = useSettingsStore((state) => state.mockMode);
  return mockMode ? DEMO_VIEWER_PUBKEY : activePubkey;
}
