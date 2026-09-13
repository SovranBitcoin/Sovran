import { BACKUP_FLOW_REVISION } from '@/shared/lib/backup/revision';
import type { CtaDefinition, CtaId } from './types';
import { isNewerVersion } from './version';
const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** A cached latest-version record older than this is treated as unknown, never as "newer". */
export const LATEST_VERSION_MAX_AGE_MS = 24 * HOUR_MS;
export const ABANDONED_BACKUP_GRACE_MS = 30 * 60 * 1000;
export const BACKUP_SNOOZE_MS = 3 * DAY_MS;
export const CTA_DEFINITIONS: readonly CtaDefinition[] = [
  {
    id: 'update-required',
    priority: 0,
    presentation: 'blocking-modal',
    dismissPolicy: 'never',
    shouldShow: (ctx) =>
      !!ctx.nativeVersion &&
      ctx.latest !== null &&
      ctx.nowMs - ctx.latest.fetchedAt <= LATEST_VERSION_MAX_AGE_MS &&
      isNewerVersion(ctx.latest.version, ctx.nativeVersion),
    content: {
      icon: 'mdi:cloud-download-outline',
      title: 'Update required',
      body: 'Update Sovran to continue using the app.',
      primary: { label: 'Update', action: 'update' },
    },
  },
  {
    id: 'backup-recovery-phrase',
    revision: BACKUP_FLOW_REVISION,
    priority: 10,
    presentation: 'dismissable-modal',
    dismissPolicy: 'do-not-ask-again',
    shouldShow: ({ lifecycle, mockMode, balanceTotalSat, nowMs, backupStartedAt }) =>
      (lifecycle.recoveryPhraseVerifiedRevision == null ||
        lifecycle.recoveryPhraseVerifiedRevision < BACKUP_FLOW_REVISION) &&
      lifecycle.restoreStatus !== 'pending' &&
      !mockMode &&
      (backupStartedAt == null || nowMs - backupStartedAt >= ABANDONED_BACKUP_GRACE_MS) &&
      (balanceTotalSat > 0 ||
        (lifecycle.seedCreatedAt !== null && nowMs - lifecycle.seedCreatedAt > 7 * DAY_MS)),
    content: {
      icon: 'mdi:shield',
      title: 'Back up your wallet',
      body: (balanceTotalSat) =>
        `${balanceTotalSat > 0 ? 'You have money here now. ' : ''}A 2-minute backup means a lost phone doesn't mean lost funds.`,
      primary: { label: 'Back up now', action: 'back-up' },
      secondary: { label: 'Not now' },
    },
  },
];
export function isCtaId(value: unknown): value is CtaId {
  return CTA_DEFINITIONS.some((cta) => cta.id === value);
}
