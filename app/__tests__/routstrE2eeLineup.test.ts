/**
 * @jest-environment node
 */

/**
 * The encrypted half of a node's catalog must be reachable.
 *
 * A provider is badged "end to end encrypted" when its catalog carries a
 * `tinfoil-` model, and `useProviderRows` sorts those providers first — so it
 * is the badge a privacy-minded user goes straight for. But an enclave row
 * carries no `canonical_slug` and a display name with no vendor prefix and no
 * colon (`Private (E2EE) GLM 5.3`, `kimi-k3`, `deepseek-v4-flash`), so every
 * grouping signal in `providerIdForModel` returned null for it and
 * `deriveLineup` dropped the row before it could be offered.
 *
 * Observed on device (`ai.redsh1ft.com`, 582 models, 13 of them served from an
 * enclave): `ai.lineup.derived` listed twelve vendors and none of them was the
 * encrypted one, so every `ai.send.request` under that badge carried a
 * plaintext id (`gpt-oss-20b`, `gpt-5.2:batch`). `@routstr/sdk` only seals a
 * request whose model id starts with `tinfoil-`, so the badge promised an
 * encryption the app never sent. On a node that serves nothing else the same
 * drop emptied the menu outright — `{"catalogSize": 10, "totalQualifying": 0,
 * "allProvidersEmpty": true}`.
 *
 * These cases pin the reachability, not the cosmetics: the sealed rows group,
 * they survive the menu's audience rules, and nothing unsealed is ever offered
 * beside them.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

import type { RoutstrModel } from '@/shared/lib/routstr/api';
import {
  AI_TIER_IDS,
  E2EE_MODEL_PREFIX,
  E2EE_PROVIDER_ID,
  deriveLineup,
  isE2eeModelId,
  lineupProviderIds,
  providerIdForModel,
  type AiLineup,
} from '@/shared/lib/routstr/lineup';

/** Pinned "now", inside the lineup's ~18-month freshness window for the rows
 *  below, so tier assignment stays deterministic as this file ages. */
const NOW_SECONDS = 1_790_000_000;

/**
 * A catalog row in the shape `ai.redsh1ft.com` actually serves: no slug, and a
 * display name that names no vendor. Faithfulness matters more than brevity
 * here — the bug was entirely in what these rows DON'T carry.
 */
const row = (
  id: string,
  name: string,
  completion: number,
  created: number,
  slug: string | null = null
): RoutstrModel =>
  ({
    id,
    name,
    canonical_slug: slug,
    enabled: true,
    created,
    context_length: 256_000,
    architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    sats_pricing: {
      prompt: completion / 4,
      completion,
      request: 0.001,
      max_cost: completion * 4000,
    },
    upstream_provider_id: 'tinfoil',
  }) as unknown as RoutstrModel;

/** The five sealed rows, priced apart so the tier ladder has somewhere to go. */
const SEALED: RoutstrModel[] = [
  row('tinfoil-gemma4-31b', 'Private (E2EE) Gemma 4 31B', 0.0011, NOW_SECONDS - 5_000),
  row('tinfoil-glm-5-3-flash', 'Private (E2EE) GLM 5.3 Flash', 0.0015, NOW_SECONDS - 4_000),
  row('tinfoil-deepseek-v4-flash', 'deepseek-v4-flash', 0.0023, NOW_SECONDS - 3_000),
  row('tinfoil-glm-5-3', 'Private (E2EE) GLM 5.3', 0.0069, NOW_SECONDS - 2_000),
  row('tinfoil-kimi-k3', 'kimi-k3', 0.024, NOW_SECONDS - 1_000),
];

/**
 * The unsealed twin. The node lists it under the identical display name at the
 * identical price, and only the prefixed id is encrypted — so this is the row
 * that must never be offered as one.
 */
const PLAINTEXT_TWIN = row('glm-5-3', 'Private (E2EE) GLM 5.3', 0.0069, NOW_SECONDS - 2_000);

/** Ordinary vendor rows — slug-bearing, the way the rest of the catalog is. */
const vendorRows = (vendor: string, count: number): RoutstrModel[] =>
  Array.from({ length: count }, (_, i) =>
    row(
      `${vendor}-m${i}`,
      `${vendor}-m${i}`,
      1e-6 * (i + 1),
      NOW_SECONDS - i * 100,
      `${vendor}/m${i}`
    )
  );

const offeredIds = (lineup: AiLineup, provider: string): string[] =>
  AI_TIER_IDS.map((tier) => lineup[provider]?.[tier]?.modelId).filter(
    (id): id is string => id != null
  );

