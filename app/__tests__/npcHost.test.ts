/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NPC_BASE_URL, NPC_DOMAIN, getNpcAddress } from '@/shared/lib/cashu/npc';

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', relativePath), 'utf8');

// npub.cash migrated from a v1 API to an incompatible v2 API at a hard cutover
// on 2026-08-07 15:00 UTC. Before it, the v2 service lived at `npubx.cash` and
// this app pointed there; after it, `npub.cash` is canonical and `npubx.cash`
// is a compatibility domain upstream retires on 2026-12-31.
//
// These assertions are cheap and the failure they guard against is not: the
// host is also the user-facing Lightning address domain, so a silent revert
// hands out addresses on a domain that stops resolving, and the sync lane
// stops with it.
describe('npub.cash host', () => {
  it('points at the canonical post-cutover host', () => {
    expect(NPC_BASE_URL).toBe('https://npub.cash');
    expect(NPC_DOMAIN).toBe('npub.cash');
  });

  it('builds Lightning addresses on that host, npub or username', () => {
    const npub = 'npub1exampleexampleexample';
    expect(getNpcAddress(undefined, npub)).toBe(`${npub}@npub.cash`);
    expect(getNpcAddress('alice', npub)).toBe('alice@npub.cash');
    // A blank/whitespace username must not produce `@npub.cash` with no local part.
    expect(getNpcAddress('   ', npub)).toBe(`${npub}@npub.cash`);
  });

  it('speaks only v2 — the retired v1 API is not referenced anywhere', () => {
    // `/api/v1/info/username/<name>` was the last v1 caller. It now serves the
    // marketing SPA, and the old handler read any non-404 as "available", so a
    // taken name rendered a green "Available" until the claim itself failed.
    for (const file of [
      'shared/lib/cashu/npc.ts',
      'shared/lib/cashu/manager.ts',
      'shared/stores/profile/npcMintStore.ts',
    ]) {
      expect(read(file)).not.toContain('/api/v1/');
    }
    // The claim screen may still *describe* v1 in the comment explaining why
    // the pre-check is gone, but must not build a URL from it.
    const claimScreen = read('features/onboarding/screens/ClaimUsernameScreen.tsx');
    expect(claimScreen).not.toContain('${NPC_BASE_URL}/api/v1/');
  });

  it('disables server-side quote locking during account setup', () => {
    // A NUT-20 locked quote is unmintable here by design — the keyring overlay
    // refuses to serve a key for `nut20_mint_quote` purpose — and the plugin's
    // failure-safe watermark then pins the sync cursor behind it, stalling
    // every later receive. Setting `lockQuotes: false` is what keeps the lane
    // open, so the call must survive refactors of the account bootstrap.
    const manager = read('shared/lib/cashu/manager.ts');
    expect(manager).toContain('ensureNpcQuotesUnlocked');
    expect(manager).toContain('settings.setLock(false)');
  });
});
