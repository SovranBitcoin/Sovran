import type { LegacyClaimPrompt } from '@/shared/stores/global/legacyEcashStore';

export type CtaId = 'update-required' | 'claim-old-ecash' | 'backup-recovery-phrase';
export type CtaDismissals = Record<string, { at: number; version?: string; revision?: number }>;
export interface CtaContext {
  nowMs: number;
  nativeVersion: string;
  latest: { version: string; minVersion?: string; fetchedAt: number } | null;
  lifecycle: {
    seedCreatedAt: number | null;
    recoveryPhraseVerifiedAt: number | null;
    recoveryPhraseVerifiedRevision?: number | null;
    restoreStatus: string;
  };
  balanceTotalSat: number;
  backupStartedAt?: number | null;
  /** An untrusted mint holding unspent ecash from before 0.0.45, for the open account. */
  oldEcash: LegacyClaimPrompt | null;
  dismissed: CtaDismissals;
  mockMode: boolean;
  automation: boolean;
}
/** What a prompt's body is written from. */
export interface CtaBodyView {
  balanceTotalSat: number;
  /** The mint and amount as shown to the person, or null when there is nothing to claim. */
  oldEcash: { mint: string; amount: string | null } | null;
}
export interface CtaDefinition {
  id: CtaId;
  /** Omitted definitions use revision 1. */
  revision?: number;
  priority: number;
  presentation: 'blocking-modal' | 'dismissable-modal';
  dismissPolicy: 'never' | 'do-not-ask-again' | { snoozeMs: number };
  shouldShow: (ctx: CtaContext) => boolean;
  content: {
    icon: string;
    title: string;
    body: string | ((view: CtaBodyView) => string);
    primary: { label: string; action: 'update' | 'back-up' | 'trust-mint' };
    secondary?: { label: string };
    /** A refusal that is recorded, unlike the secondary, which only postpones. */
    decline?: { label: string };
  };
}
