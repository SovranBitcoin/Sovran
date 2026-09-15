import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadE2E } from '../core/loader';
import { expandScenario } from '../core/plan';
import { selectSuiteScenarios } from '../core/selection';
import { DRIVER_CAPS } from '../schema';
import screenshotContext from '../../../press/artwork/source/screenshot-context.json';

export const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export type Platform = 'ios' | 'android';
export const NATIVE_FRESHNESS =
  'unverified: no build-bound stamp; verify a rebuild before promotion';

// Occurrence is per canonical page within a scenario, NOT the artifact sequence.
const mappings = [
  ...['wallet', 'contacts', 'ai', 'lightning-receive'].map((page) => ({
    scenario: 'store.screenshots',
    page,
    occurrence: 1,
    name: page,
  })),
  ...[
    'mint-select',
    'mint-info',
    'receive-qr',
    'send',
    'dm-chat',
    'feed',
    'notifications',
    'settings',
  ].map((page) => ({
    scenario: 'marketing.screenshots',
    page,
    occurrence: 1,
    name: page,
  })),
  { scenario: 'marketing.screenshots', page: 'ai', occurrence: 2, name: 'ai-model-picker' },
  ...['theme-preview', 'gallery'].map((page) => ({
    scenario: 'marketing.screenshots.wallpapers',
    page,
    occurrence: 1,
    name: page,
  })),
  ...[
    'navy',
    'sunset',
    'beige',
    'in-eclipse',
    'edge-of-lunar-day',
    'setting-earth',
    'new-moon',
    'looking-back-at-earth',
  ].map((theme, index) => ({
    scenario: 'marketing.screenshots.wallpapers',
    page: 'wallet',
    occurrence: index + 1,
    name: `wallet-${theme}`,
  })),
  ...['mint-reviews', 'notification-mint-changes'].map((page) => ({
    scenario: 'marketing.screenshots.mints',
    page,
    occurrence: 1,
    name: page,
  })),
  ...['thread', 'image-viewer', 'stories'].map((page) => ({
    scenario: 'marketing.screenshots.media',
    page,
    occurrence: 1,
    name: page,
  })),
  { scenario: 'backup.flow', page: 'backup-words', occurrence: 1, name: 'backup-words' },
  {
    scenario: 'settings.keyring.generate',
    page: 'settings-keyring',
    occurrence: 2,
    name: 'settings-keyring',
  },
  {
    scenario: 'receive.qr-display.tabs',
    page: 'receive-qr',
    occurrence: 6,
    name: 'receive-qr-p2pk',
  },
];

