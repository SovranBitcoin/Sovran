import { selectNextCta } from '@/shared/lib/cta/selectNextCta';
import { CTA_DEFINITIONS, BACKUP_SNOOZE_MS, DAY_MS } from '@/shared/lib/cta/definitions';
import { isNewerVersion } from '@/shared/lib/cta/version';
import type { CtaContext } from '@/shared/lib/cta/types';
const ctx: CtaContext = {
  nowMs: 10 * DAY_MS,
  nativeVersion: '1.0.0',
  latest: { version: '2.0.0', fetchedAt: 10 * DAY_MS },
  lifecycle: { seedCreatedAt: 0, recoveryPhraseVerifiedAt: null, restoreStatus: 'complete' },
  balanceTotalSat: 1,
  dismissed: {},
  mockMode: false,
  automation: false,
};
it('queues update before backup regardless of registry order and ignores legacy dismissals', () => {
  expect(
    selectNextCta(
      { ...ctx, dismissed: { 'update-required': { at: ctx.nowMs } } },
      [...CTA_DEFINITIONS].reverse()
    )?.id
  ).toBe('update-required');
  expect(selectNextCta({ ...ctx, nativeVersion: '2.0.0' })?.id).toBe('backup-recovery-phrase');
});
it('snoozes only the dismissed update version for one day and then queues backup', () => {
  const input = {
    ...ctx,
    dismissed: { 'update-required:snooze': { revision: 1, at: ctx.nowMs, version: '2.0.0' } },
  };
  expect(selectNextCta(input)?.id).toBe('backup-recovery-phrase');
  expect(selectNextCta({ ...input, nowMs: ctx.nowMs + DAY_MS - 1 })?.id).toBe(
    'backup-recovery-phrase'
  );
  expect(selectNextCta({ ...input, nowMs: ctx.nowMs + DAY_MS })?.id).toBe('update-required');
  expect(selectNextCta({ ...input, latest: { version: '2.0.1', fetchedAt: ctx.nowMs } })?.id).toBe(
    'update-required'
  );
});
it('ignores dismissals only for an explicitly forced definition', () => {
  expect(
    selectNextCta(
      {
        ...ctx,
        dismissed: { 'update-required:snooze': { revision: 1, at: ctx.nowMs, version: '2.0.0' } },
      },
      [{ ...CTA_DEFINITIONS[0], presentation: 'blocking-modal', dismissPolicy: 'never' }]
    )?.id
  ).toBe('update-required');
});
it('honors permanent dismissal and ignores one for a different trigger version', () => {
  const backup = {
    ...ctx,
    latest: null,
    dismissed: { 'backup-recovery-phrase': { revision: 2, at: 0 } },
  };
  expect(selectNextCta(backup)).toBeNull();
  expect(
    selectNextCta({
      ...backup,
      dismissed: { 'backup-recovery-phrase': { revision: 2, at: 0, version: 'old' } },
    })?.id
  ).toBe('backup-recovery-phrase');
});
it('expires a three-day snooze at its boundary', () => {
  const snoozed = {
    ...ctx,
    latest: null,
    dismissed: { 'backup-recovery-phrase:snooze': { revision: 2, at: ctx.nowMs } },
  };
  expect(selectNextCta(snoozed)).toBeNull();
  expect(selectNextCta({ ...snoozed, nowMs: ctx.nowMs + BACKUP_SNOOZE_MS - 1 })).toBeNull();
  expect(selectNextCta({ ...snoozed, nowMs: ctx.nowMs + BACKUP_SNOOZE_MS })?.id).toBe(
    'backup-recovery-phrase'
  );
});
it('supports a registry policy with a custom snooze duration', () => {
  const definitions = [{ ...CTA_DEFINITIONS[1], dismissPolicy: { snoozeMs: 100 } }];
  const input = {
    ...ctx,
    latest: null,
    dismissed: { 'backup-recovery-phrase': { revision: 2, at: ctx.nowMs } },
  };
  expect(selectNextCta(input, definitions)).toBeNull();
  expect(selectNextCta({ ...input, nowMs: ctx.nowMs + 100 }, definitions)).not.toBeNull();
});
it('suppresses auto-show under automation and backup under Mock Mode', () => {
  expect(selectNextCta({ ...ctx, automation: true })).toBeNull();
  expect(selectNextCta({ ...ctx, mockMode: true })?.id).toBe('update-required');
  expect(selectNextCta({ ...ctx, latest: null, mockMode: true })).toBeNull();
});
it('requires an unverified, eligible lifecycle and balance or a known seed older than seven days', () => {
  for (const lifecycle of [
    { ...ctx.lifecycle, recoveryPhraseVerifiedAt: 0, recoveryPhraseVerifiedRevision: 2 },
    { ...ctx.lifecycle, restoreStatus: 'pending' },
  ])
    expect(selectNextCta({ ...ctx, latest: null, lifecycle })).toBeNull();
  for (const seedCreatedAt of [null, ctx.nowMs - 7 * DAY_MS]) {
    expect(
      selectNextCta({
        ...ctx,
        latest: null,
        balanceTotalSat: 0,
        lifecycle: { ...ctx.lifecycle, seedCreatedAt },
      })
    ).toBeNull();
  }
  expect(selectNextCta({ ...ctx, latest: null, balanceTotalSat: 0 })?.id).toBe(
    'backup-recovery-phrase'
  );
});
it.each([
  ['1.2.10', '1.2.9', true],
  ['1.2.0', '1.2.0', false],
  ['1.1.0', '1.2.0', false],
  ['1.2.0+20', '1.2.0+19', false],
  ['1.2.1+1', '1.2.0+99', true],
  ['1.2.0', '1.2.0-rc.1', true],
  ['1.2.0-rc.2', '1.2.0', false],
  ['1.2.0-rc.10', '1.2.0-rc.2', true],
  ['1.2.0-beta', '1.2.0-alpha', true],
  ['1.2.0-rc.1', '1.2.0-rc', true],
  ['1.2.0-rc.01', '1.2.0-rc.0', false],
  ['garbage', '1.0.0', false],
  ['1.0.0', '', false],
])('compares %s against %s', (candidate, current, expected) => {
  expect(isNewerVersion(candidate, current)).toBe(expected);
});

