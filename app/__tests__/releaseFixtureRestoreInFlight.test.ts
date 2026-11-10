/**
 * @jest-environment node
 */

/**
 * A 0.1.3 install whose wallet restore was pending, running or failed when it
 * was upgraded, started on this build three times.
 *
 * Every release fixture holds `restoreStatus: 'not-needed'`. This builds, in
 * memory, a variant of the frozen E19 disk (0.1.2 and 0.1.3) for each
 * unresolved status the released store accepted, and starts it with the
 * release-fixture runner's own launch (`releaseFixtures/launch.ts`). E19
 * itself is not changed.
 *
 * Released shape: `shared/stores/global/walletLifecycleStore.ts:36-41@d9ad12c4b`
 * (`restoreStatus` enum, `lastRestoreError` up to 500 characters). Writers at
 * 0.1.3: `'pending'` when the phrase was there before this install made one
 * (`shared/blocks/AppGate.tsx:218-220@d9ad12c4b`). `'in-progress'` and
 * `'failed'` have no writer at 0.1.3; the enum allowed them and AppGate
 * (`:254-260@d9ad12c4b`) says an earlier build wrote `'in-progress'`. Gating
 * on the status is AppGate's (rendering), which this launch does not do: what
 * is pinned is that the upgrade keeps the record as it was.
 */

// Mocks storage with in-memory maps; nothing above loads storage.
import { contents, install, launch, rejectionsOfLastLaunchSoFar } from './releaseFixtures/launch';
import type { Launch } from './releaseFixtures/launch';
import { fixture as E19 } from './releaseFixtures/E19-0.1.2';
import { zustandRow } from './releaseFixtures/format';
import type { ReleaseFixture, SurvivingFact } from './releaseFixtures/format';

const row = E19.asyncStorage['wallet-lifecycle'] as { state: object; version: number };

const VARIANTS = [
  {
    // A reinstall: the phrase came back from the keychain, so `seedCreatedAt` is null.
    restoreStatus: 'pending',
    seedCreatedAt: null,
    lastRestoreAt: null,
    lastRestoreError: null,
  },
  {
    restoreStatus: 'in-progress',
    seedCreatedAt: null,
    lastRestoreAt: 1_788_000_000_000,
    lastRestoreError: null,
  },
  {
    restoreStatus: 'failed',
    seedCreatedAt: null,
    lastRestoreAt: null,
    lastRestoreError: 'Could not reach https://mint.example/Bitcoin',
  },
] as const;

function variantOf(lifecycle: (typeof VARIANTS)[number]): ReleaseFixture {
  const facts: SurvivingFact[] = (
    ['restoreStatus', 'seedCreatedAt', 'lastRestoreAt', 'lastRestoreError'] as const
  ).map((field) => ({
    what: `the restore record's ${field}`,
    store: 'wallet-lifecycle',
    path: [field],
    equals: lifecycle[field],
  }));
  return {
    ...E19,
    asyncStorage: {
      ...E19.asyncStorage,
      'wallet-lifecycle': zustandRow(row.version, { ...row.state, ...lifecycle }),
    },
    survives: {
      ...E19.survives,
      // E19's own lifecycle facts describe the row replaced here.
      facts: [...E19.survives.facts.filter((fact) => fact.store !== 'wallet-lifecycle'), ...facts],
    },
  };
}

describe.each(VARIANTS.map((lifecycle) => [lifecycle.restoreStatus, lifecycle] as const))(
  'E19 with a restore %s, upgraded straight to this build',
  (_status, lifecycle) => {
    const fixture = variantOf(lifecycle);
    const accepted = fixture.knownGaps.map((known) => known.what);
    const launches: Launch[] = [];
    let startupError: unknown;
    let startupRejections: string[] = [];

    beforeAll(async () => {
      // The logger prints every entry; a launch makes hundreds.
      for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
        jest.spyOn(console, method).mockImplementation(() => {});
      }
      install(fixture);
      try {
        for (let n = 0; n < 3; n++) launches.push(await launch(fixture));
      } catch (error) {
        startupError = error;
        startupRejections = rejectionsOfLastLaunchSoFar();
      }
    }, 120_000);

    afterAll(() => jest.restoreAllMocks());

    it('starts three times and turns down no saved blob', () => {
      expect({ error: startupError, rejections: startupRejections }).toEqual({
        error: undefined,
        rejections: [],
      });
      expect(launches).toHaveLength(3);
      for (const each of launches) {
        expect(each.unreadStores).toEqual([]);
        expect(each.rejections).toEqual([]);
        expect(
          each.defaultedRows.filter((r) => !accepted.some((what) => r.startsWith(`${what} `)))
        ).toEqual([]);
      }
    });

    it('keeps the restore status and its companion fields, in the store and on disk', () => {
      expect(launches).toHaveLength(3);
      for (const each of launches) {
        for (const fact of fixture.survives.facts.filter((f) => f.store === 'wallet-lifecycle')) {
          expect([fact.what, each.facts[fact.what]]).toEqual([fact.what, fact.equals]);
        }
        const saved = JSON.parse(each.disk.asyncStorage['wallet-lifecycle']) as { state: object };
        expect(saved.state).toMatchObject(lifecycle);
      }
    });

    it('keeps every other fact E19 holds', () => {
      expect(launches).toHaveLength(3);
      const others = fixture.survives.facts.filter(
        (fact) => fact.store !== 'wallet-lifecycle' && !accepted.includes(fact.what)
      );
      for (const each of launches) {
        for (const fact of others) {
          expect([fact.what, each.facts[fact.what]]).toEqual([fact.what, fact.equals]);
        }
      }
    });

    it('changes nothing on a later launch', () => {
      expect(launches).toHaveLength(3);
      expect(contents(launches[2].disk)).toEqual(contents(launches[1].disk));
      expect(contents(launches[1].disk)).toEqual(contents(launches[0].disk));
    });
  }
);
