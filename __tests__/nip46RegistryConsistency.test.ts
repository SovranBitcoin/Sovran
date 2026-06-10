/**
 * Cross-registry drift guard. The permission model spreads each event kind
 * across several hand-maintained registries (policy sensitivity sets, bundle
 * membership, canonical editor rows, catalog presentation, per-kind notes,
 * pairing preset). Twice now a kind landed in one registry but not another
 * and surfaced as a UI bug (rows flickering in/out of the Advanced page as
 * grants were written and cleared). This suite makes every such drift a
 * failing test instead of a field report:
 *
 *   bundles ⊆ BASE_EDITOR_GRANT_KEYS         (members always have stable rows)
 *   preset  ⊆ BASE_EDITOR_GRANT_KEYS, non-critical
 *   every base key → real catalog row + friendly subtitle note
 *   critical keys are never bundle members or preset members
 */

import { BASE_EDITOR_GRANT_KEYS } from '@/features/nostrSigner/components/editorGrantKeys';
import {
  permissionEntryForGrantKey,
  permissionTierFor,
  requestsWaitingToastCopy,
} from '@/features/nostrSigner/components/permissionCatalog';
import { buildPermissionKeyRows } from '@/features/nostrSigner/components/permissionRowModel';
import { isCriticalGrantKey } from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { PAIRING_PRESET_GRANT_KEYS } from '@/features/nostrSigner/lib/pairingPreset';
import { PERMISSION_BUNDLES } from '@/features/nostrSigner/lib/permissionBundles';
import { parseGrantKey } from '@/features/nostrSigner/lib/permissionPolicy';

const BASE_KEYS = new Set<string>(BASE_EDITOR_GRANT_KEYS);

describe('permission registry consistency', () => {
  it('every bundle member has a canonical editor row', () => {
    for (const bundle of PERMISSION_BUNDLES) {
      for (const grantKey of bundle.grantKeys) {
        expect({ bundle: bundle.id, grantKey, listed: BASE_KEYS.has(grantKey) }).toEqual({
          bundle: bundle.id,
          grantKey,
          listed: true,
        });
      }
    }
  });

  it('every pairing-preset key has a canonical editor row and is never critical', () => {
    for (const grantKey of PAIRING_PRESET_GRANT_KEYS) {
      expect({ grantKey, listed: BASE_KEYS.has(grantKey) }).toEqual({ grantKey, listed: true });
      expect({ grantKey, critical: isCriticalGrantKey(grantKey) }).toEqual({
        grantKey,
        critical: false,
      });
    }
  });

  it('every base editor sign kind resolves to a real catalog row, not the unknown tier', () => {
    for (const grantKey of BASE_EDITOR_GRANT_KEYS) {
      const lookup = parseGrantKey(grantKey);
      expect({ grantKey, tier: permissionTierFor(lookup) }).not.toEqual({
        grantKey,
        tier: 'unknown',
      });
    }
  });

  it('every base editor key has a friendly subtitle note, not the bare-kind fallback', () => {
    const rows = buildPermissionKeyRows(BASE_EDITOR_GRANT_KEYS, {});
    expect(rows.map((row) => row.grantKey).sort()).toEqual([...BASE_EDITOR_GRANT_KEYS].sort());
    for (const row of rows) {
      expect({ grantKey: row.grantKey, subtitle: row.subtitle }).not.toMatchObject({
        subtitle: expect.stringMatching(/^Event kind \d+$/),
      });
    }
  });

  it('critical grant keys never appear in bundles', () => {
    for (const bundle of PERMISSION_BUNDLES) {
      for (const grantKey of bundle.grantKeys) {
        expect({ bundle: bundle.id, grantKey, critical: isCriticalGrantKey(grantKey) }).toEqual({
          bundle: bundle.id,
          grantKey,
          critical: false,
        });
      }
    }
  });

  it('user-visible catalog copy says Remote Login, never Signer', () => {
    expect(requestsWaitingToastCopy(1).description).toContain('Remote Login');
    for (const grantKey of BASE_EDITOR_GRANT_KEYS) {
      const entry = permissionEntryForGrantKey(grantKey);
      expect({ grantKey, label: entry.permissionEditorLabel }).not.toMatchObject({
        label: expect.stringMatching(/signer/i),
      });
      expect({ grantKey, headline: entry.headline }).not.toMatchObject({
        headline: expect.stringMatching(/signer/i),
      });
    }
  });
});
