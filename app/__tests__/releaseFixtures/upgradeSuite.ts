/* eslint-disable @typescript-eslint/no-require-imports */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contents, install, launch, rejectionsOfLastLaunchSoFar } from './launch';
import type { Launch } from './launch';
import { NAMED_CHECKS, PHRASE } from './format';
import { readPath, type UpgradeCase } from './cases';

/** The same full-startup checks serve frozen baselines and declared variants. Cases run serially. */
export function registerUpgradeCases(cases: readonly UpgradeCase[]) {
  for (const item of cases)
    describe(`${item.fixture.epoch}/${item.id} [${item.store}] (${item.fixture.versions.join(', ')}) → candidate`, () => {
      const { fixture } = item;
      const { survives } = fixture;
      const gap = (what: string) => fixture.knownGaps.find((known) => known.what === what);
      /** `it`, or `it.failing` for an expectation the fixture records as a known gap. */
      const check = (what: string) => (gap(what) ? it.failing : it);
      const title = (what: string) => {
        const known = gap(what);
        return known
          ? `keeps ${what} [known gap ${known.followUp}: ${known.why}]`
          : `keeps ${what}`;
      };

      const launches: Launch[] = [];
      const quieted: jest.SpyInstance[] = [];
      let startupError: unknown;
      let startupRejections: string[] = [];

      beforeAll(async () => {
        // The logger prints every entry; a launch makes hundreds.
        for (const method of ['log', 'info', 'debug', 'warn', 'error'] as const) {
          quieted.push(jest.spyOn(console, method).mockImplementation(() => {}));
        }
        install(fixture);
        try {
          // Three cold starts. An install from before accounts existed finishes
          // moving its stores on the second, once account 0 has its row.
          for (let n = 0; n < 3; n++) launches.push(await launch(fixture));
        } catch (error) {
          startupError = error;
          startupRejections = rejectionsOfLastLaunchSoFar();
        }
      }, 120_000);

      afterAll(() => quieted.forEach((spy) => spy.mockRestore()));

      it('starts, three times over, without stopping on a failure or recovery screen', () => {
        expect({ error: startupError, rejections: startupRejections }).toEqual({
          error: undefined,
          rejections: [],
        });
        expect(launches).toHaveLength(3);
        for (const each of launches) {
          expect(each.unreadStores).toEqual([]);
          expect(each.secureStoreState).toBe('available');
        }
      });

      it('keeps the phrase and makes no new one', () => {
        expect(survives.phrase).toBe(PHRASE);
        for (const each of launches)
          expect(each.disk.secureStore.user_mnemonic).toBe(survives.phrase);
      });

      it('opens every account with the key it had, and keeps the same account selected', () => {
        const expected = Object.fromEntries(
          survives.accounts.map((a) => [a.accountIndex, a.pubkey])
        );
        for (const each of launches) {
          expect(each.openedPubkeys).toEqual(expected);
          expect(each.activeAccountIndex).toBe(survives.activeAccountIndex);
          const saved = JSON.parse(each.disk.asyncStorage['profile-store']) as {
            state: { profiles: { accountIndex: number; pubkey: string }[] };
          };
          expect(
            Object.fromEntries(saved.state.profiles.map((p) => [p.accountIndex, p.pubkey]))
          ).toEqual(expected);
        }
      });

      if (survives.facts.length > 0) {
        for (const fact of survives.facts) {
          check(fact.what)(
            `${title(fact.what)} [${fact.store}; account ${fact.accountIndex ?? 'active/global'}; ${fact.path.join('.')}]`,
            () => {
              expect(launches).toHaveLength(3);
              for (const [index, each] of launches.entries())
                expect({ launch: index + 1, value: each.facts[fact.what] }).toEqual({
                  launch: index + 1,
                  value: fact.equals,
                });
            }
          );
        }
      }

      for (const diskFact of item.diskFacts)
        it(`keeps saved ${diskFact.key}.${diskFact.path.join('.')}`, () => {
          expect(launches).toHaveLength(3);
          for (const [index, each] of launches.entries()) {
            const raw = each.disk[diskFact.storage][diskFact.key];
            const value: unknown = raw === undefined ? undefined : JSON.parse(raw);
            expect({ launch: index + 1, value: readPath(value, diskFact.path) }).toEqual({
              launch: index + 1,
              value: diskFact.equals,
            });
          }
        });

      it('turns down no saved blob and sets none aside as unreadable', () => {
        expect(launches).toHaveLength(3);
        for (const each of launches) {
          expect(each.rejections).toEqual([]);
          const keys = [
            ...Object.keys(each.disk.asyncStorage),
            ...Object.keys(each.disk.secureStore),
          ];
          expect(keys.filter((key) => key.includes(':unreadable'))).toEqual([]);
        }
      });

      it('loads no store that held data as its defaults', () => {
        expect(launches).toHaveLength(3);
        const accepted = fixture.knownGaps.map((known) => known.what);
        const lost = (each: Launch) =>
          each.defaultedRows.filter((row) => !accepted.some((what) => row.startsWith(`${what} `)));
        for (const each of launches) expect(lost(each)).toEqual([]);
      });

      it('deletes nothing the fixture says must be kept', () => {
        expect(launches).toHaveLength(3);
        for (const each of launches) {
          for (const key of survives.keptAsyncStorage) {
            const was = fixture.asyncStorage[key];
            expect(each.disk.asyncStorage[key]).toBe(
              typeof was === 'string' ? was : JSON.stringify(was)
            );
          }
          for (const key of survives.keptSecureStore) {
            expect(each.disk.secureStore[key]).toBe(fixture.secureStore[key]);
          }
        }
      });

      it('changes nothing on a later launch', () => {
        expect(launches).toHaveLength(3);
        const [first, second, third] = launches;
        expect(contents(third.disk)).toEqual(contents(second.disk));
        // An install that already had its account list is finished after one launch.
        if ('profile-store' in fixture.asyncStorage)
          expect(contents(second.disk)).toEqual(contents(first.disk));
      });

      it('names only databases the current app opens for these accounts', () => {
        const manager = readFileSync(
          join(__dirname, '..', '..', 'shared/lib/cashu/manager.ts'),
          'utf8'
        );
        expect(manager).toContain("accountIndex === 0 ? 'coco.db' : `coco-${accountIndex}.db`");
        const opened = survives.accounts.flatMap(({ accountIndex }) =>
          accountIndex === 0
            ? ['coco.db', 'nostr']
            : [`coco-${accountIndex}.db`, `nostr-${accountIndex}`]
        );
        for (const name of fixture.sqliteDatabases) expect(opened).toContain(name);
      });

      const { reduxEcash } = survives;
      if (reduxEcash) {
        check(NAMED_CHECKS.reduxProofs)(title(NAMED_CHECKS.reduxProofs), () => {
          const { readLegacyEcash } = require('wallet') as typeof import('wallet');
          const row = fixture.asyncStorage['persist:SOVRAN'];
          const found = readLegacyEcash(typeof row === 'string' ? row : JSON.stringify(row));
          expect(found.kind).toBe('read');
          if (found.kind !== 'read') return;
          const perMint = new Map<string, number>();
          for (const group of found.groups) {
            const amount = group.proofs.reduce((sum, proof) => sum + proof.amount, 0);
            perMint.set(group.mintUrl, (perMint.get(group.mintUrl) ?? 0) + amount);
          }
          expect({ skipped: found.skipped, perMint: Object.fromEntries(perMint) }).toEqual({
            skipped: 0,
            perMint: Object.fromEntries(reduxEcash.map((held) => [held.mintUrl, held.amount])),
          });
        });
      }
    });
}