describe('encrypted models are reachable from the lineup', () => {
  it('groups a sealed row that names no vendor anywhere else', () => {
    // Every other signal is absent by construction: this is the whole bug.
    for (const model of SEALED) {
      expect(model.canonical_slug).toBeNull();
      expect(providerIdForModel(model)).toBe(E2EE_PROVIDER_ID);
    }
  });

  it('refuses the unsealed twin hiding behind the same display name', () => {
    // Same name, same price, no prefix — and `@routstr/sdk` would send it in
    // the clear. Grouping it here would put a plaintext model in the one tab
    // whose whole meaning is that it is encrypted.
    expect(providerIdForModel(PLAINTEXT_TWIN)).not.toBe(E2EE_PROVIDER_ID);
  });

  it('offers the sealed vendor, and offers nothing under it the SDK would send in the clear', () => {
    const { lineup } = deriveLineup([...SEALED, PLAINTEXT_TWIN], NOW_SECONDS);
    const offered = offeredIds(lineup, E2EE_PROVIDER_ID);
    expect(lineupProviderIds(lineup)).toContain(E2EE_PROVIDER_ID);
    expect(offered.length).toBe(AI_TIER_IDS.length);
    for (const id of offered) expect(isE2eeModelId(id)).toBe(true);
  });

  it('fills the menu for a node that serves nothing but enclaves', () => {
    // The device log's `{"catalogSize": 10, "totalQualifying": 0}` — a node
    // the user picked FOR its encryption, answering with an empty model menu.
    const { lineup, stats } = deriveLineup(SEALED, NOW_SECONDS);
    expect(stats.totalQualifying).toBe(SEALED.length);
    expect(lineupProviderIds(lineup)).toEqual([E2EE_PROVIDER_ID]);
  });

  it('keeps a two-model enclave vendor, which the ladder minimum would drop', () => {
    // The minimum exists so a long catalog does not fill the strip with
    // one-model tabs. It must not be what decides whether an encryption the
    // badge already promised can be sent at all.
    const { lineup } = deriveLineup([...SEALED.slice(0, 2), ...vendorRows('qwen', 5)], NOW_SECONDS);
    expect(lineupProviderIds(lineup)).toContain(E2EE_PROVIDER_ID);
  });

  it('keeps the sealed vendor when a crowded catalog overflows the tab strip', () => {
    const crowded = [
      ...SEALED,
      ...Array.from({ length: 30 }, (_, i) => vendorRows(`vendor${i}`, 4)).flat(),
    ];
    const offered = lineupProviderIds(deriveLineup(crowded, NOW_SECONDS).lineup);
    expect(offered).toContain(E2EE_PROVIDER_ID);
    // The cap still holds: the sealed vendor takes a slot, it does not add one.
    expect(offered.length).toBeLessThanOrEqual(12);
  });

  it('agrees with the provider badge, so the badge cannot promise an empty tab', () => {
    // `fetchProviderModelSummary` / `seedFromNode` decide the badge with this
    // same predicate. Any catalog it calls encrypted must therefore produce a
    // sealed tab, or the badge is advertising something unreachable.
    const catalog = [...SEALED.slice(0, 1), ...vendorRows('qwen', 5)];
    expect(catalog.some((model) => isE2eeModelId(model.id))).toBe(true);
    expect(lineupProviderIds(deriveLineup(catalog, NOW_SECONDS).lineup)).toContain(
      E2EE_PROVIDER_ID
    );
  });
});

describe('the prefix the app groups on is the prefix the SDK seals on', () => {
  /** Every build that carries the constant; the workspace may hoist it. */
  const ROOTS = [
    resolve(__dirname, '..', 'node_modules', '@routstr', 'sdk', 'dist'),
    resolve(__dirname, '..', '..', 'node_modules', '@routstr', 'sdk', 'dist'),
  ];
  const distRoot = ROOTS.find((root) => existsSync(root));

  it('found the installed package to check', () => {
    expect(distRoot).toBeTruthy();
  });

  it("pins `isTinfoilModel`'s prefix, which decides whether the body is sealed", () => {
    // `tinfoilEnabled = Boolean(modelId && isTinfoilModel(modelId))` is the
    // SDK's only switch onto the EHBP path. If upstream renames the namespace,
    // our grouping silently offers plaintext models under an E2EE tab — so it
    // has to fail here rather than on a device.
    const bundle = readFileSync(resolve(distRoot ?? '', 'browser.mjs'), 'utf8');
    expect(bundle).toContain(`TINFOIL_MODEL_PREFIX = "${E2EE_MODEL_PREFIX}"`);
  });
});
