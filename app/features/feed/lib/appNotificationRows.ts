import type { NotificationListItem } from '@/features/feed/lib/notificationGroups';
import {
  hasCurrentLegalAcceptance,
  type LegalAcceptance,
  type legalRevisions,
} from '@/shared/lib/legal/legalDocuments';

type AppNotificationRow = Extract<NotificationListItem, { type: 'welcome' | 'legal' }>;

interface AppNotificationRowsInput {
  seedCreatedAt: number | null;
  termsAccepted: { date: string } | null;
  legalAcceptance: LegalAcceptance | null;
  currentRevisions: typeof legalRevisions;
  nowMs: number;
}

export function buildAppNotificationRows({
  seedCreatedAt,
  termsAccepted,
  legalAcceptance,
  currentRevisions,
}: AppNotificationRowsInput): AppNotificationRow[] {
  const rows: AppNotificationRow[] = [
    {
      type: 'welcome',
      id: 'welcome-sovran',
      installDate: seedCreatedAt,
      termsDate: termsAccepted?.date ?? null,
    },
  ];
  const acceptedAt = legalAcceptance?.acceptedAt ?? termsAccepted?.date;
  if (acceptedAt !== undefined) {
    const acceptedAtMs = Date.parse(acceptedAt);
    rows.push({
      type: 'legal',
      id: 'legal-acceptance',
      acceptedAtMs: Number.isFinite(acceptedAtMs) ? acceptedAtMs : null,
      termsRevisionShort: legalAcceptance?.termsRevision.slice(0, 7) ?? null,
      privacyRevisionShort: legalAcceptance?.privacyRevision.slice(0, 7) ?? null,
      isCurrent: hasCurrentLegalAcceptance(legalAcceptance, currentRevisions),
      revisionKnown: legalAcceptance !== null,
    });
  }
  return rows;
}
