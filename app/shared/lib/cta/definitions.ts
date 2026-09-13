import type { CtaDefinition, CtaId } from './types';
import { isNewerVersion } from './version';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const BACKUP_SNOOZE_MS = 3 * DAY_MS;
export const CTA_DEFINITIONS: readonly CtaDefinition[] = [
  {
    id: 'update-required',
    priority: 0,
    presentation: 'blocking-modal',
    dismissPolicy: 'never',
    shouldShow: (ctx) =>
      ctx.latest !== null && isNewerVersion(ctx.latest.version, ctx.nativeVersion),
    content: {
      icon: 'mdi:cloud-download-outline',
      title: 'Update required',
      body: 'Update Sovran to continue using the app.',
      primary: { label: 'Update', action: 'update' },
    },
  },
  {
    id: 'backup-recovery-phrase',
    priority: 10,
    presentation: 'dismissable-modal',
    dismissPolicy: 'do-not-ask-again',
    shouldShow: ({ lifecycle, mockMode, balanceTotalSat, nowMs }) =>
      lifecycle.recoveryPhraseVerifiedAt == null &&
      lifecycle.restoreStatus !== 'pending' &&
      !mockMode &&
      (balanceTotalSat > 0 ||
        (lifecycle.seedCreatedAt !== null && nowMs - lifecycle.seedCreatedAt > 7 * DAY_MS)),
    content: {
      icon: 'mdi:shield',
      title: 'Back up your recovery phrase',
      body: 'Without your recovery phrase, you may lose access to your wallet if you lose this device.',
      primary: { label: 'Back up now', action: 'back-up' },
      secondary: { label: 'Not now' },
    },
  },
];
export function isCtaId(value: unknown): value is CtaId {
  return CTA_DEFINITIONS.some((cta) => cta.id === value);
}
