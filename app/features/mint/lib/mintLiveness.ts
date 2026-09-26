import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';

export type MintLiveness = 'online' | 'offline' | 'unknown';

/** A verdict older than this is history, not liveness; the auditor's view
 *  (hourly, second-hand, but always there) takes over. */
const LIVENESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The dot a mint row draws, from what the store already holds — no wait.
 *
 * Preference: the freshest `/v1/info` verdict, from this phone's probe or
 * nagg's sweep (whichever stamp is newer, the store keeps only that one);
 * failing that, the auditor's standing state as a proxy — its "OK" or
 * "ERROR" is what the mint page's avatar badge already shows, so the row and
 * the page agree from the first frame while the probe runs in the background.
 */
export function selectMintLiveness(
  entry: MintMetadataEntry | undefined,
  nowMs: number = Date.now()
): MintLiveness {
  if (!entry) return 'unknown';
  if (
    entry.liveness &&
    typeof entry.livenessAt === 'number' &&
    nowMs - entry.livenessAt <= LIVENESS_MAX_AGE_MS
  ) {
    return entry.liveness;
  }
  const audit = entry.auditState?.toUpperCase();
  if (audit === 'OK') return 'online';
  if (audit === 'ERROR' || audit === 'OFFLINE') return 'offline';
  return 'unknown';
}