export function createPressPlan(platforms: Platform[], root = ROOT) {
  const loaded = loadE2E(join(root, 'app/e2e'));
  if (loaded.issues.length)
    throw new Error(
      `E2E loader rejected ${loaded.issues.length} issue(s); run bun app/e2e/cli.ts validate`
    );
  const invocations = platforms.flatMap((platform) =>
    [
      { suite: 'store-screenshots', scenario: undefined },
      { suite: 'marketing-screenshots', scenario: undefined },
      ...['backup.flow', 'settings.keyring.generate', 'receive.qr-display.tabs'].map(
        (scenario) => ({ suite: 'full', scenario })
      ),
    ].map(({ suite, scenario }) => {
      const selected = selectSuiteScenarios(loaded.suites, loaded.scenarios, { suite, scenario });
      if (
        suite === 'full' &&
        (selected.scenarios.length !== 1 || selected.scenarios[0].id !== scenario)
      )
        throw new Error(
          `Press full selection must contain exactly ${scenario}, without predecessors`
        );
      const scenarios = selected.scenarios.map((item) => {
        const plan = expandScenario(item, loaded.fixtures, {
          capabilities: new Set(DRIVER_CAPS[platform === 'ios' ? 'sim' : 'android']),
        });
        if (
          item.lane !== 'simulator' ||
          item.funds ||
          plan.availability !== 'ready' ||
          plan.requires.some((cap) => cap !== 'fresh-install') ||
          plan.steps.some(({ action }) =>
            ['counterparty', 'exec', 'setClipboard', 'capture'].includes(action)
          )
        )
          throw new Error(
            `Unsafe or unavailable press scenario: ${item.id}; simulator/no-funding only`
          );
        if (!mappings.some((mapping) => mapping.scenario === item.id))
          throw new Error(`Unmapped press scenario: ${item.id}`);
        const counts = new Map<string, number>();
        const captures = plan.steps.flatMap(({ step, id, phase }) => {
          if (step.action !== 'screenshot') return [];
          if (phase !== 'test' && phase !== 'verify')
            throw new Error(`Press capture outside test/verify phases: ${item.id}/${id}`);
          const occurrence = (counts.get(step.name) ?? 0) + 1;
          counts.set(step.name, occurrence);
          return [{ page: step.name, occurrence, stepId: id }];
        });
        return { id: item.id, lane: item.lane, endState: item.endState, captures };
      });
      return { platform, suite, ...(scenario ? { scenario } : {}), scenarios };
    })
  );
  const captures = platforms.flatMap((platform) =>
    mappings.map((mapping) => {
      const scenario = invocations
        .filter((invocation) => invocation.platform === platform)
        .flatMap((invocation) => invocation.scenarios)
        .find((item) => item.id === mapping.scenario);
      const capture = scenario?.captures.find(
        (item) => item.page === mapping.page && item.occurrence === mapping.occurrence
      );
      if (!capture)
        throw new Error(
          `Missing planned capture: ${mapping.scenario}/${mapping.page}/${mapping.occurrence}`
        );
      const context = mapping.name.startsWith('wallet-') ? 'wallet-appearance' : mapping.name;
      const metadata =
        screenshotContext.contexts[context as keyof typeof screenshotContext.contexts];
      if (!metadata || metadata.page !== mapping.page)
        throw new Error(`Missing or mismatched screenshot context: ${context}`);
      return {
        platform,
        ...mapping,
        stepId: capture.stepId,
        key: `${platform}/${mapping.name}`,
        context,
        metadata,
      };
    })
  );
  const registered = Object.keys(
    JSON.parse(readFileSync(join(root, 'press/artwork/source/screenshots.json'), 'utf8'))
  );
  const unsupportedRegistered = registered.filter(
    (key) =>
      platforms.some((platform) => key.startsWith(`${platform}/`)) &&
      !captures.some((capture) => capture.key === key)
  );
  return {
    version: 1,
    nativeFreshness: NATIVE_FRESHNESS,
    websitePlatform: 'ios',
    contextVersion: screenshotContext.version,
    collections: screenshotContext.collections,
    invocations,
    captures,
    unsupportedRegistered,
  };
}

export type PressPlan = ReturnType<typeof createPressPlan>;

/** Narrow a validated plan, never expand the press allowlist through CLI input. */
export function selectPressScenario(plan: PressPlan, scenario?: string): PressPlan {
  if (scenario === undefined) return plan;
  const invocations = plan.invocations.flatMap((invocation) => {
    const scenarios = invocation.scenarios.filter(({ id }) => id === scenario);
    return scenarios.length ? [{ ...invocation, scenario, scenarios }] : [];
  });
  if (!invocations.length) throw new Error(`Not an approved press scenario: ${scenario}`);
  return {
    ...plan,
    invocations,
    captures: plan.captures.filter((capture) => capture.scenario === scenario),
  };
}

export function nativeArgs(invocation: PressPlan['invocations'][number]) {
  return [
    'app/e2e/cli.ts',
    'run',
    '--suite',
    invocation.suite,
    ...(invocation.scenario ? ['--scenario', invocation.scenario] : []),
    '--driver',
    invocation.platform === 'ios' ? 'sim' : 'android',
    '--evidence',
    'screenshots',
    '--no-record',
    '--i-approve-destructive-reset',
  ];
}
