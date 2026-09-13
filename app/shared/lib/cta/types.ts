export type CtaId = 'update-required' | 'backup-recovery-phrase';
export type CtaDismissals = Record<string, { at: number; version?: string }>;
export interface CtaContext {
  nowMs: number;
  nativeVersion: string;
  latest: { version: string; minVersion?: string; fetchedAt: number } | null;
  lifecycle: {
    seedCreatedAt: number | null;
    recoveryPhraseVerifiedAt: number | null;
    restoreStatus: string;
  };
  balanceTotalSat: number;
  backupStartedAt?: number | null;
  dismissed: CtaDismissals;
  mockMode: boolean;
  automation: boolean;
}
export interface CtaDefinition {
  id: CtaId;
  priority: number;
  presentation: 'blocking-modal' | 'dismissable-modal';
  dismissPolicy: 'never' | 'do-not-ask-again' | { snoozeMs: number };
  shouldShow: (ctx: CtaContext) => boolean;
  content: {
    icon: string;
    title: string;
    body: string;
    primary: { label: string; action: 'update' | 'back-up' };
    secondary?: { label: string };
  };
}