it('treats a version record older than 24 hours as unknown', () => {
  const input = { ...ctx, mockMode: true };
  expect(
    selectNextCta({ ...input, latest: { version: '2.0.0', fetchedAt: ctx.nowMs - DAY_MS - 1 } })
  ).toBeNull();
  expect(
    selectNextCta({ ...input, latest: { version: '2.0.0', fetchedAt: ctx.nowMs - DAY_MS } })?.id
  ).toBe('update-required');
});
it('does not block without a native version, even with fresh newer metadata', () => {
  expect(selectNextCta({ ...ctx, nativeVersion: '', mockMode: true })).toBeNull();
});

it.each([undefined, 1])(
  'ignores legacy dismissal revision %s for both permanent and snoozed reminders',
  (revision) => {
    for (const key of ['backup-recovery-phrase', 'backup-recovery-phrase:snooze']) {
      expect(
        selectNextCta({ ...ctx, latest: null, dismissed: { [key]: { at: ctx.nowMs, revision } } })
          ?.id
      ).toBe('backup-recovery-phrase');
    }
  }
);
it.each([undefined, null, 1])(
  'requires the new verification even with an old timestamp and revision %s',
  (recoveryPhraseVerifiedRevision) => {
    expect(
      selectNextCta({
        ...ctx,
        latest: null,
        lifecycle: {
          ...ctx.lifecycle,
          recoveryPhraseVerifiedAt: 123,
          recoveryPhraseVerifiedRevision,
        },
      })?.id
    ).toBe('backup-recovery-phrase');
  }
);
it('uses revision 1 for definitions without an explicit revision', () => {
  const definitions = [{ ...CTA_DEFINITIONS[1], revision: undefined }];
  expect(
    selectNextCta(
      { ...ctx, latest: null, dismissed: { 'backup-recovery-phrase': { at: 0, revision: 1 } } },
      definitions
    )
  ).toBeNull();
});
