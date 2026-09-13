import { buildAppNotificationRows } from '@/features/feed/lib/appNotificationRows';
import {
  hasCurrentLegalAcceptance,
  legalRevisions,
  type LegalAcceptance,
} from '@/shared/lib/legal/legalDocuments';

const seedCreatedAt = Date.parse('2026-08-01T09:00:00Z');
const legacyDate = '2026-08-01T09:05:00Z';
const acceptedAt = '2026-09-01T10:30:00Z';
const nowMs = Date.parse('2026-09-13T12:00:00Z');
const acceptance: LegalAcceptance = {
  termsRevision: legalRevisions.terms,
  privacyRevision: legalRevisions.privacy,
  acceptedAt,
};
const input = {
  seedCreatedAt,
  termsAccepted: { date: legacyDate },
  legalAcceptance: acceptance,
  currentRevisions: legalRevisions,
  nowMs,
};

describe('buildAppNotificationRows', () => {
  it('keeps the welcome row and prefers revisioned acceptance over the legacy date', () => {
    expect(buildAppNotificationRows(input)).toEqual([
      {
        type: 'welcome',
        id: 'welcome-sovran',
        installDate: seedCreatedAt,
        termsDate: legacyDate,
      },
      {
        type: 'legal',
        id: 'legal-acceptance',
        acceptedAtMs: Date.parse(acceptedAt),
        termsRevisionShort: legalRevisions.terms.slice(0, 7),
        privacyRevisionShort: legalRevisions.privacy.slice(0, 7),
        isCurrent: true,
        revisionKnown: true,
      },
    ]);
    expect(hasCurrentLegalAcceptance(acceptance)).toBe(true);
  });

  it.each(['terms', 'privacy'] as const)(
    'marks acceptance stale when only the current %s revision changes beyond the display prefix',
    (document) => {
      const revision = legalRevisions[document];
      const currentRevisions = {
        ...legalRevisions,
        [document]: `${revision.slice(0, -1)}${revision.endsWith('0') ? '1' : '0'}`,
      };
      expect(buildAppNotificationRows({ ...input, currentRevisions })[1]).toMatchObject({
        type: 'legal',
        acceptedAtMs: Date.parse(acceptedAt),
        termsRevisionShort: legalRevisions.terms.slice(0, 7),
        privacyRevisionShort: legalRevisions.privacy.slice(0, 7),
        isCurrent: false,
        revisionKnown: true,
      });
    }
  );

  it('shows a revisioned acceptance without a legacy terms record', () => {
    expect(buildAppNotificationRows({ ...input, termsAccepted: null })[1]).toMatchObject({
      acceptedAtMs: Date.parse(acceptedAt),
      isCurrent: true,
      revisionKnown: true,
    });
  });

  it('marks legacy-only acceptance as revision unknown and requiring review', () => {
    expect(buildAppNotificationRows({ ...input, legalAcceptance: null })[1]).toEqual({
      type: 'legal',
      id: 'legal-acceptance',
      acceptedAtMs: Date.parse(legacyDate),
      termsRevisionShort: null,
      privacyRevisionShort: null,
      isCurrent: false,
      revisionKnown: false,
    });
  });

  it('keeps only the welcome row when neither acceptance record exists', () => {
    expect(
      buildAppNotificationRows({
        ...input,
        seedCreatedAt: null,
        termsAccepted: null,
        legalAcceptance: null,
      })
    ).toEqual([{ type: 'welcome', id: 'welcome-sovran', installDate: null, termsDate: null }]);
  });

  it.each(['', 'invalid-date'])('preserves acceptance with an unknown date for %j', (date) => {
    expect(
      buildAppNotificationRows({
        ...input,
        legalAcceptance: { ...acceptance, acceptedAt: date },
      })[1]
    ).toMatchObject({ type: 'legal', acceptedAtMs: null, revisionKnown: true });
    expect(
      buildAppNotificationRows({
        ...input,
        legalAcceptance: null,
        termsAccepted: { date },
      })[1]
    ).toMatchObject({ type: 'legal', acceptedAtMs: null, revisionKnown: false });
  });
});
