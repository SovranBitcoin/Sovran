import { storeRegistryManifest } from '../../shared/lib/persist/storeRegistryManifest';
import type { ReleaseFixture } from '../../__tests__/releaseFixtures/format';

/** Reports evidence in the existing corpus, not an invented percentage of all possible states. */
export function corpusCoverage(fixture: ReleaseFixture) {
  return Object.entries(fixture.asyncStorage).map(([key, raw]) => {
    const [store, suffix] = key.split(':profile:');
    const account =
      suffix === undefined
        ? undefined
        : fixture.survives.accounts.find(
            (item) => item.pubkey === suffix || String(item.accountIndex) === suffix
          );
    const profileScoped =
      suffix !== undefined ||
      storeRegistryManifest.some((entry) => entry.name === store && entry.profileStorage) ||
      Object.keys(fixture.asyncStorage).some((name) => name.startsWith(`${store}:profile:`));
    const accountIndex =
      suffix !== undefined ? account?.accountIndex : profileScoped ? 0 : undefined;
    let decoded: unknown = raw;
    if (typeof raw === 'string') {
      try {
        decoded = JSON.parse(raw);
      } catch {
        /* Non-JSON historical bytes are still covered by retained-byte checks. */
      }
    }
    const state =
      typeof decoded === 'object' && decoded !== null && 'state' in decoded
        ? decoded.state
        : undefined;
    const storedVersion =
      typeof decoded === 'object' && decoded !== null && 'version' in decoded
        ? decoded.version
        : null;
    const fields: { path: (string | number)[]; evidence: string }[] = [];
    const walk = (value: unknown, path: (string | number)[]) => {
      if (typeof value === 'object' && value !== null && Object.keys(value).length) {
        for (const [name, child] of Object.entries(value))
          walk(child, [...path, Array.isArray(value) ? Number(name) : name]);
        return;
      }
      const retained = fixture.survives.keptAsyncStorage.includes(key);
      const direct = fixture.survives.facts.some(
        (fact) =>
          fact.store === store &&
          (!profileScoped ||
            (accountIndex !== undefined &&
              (fact.accountIndex ?? fixture.survives.activeAccountIndex) === accountIndex)) &&
          fact.path.length <= path.length &&
          fact.path.every((part, index) => part === path[index])
      );
      fields.push({
        path,
        evidence: retained
          ? 'retained-bytes'
          : direct
            ? 'named-store-fact'
            : 'no-direct-field-fact',
      });
    };
    if (state !== undefined) walk(state, []);
    return { key, store, storedVersion, defaultOnly: fixture.defaultRows.includes(store), fields };
  });
}
