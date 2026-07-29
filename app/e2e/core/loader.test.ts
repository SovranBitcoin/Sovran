import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadE2E } from './loader';
import { isValuelessTestMint } from '../funded/test-mints';
import { effectiveRequirements, expandScenario, unsafeCocodEffects } from './plan';
import {
  CAPABILITIES,
  DRIVER_CAPS,
  formatDoc,
  REINSTALL_KEYCHAIN_RETENTION_CAPABILITY,
  scenarioPlatforms,
} from '../schema';

// The real e2e tree (app/e2e) — this is an integration check over the committed
// example suite/scenario/fixture, proving load → validate → expand end to end.
const E2E = new URL('..', import.meta.url).pathname;

describe('loadE2E over the real tree', () => {
  const loaded = loadE2E(E2E);

  it('loads the example suite/scenario/fixture with no issues', () => {
    expect(loaded.issues).toEqual([]);
    expect(loaded.scenarios.has('onboarding.fresh')).toBe(true);
    expect(loaded.fixtures.has('flow.fresh-install')).toBe(true);
    expect(loaded.suites.length).toBeGreaterThanOrEqual(1);
  });

  it('requires every canonical scenario to author a non-empty verify section', () => {
    expect(loaded.scenarios.size).toBe(126);
    for (const scenario of loaded.scenarios.values()) {
      expect(scenario.verify.length).toBeGreaterThan(0);
    }
  });

  it('retries the onboarding welcome reveal until the gesture visibly lands', () => {
    const revealWelcome = {
      action: 'tapUntil' as const,
      sequence: [{ swipe: { dir: 'up' as const } }],
      until: { label: 'Welcome to Sovran' },
      attempts: 4,
      settleMs: 3_000,
    };

    expect(loaded.fixtures.get('flow.onboard')!.steps).toContainEqual(revealWelcome);
    for (const id of [
      'onboarding.fresh',
      'onboarding.relaunch-interrupt',
      'onboarding.terms-gate',
      'onboarding.offline',
    ]) {
      const scenario = loaded.scenarios.get(id)!;
      expect(scenario.steps).toContainEqual(revealWelcome);
      expect(scenario.steps).not.toContainEqual({ action: 'swipe', dir: 'up' });
    }
  });

  it('proves developer-mode unlock with the on-screen toast container, not an off-screen row', () => {
    for (const id of [
      'settings.design-system.showcase',
      'receive.qr-display.offline',
      'send.mock-fail.ecash',
      'send.mock-fail.lightning',
    ]) {
      const scenario = loaded.scenarios.get(id)!;
      const unlock = scenario.steps.find(
        (step) =>
          step.action === 'tapUntil' &&
          step.sequence.some(
            (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'settings-version-row'
          )
      );
      expect(unlock).toBeDefined();
      expect(unlock).toMatchObject({ until: { id: 'e2e-toast-dev-mode' } });
      expect(unlock).not.toMatchObject({ until: { id: 'settings-design-system-row' } });
      expect(unlock).not.toMatchObject({ until: { label: 'Developer mode enabled' } });
    }
  });

  it('retries native wallet-menu choices until the wallet state changes', () => {
    const usdChoice = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { label: 'USD account' } }],
      until: { id: 'wallet-selected-mint:mint.cubabitcoin.org' },
      attempts: 4,
      settleMs: 6_000,
    };
    const usdScenarioIds = [
      'wallet.unit.switch-usd',
      'wallet.unit.relaunch',
      'receive.lightning.usd-dismiss',
    ];

    for (const id of usdScenarioIds) {
      const scenario = loaded.scenarios.get(id)!;
      expect(scenario.steps).toContainEqual(usdChoice);
      expect(scenario.steps).not.toContainEqual({
        action: 'tap',
        selector: { label: 'USD account' },
      });
    }

    const switchScenario = loaded.scenarios.get('wallet.unit.switch-usd')!;
    expect(switchScenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Bitcoin account' } }],
      until: { id: 'wallet-fiat-pill' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(switchScenario.steps).not.toContainEqual({
      action: 'tap',
      selector: { label: 'Bitcoin account' },
    });

    const currencyCases = [
      { id: 'wallet.currency.display', choices: ['gbp', 'eur', 'usd'] },
      { id: 'wallet.currency.relaunch', choices: ['gbp', 'usd'] },
    ] as const;
    for (const { id, choices } of currencyCases) {
      const scenario = loaded.scenarios.get(id)!;
      for (const currency of choices) {
        const label = currency.toUpperCase();
        expect(scenario.steps).toContainEqual({
          action: 'tapUntil',
          sequence: [{ tap: { label } }],
          until: { id: `wallet-fiat-currency:${currency}` },
          attempts: 4,
          settleMs: 6_000,
        });
        expect(scenario.steps).not.toContainEqual({
          action: 'tap',
          selector: { label },
        });
      }
    }
  });

  it('proves mint selections and save completion without covered-route AX false positives', () => {
    const cases = [
      { id: 'mint.add.url', selectedLabels: ['Add (1)'] },
      { id: 'mint.add.relaunch', selectedLabels: ['Add (1)'] },
      { id: 'mint.add.mixed-discovery-manual', selectedLabels: ['Add (1)', 'Add (2)'] },
      { id: 'mint.add.multiple', selectedLabels: ['Add (1)', 'Add (2)', 'Add (3)'] },
    ] as const;

    for (const { id, selectedLabels } of cases) {
      const scenario = loaded.scenarios.get(id)!;
      const selectedLabelSet = new Set<string>(selectedLabels);
      const selectionSteps = scenario.steps.filter(
        (step) =>
          step.action === 'tapUntil' &&
          'label' in step.until &&
          selectedLabelSet.has(step.until.label)
      );
      expect(
        selectionSteps.map((step) => (step.action === 'tapUntil' ? step.until : null))
      ).toEqual(selectedLabels.map((label) => ({ label })));

      const saveAt = scenario.steps.findIndex(
        (step) =>
          step.action === 'tapUntil' &&
          step.sequence.some(
            (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'mint-add-confirm'
          ) &&
          'id' in step.until &&
          step.until.id === 'e2e-toast-mints-added'
      );
      const addScreenGoneAt = scenario.steps.findIndex(
        (step) =>
          step.action === 'assert' &&
          step.that === 'notVisible' &&
          'id' in step.selector &&
          step.selector.id === 'mint-add-confirm'
      );
      const postSaveSwipeAt = scenario.steps.findIndex(
        (step, index) => index > addScreenGoneAt && step.action === 'swipe' && step.dir === 'up'
      );
      const persistedMintAt = scenario.steps.findIndex((step, index) => {
        if (index <= postSaveSwipeAt) return false;
        if (step.action === 'waitFor')
          return 'id' in step.selector && step.selector.id.startsWith('contact-row:mint:');
        if (step.action === 'tapUntil')
          return 'id' in step.until && step.until.id.startsWith('contact-row:mint:');
        return false;
      });

      expect(saveAt).toBeGreaterThan(-1);
      expect(addScreenGoneAt).toBeGreaterThan(saveAt);
      expect(postSaveSwipeAt).toBeGreaterThan(addScreenGoneAt);
      expect(persistedMintAt).toBeGreaterThan(postSaveSwipeAt);
      expect(
        scenario.steps.filter((step) => step.action === 'swipe' && step.dir === 'up')
      ).toHaveLength(2);
      expect(scenario.steps).not.toContainEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: 'mint-add-confirm' } }],
        until: { id: 'mint-select-add' },
        attempts: expect.any(Number),
        settleMs: expect.any(Number),
      });
    }

    const urlSteps = loaded.scenarios.get('mint.add.url')!.steps;
    const urlSaveAt = urlSteps.findIndex(
      (step) =>
        step.action === 'tapUntil' &&
        'id' in step.until &&
        step.until.id === 'e2e-toast-mints-added'
    );
    const persistedTestnutSelectionAt = urlSteps.findIndex(
      (step) =>
        step.action === 'tapUntil' &&
        step.sequence.some(
          (item) =>
            'tap' in item &&
            'id' in item.tap &&
            item.tap.id === 'contact-row:mint:https://testnut.cashu.space'
        ) &&
        'id' in step.until &&
        step.until.id === 'wallet-selected-mint:testnut.cashu.space'
    );
    expect(persistedTestnutSelectionAt).toBeGreaterThan(urlSaveAt);
    expect(urlSteps[persistedTestnutSelectionAt]).toEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'contact-row:mint:https://testnut.cashu.space' } }],
      until: { id: 'wallet-selected-mint:testnut.cashu.space' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(urlSteps).not.toContainEqual({
      action: 'tap',
      selector: { id: 'contact-row:mint:https://testnut.cashu.space' },
    });

    const multiSteps = loaded.scenarios.get('mint.add.multiple')!.steps;
    expect(multiSteps).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'contact-row:mint:', matchIndex: 2 },
      timeoutMs: 60_000,
    });
    const capturedMints = ['mintOneUrl', 'mintTwoUrl', 'mintThreeUrl'];
    const bidirectionalTraversal = [
      { delayMs: 100 },
      { swipe: { dir: 'down' } },
      { swipe: { dir: 'down' } },
      { swipe: { dir: 'up' } },
      { swipe: { dir: 'up' } },
      { swipe: { dir: 'up' } },
    ];
    for (const [index, variable] of capturedMints.entries()) {
      expect(multiSteps).toContainEqual({
        action: 'waitFor',
        selector: {
          idPrefix: 'contact-row:mint:',
          matchIndex: index,
          captureSuffixAs: variable,
        },
        timeoutMs: index === 0 ? 60_000 : 30_000,
      });
      expect(multiSteps).toContainEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: `contact-row:mint:\${${variable}}` } }],
        until: { label: `Add (${index + 1})` },
        attempts: 4,
        settleMs: 4_000,
      });
      const persistenceProofs = multiSteps.filter(
        (step) =>
          step.action === 'tapUntil' &&
          'id' in step.until &&
          step.until.id === `contact-row:mint:\${${variable}}`
      );
      expect(persistenceProofs).toHaveLength(2);
      for (const proof of persistenceProofs) {
        expect(proof).toMatchObject({
          action: 'tapUntil',
          sequence: bidirectionalTraversal,
          attempts: 2,
          settleMs: 1_000,
        });
      }
    }
    expect(JSON.stringify(multiSteps)).not.toContain('mint.28waves.com');
    expect(JSON.stringify(multiSteps)).not.toContain('mint.macadamia.cash');
    expect(JSON.stringify(multiSteps)).not.toContain('mint.lnserver.com');

    const cancelSteps = loaded.scenarios.get('mint.add.cancel')!.steps;
    const cancelledMintChecks = cancelSteps
      .map((step, index) => ({ step, index }))
      .filter(
        ({ step }) =>
          step.action === 'assert' &&
          step.that === 'notVisible' &&
          'id' in step.selector &&
          step.selector.id === 'contact-row:mint:https://testnut.cashu.space'
      );
    expect(cancelledMintChecks).toHaveLength(2);
    for (const { index } of cancelledMintChecks) {
      expect(cancelSteps[index - 1]).toEqual({ action: 'swipe', dir: 'up' });
    }
  });

  it('does not relaunch already-proven wallets during contacts-groups cleanup', () => {
    const cases = [
      {
        id: 'contacts.groups.tiers',
        cleanup: [{ action: 'location' as const, mode: 'clear' as const }],
      },
      {
        id: 'contacts.groups.mesh-chat',
        cleanup: [{ action: 'location' as const, mode: 'clear' as const }],
      },
      { id: 'contacts.groups.location-denied', cleanup: [] },
    ];

    for (const { id, cleanup } of cases) {
      const scenario = loaded.scenarios.get(id)!;
      const homeAt = scenario.steps.findIndex((step) => step.action === 'goHome');
      const walletProofAt = scenario.steps.findIndex(
        (step, index) =>
          index > homeAt &&
          step.action === 'waitFor' &&
          'label' in step.selector &&
          step.selector.label === 'Split'
      );

      expect(homeAt).toBeGreaterThan(-1);
      expect(walletProofAt).toBeGreaterThan(homeAt);
      expect(scenario.verify).toContainEqual({
        action: 'assert',
        that: 'visible',
        selector: { id: 'wallet-send' },
      });
      // Device cleanup does not navigate. Re-running flow.return-to-wallet
      // here cold-launched an already-proven wallet onto Feed on iOS, turning
      // successful test+verify phases red in cleanup.
      expect(scenario.finally).toEqual(cleanup);
    }
  });

  it('opens another profile without pull-to-refresh actions inside the retry', () => {
    const scenario = loaded.scenarios.get('profile.other.view')!;
    const resultRow =
      'contact-row:nostr:ec8cffdc71b36063e2c971a061a03ce886932bb7db8782bf5f6384348e9f7db3';

    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: resultRow } }],
      until: { id: 'user-profile:other' },
      attempts: 4,
      settleMs: 8_000,
    });
    expect(scenario.steps).not.toContainEqual({
      action: 'tapUntil',
      sequence: expect.arrayContaining([{ swipe: { dir: 'up' } }, { swipe: { dir: 'down' } }]),
      until: { id: 'user-profile:other' },
      attempts: expect.any(Number),
      settleMs: expect.any(Number),
    });
  });

  it('re-establishes a known wallet and drawer before opening the profile switcher', () => {
    const steps = loaded.scenarios.get('profile.switch.create')!.steps;
    const profileCaptureAt = steps.findIndex(
      (step) => step.action === 'capture' && step.as === 'profileOneName'
    );
    const homeAt = steps.findIndex(
      (step, index) => index > profileCaptureAt && step.action === 'goHome'
    );
    const walletReadyAt = steps.findIndex(
      (step, index) =>
        index > homeAt &&
        step.action === 'waitFor' &&
        'id' in step.selector &&
        step.selector.id === 'wallet-send'
    );
    const drawerReadyAt = steps.findIndex(
      (step, index) =>
        index > walletReadyAt &&
        step.action === 'tapUntil' &&
        step.sequence.some(
          (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'header-profile-avatar'
        ) &&
        'id' in step.until &&
        step.until.id === 'drawer-profile-switcher-open'
    );
    const switcherOpenAt = steps.findIndex(
      (step, index) =>
        index > drawerReadyAt &&
        step.action === 'tapUntil' &&
        step.sequence.some(
          (item) =>
            'tap' in item && 'id' in item.tap && item.tap.id === 'drawer-profile-switcher-open'
        ) &&
        'id' in step.until &&
        step.until.id === 'profile-create'
    );

    expect(profileCaptureAt).toBeGreaterThan(-1);
    expect(homeAt).toBeGreaterThan(profileCaptureAt);
    expect(walletReadyAt).toBeGreaterThan(homeAt);
    expect(drawerReadyAt).toBeGreaterThan(walletReadyAt);
    expect(switcherOpenAt).toBeGreaterThan(drawerReadyAt);
  });

  it('accepts Terms through one retried semantic checked control', () => {
    const acceptance = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { id: 'terms-acceptance' } }],
      until: { id: 'terms-acceptance' },
      untilValue: '1',
      attempts: 4,
      settleMs: 6_000,
    };
    const fixture = loaded.fixtures.get('flow.fresh-install')!;
    expect(fixture.steps).toContainEqual(acceptance);

    for (const id of [
      'onboarding.fresh',
      'onboarding.terms-gate',
      'onboarding.offline',
      'onboarding.relaunch-interrupt',
      'recovery.reinstall',
    ]) {
      const scenario = loaded.scenarios.get(id)!;
      const authored = [...scenario.setup, ...scenario.steps];
      expect(authored).toContainEqual(acceptance);
      expect(authored).not.toContainEqual({
        action: 'tap',
        selector: { label: 'I have read and agree to the Terms and Conditions' },
      });
    }
  });

  it('recovers an AI drawer navigation miss through the semantic tab', () => {
    const navigation = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { id: 'drawer-menu-ai' } }, { delayMs: 1_200 }, { tap: { id: 'tab-ai' } }],
      until: { id: 'ai-model-chip' },
      attempts: 4,
      settleMs: 6_000,
    };

    for (const id of [
      'ai.send.no-credits',
      'ai.history.empty',
      'ai.model.picker',
      'drawer.navigation',
    ]) {
      expect(loaded.scenarios.get(id)!.steps).toContainEqual(navigation);
    }
  });

  it('keeps every checked-in scenario screenshot unmasked for QA review', () => {
    for (const scenario of loaded.scenarios.values()) {
      const authoredSteps = [...scenario.setup, ...scenario.steps, ...scenario.verify];
      for (const step of authoredSteps) {
        if ('action' in step && step.action === 'screenshot') {
          expect(step.mask).toBeUndefined();
        }
      }
    }
  });

  it('keeps every funded happy path independently sweepable with matching suite requirements', () => {
    const ids = [
      'receive.cashu.paste',
      'receive.lightning.sat',
      'receive.lightning.change-mint.confirm',
      'receive.npc.default-mint',
      'receive.npc.change-mint',
      'send.cashu.sat',
      'send.cashu.preselect-funded-mint',
      'send.lightning.sat',
      'send.lightning.preselect-funded-mint',
      'send.search.npub',
    ];
    const full = loaded.suites.find((suite) => suite.name === 'full')!;
    for (const id of ids) {
      const scenario = loaded.scenarios.get(id)!;
      expect(scenario.finally.some((item) => 'use' in item && item.use === 'flow.sweep-mint')).toBe(
        true
      );
      expect([...full.scenarios.find((ref) => ref.id === id)!.requires].sort().join(',')).toBe(
        effectiveRequirements(scenario, loaded.fixtures).sort().join(',')
      );
    }
  });

  it('exempts the valueless testnut scenario from the sweep ceremony', () => {
    const scenario = loaded.scenarios.get('receive.cashu.unknown-mint')!;
    expect(scenario.funds?.assets.every((asset) => isValuelessTestMint(asset.mintUrl))).toBe(true);
    expect(scenario.finally.some((item) => 'use' in item && item.use === 'flow.sweep-mint')).toBe(
      false
    );
  });

  it('hands every funded Lightning fixture through one observed menu selection', () => {
    for (const fixtureId of [
      'flow.fund-lightning-50',
      'flow.fund-lightning-100',
      'flow.fund-lightning-200',
    ]) {
      const steps = loaded.fixtures.get(fixtureId)!.steps;
      const menuReadyAt = steps.findIndex(
        (step) =>
          'action' in step &&
          step.action === 'tapUntil' &&
          step.sequence.some(
            (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'amount-next'
          )
      );
      const chooseLightningAt = steps.findIndex(
        (step, index) =>
          index > menuReadyAt &&
          'action' in step &&
          step.action === 'tapAt' &&
          step.x === 0.5 &&
          step.y === 0.905
      );
      const invoiceReadyAt = steps.findIndex(
        (step, index) =>
          index > chooseLightningAt &&
          'action' in step &&
          step.action === 'waitFor' &&
          'id' in step.selector &&
          step.selector.id === 'payment-info-lightning-invoice-data'
      );

      expect(menuReadyAt).toBeGreaterThan(-1);
      expect(steps[menuReadyAt]).toEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: 'amount-next' } }],
        until: { id: 'e2e-action-menu-open' },
        attempts: 6,
        settleMs: 8_000,
      });
      expect(chooseLightningAt).toBe(menuReadyAt + 1);
      expect(invoiceReadyAt).toBe(chooseLightningAt + 1);
      expect(
        steps.filter(
          (step) =>
            'action' in step && step.action === 'tapAt' && step.x === 0.5 && step.y === 0.905
        )
      ).toHaveLength(1);
    }
  });

  it('keeps receive fault retries off blind action-menu coordinates', () => {
    const cases = [
      {
        id: 'fault.boot.all-mints-offline',
        attempts: 4,
        outcomes: ['payment-info-lightning-invoice-data'],
      },
      {
        id: 'fault.mint-quote.create-errors',
        attempts: 6,
        outcomes: [
          'e2e-toast-mint-unreachable',
          'e2e-toast-general-error',
          'e2e-toast-general-error',
        ],
      },
      {
        id: 'fault.mint-quote.create-offline',
        attempts: 6,
        outcomes: ['e2e-toast-mint-unreachable'],
      },
      {
        id: 'fault.mint-quote.poll-timeout',
        attempts: 6,
        outcomes: ['payment-info-lightning-invoice-data'],
      },
      {
        id: 'receive.offline.lightning-quote',
        attempts: 6,
        outcomes: ['e2e-toast-mint-unreachable'],
      },
    ] as const;

    for (const { id, attempts, outcomes } of cases) {
      const steps = loaded.scenarios.get(id)!.steps;
      const menuIndexes = steps
        .map((step, index) =>
          step.action === 'tapUntil' &&
          step.sequence.some(
            (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'amount-next'
          )
            ? index
            : -1
        )
        .filter((index) => index >= 0);

      expect(menuIndexes).toHaveLength(outcomes.length);
      for (const [outcomeIndex, menuAt] of menuIndexes.entries()) {
        expect(steps[menuAt]).toEqual({
          action: 'tapUntil',
          sequence: [{ tap: { id: 'amount-next' } }],
          until: { id: 'e2e-action-menu-open' },
          attempts,
          settleMs: 8_000,
        });
        expect(steps[menuAt + 1]).toEqual({ action: 'tapAt', x: 0.5, y: 0.905 });
        expect(steps[menuAt + 2]).toEqual({
          action: 'waitFor',
          selector: { id: outcomes[outcomeIndex] },
          timeoutMs: 60_000,
        });
      }
    }
  });

  it('proves tail mint transitions with destination chrome and persisted product state', () => {
    const offlineSwitch = loaded.scenarios.get('fault.mint-switch.all-offline')!;
    expect(offlineSwitch.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'contact-row:mint:https://testnut.cashu.space' } }],
      until: { label: 'Add (1)' },
      attempts: 4,
      settleMs: 4_000,
    });
    expect(offlineSwitch.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'mint-add-confirm' } }],
      until: { id: 'e2e-toast-mints-added' },
      attempts: 4,
      settleMs: 30_000,
    });
    expect(offlineSwitch.steps).not.toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'mint-add-confirm' } }],
      until: { id: 'mint-select-add' },
      attempts: 4,
      settleMs: 8_000,
    });
    expect(offlineSwitch.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'wallet-mint-selector' } }],
      until: { id: 'mint-select-add' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(offlineSwitch.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'contact-row:mint:https://testnut.cashu.space' } }],
      until: { id: 'wallet-selected-mint:testnut.cashu.space' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(offlineSwitch.steps).not.toContainEqual({
      action: 'tap',
      selector: { id: 'contact-row:mint:https://testnut.cashu.space' },
    });
    expect(JSON.stringify(offlineSwitch.steps)).not.toContain(
      '"until":{"id":"contact-row:mint:https://testnut.cashu.space"}'
    );
    expect(offlineSwitch.steps).toContainEqual({
      action: 'assert',
      that: 'mintFaultIntercepted',
      ruleId: 'all-mints-down',
      minCount: 1,
    });

    const amountSwitch = loaded.scenarios.get('send.cashu.change-mint.amount')!;
    expect(amountSwitch.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'amount-mint-selector' } }],
      until: { label: 'Select Mint' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(amountSwitch.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'contact-row:mint:https://mint.minibits.cash/Bitcoin' } }],
      until: { id: 'amount-selected-mint:mint.minibits.cash' },
      attempts: 4,
      settleMs: 6_000,
    });
  });

  it('observes tail FullWindowOverlay presentation and dismissal without blind delays', () => {
    for (const id of ['send.cashu.back-reentry', 'transactions.filter.direction']) {
      const steps = loaded.scenarios.get(id)!.steps;
      const menuAt = steps.findIndex(
        (step) =>
          step.action === 'tapUntil' &&
          step.sequence.some(
            (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'more-button'
          )
      );
      expect(steps[menuAt]).toEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: 'more-button' } }],
        until: { id: 'e2e-action-menu-open' },
        attempts: 4,
        settleMs: 6_000,
      });
      expect(steps[menuAt + 1]).toEqual({ action: 'tapAt', x: 0.5, y: 0.84 });
    }

    const dismissalCases = [
      ['fault.ecash-send.swap-10001', 0.2],
      ['fault.ecash-send.swap-11001', 0.2],
      ['fault.ecash-send.swap-11002', 0.2],
      ['fault.ecash-send.swap-11003', 0.2],
      ['fault.ecash-send.swap-malformed', 0.2],
      ['fault.ecash-send.swap-offline', 0.2],
      ['send.mock-fail.ecash', 0.2],
      ['signer.hub.paste', 0.15],
      ['wallet.deeplink.nostrconnect', 0.15],
    ] as const;
    for (const [id, y] of dismissalCases) {
      const steps = loaded.scenarios.get(id)!.steps;
      const dismissAt = steps.findIndex(
        (step) => step.action === 'tapAt' && step.x === 0.5 && step.y === y
      );
      expect(dismissAt).toBeGreaterThan(-1);
      expect(steps[dismissAt + 1]).toEqual({
        action: 'assert',
        that: 'notVisible',
        selector: { id: 'e2e-action-menu-open' },
        timeoutMs: 15_000,
      });
    }
    for (const scenario of loaded.scenarios.values()) {
      expect(JSON.stringify(scenario.steps)).not.toContain('sheet dismissal exposes no AX signal');
    }
  });

  it('returns to the wallet before resetting location permission in cleanup', () => {
    // Reset needs no UI; reset-then-relaunch would guarantee a location prompt
    // mid-cleanup (the relaunch re-requests), so the return-home flow runs first.
    expect(loaded.scenarios.get('wallet.location.permission')!.finally).toEqual([
      { use: 'flow.return-to-wallet' },
      { action: 'permission', service: 'location', mode: 'reset' },
    ]);
  });

  it('promotes the funded Lightning receive now that custody and reconciliation are enforced', () => {
    expect(loaded.scenarios.get('receive.lightning.sat')!.deferredReason).toBeUndefined();
  });

  it('promotes Cashu paste receive through typed custody and exact recovery sweep', () => {
    const scenario = loaded.scenarios.get('receive.cashu.paste')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.steps).toContainEqual({
      action: 'counterparty',
      operation: 'cashu.create',
      mintUrl: 'https://mint.sovran.money',
      unit: 'sat',
      accountIndex: 0,
      amount: 50,
      captureAs: 'incomingToken',
      setClipboard: true,
      timeoutMs: 60_000,
    });
    expect(scenario.finally).toContainEqual({
      use: 'flow.sweep-mint',
      with: {
        mintUrl: 'https://mint.sovran.money',
        unit: 'sat',
        accountIndex: 0,
      },
    });
    expect(JSON.stringify(scenario.steps)).toContain('receive-method-paste');
    expect(JSON.stringify(scenario.steps)).toContain('receive-token-redeem');
    expect(JSON.stringify(scenario.steps)).toContain('receive-token-close');
    // The paste-method tap is dead-tap-hardened and retried until the
    // post-paste redeem sheet appears — NOT until the iOS paste-consent alert,
    // which Android never shows (clipboard reads are unblocked there, so an
    // 'Allow Paste' until-target can never appear). iOS is covered by the
    // driver's auto-press plus the optional grant tap below.
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'receive-method-paste' } }],
      until: { id: 'receive-token-redeem' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { label: 'Allow Paste' },
      optional: { reason: 'android has no blocking paste dialog' },
    });
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'transaction-probe-', captureSuffixAs: 'receiveTx' },
      timeoutMs: 30_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'assert',
      that: 'tx',
      txRef: '${receiveTx}',
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
      source: 'paste',
    });
  });

  it('promotes Cashu preview dismissal without redeeming or duplicating cleanup UI', () => {
    const scenario = loaded.scenarios.get('receive.cashu.dismiss')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'transaction-probe-', captureSuffixAs: 'previewTx' },
      timeoutMs: 30_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'assert',
      that: 'tx',
      txRef: '${previewTx}',
      direction: 'in',
      amount: 50,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'prepared',
    });
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { id: 'receive-token-cancel' },
    });
    expect(scenario.steps.at(-1)).toEqual({ action: 'goHome' });
    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'notVisible',
      selector: { id: 'transaction-${previewTx}' },
    });
    expect(scenario.finally).toEqual([
      {
        use: 'flow.sweep-mint',
        with: {
          mintUrl: 'https://mint.sovran.money',
          unit: 'sat',
          accountIndex: 0,
        },
      },
      { action: 'waitFor', selector: { label: '₿ 0' }, timeoutMs: 45_000 },
    ]);
    expect(JSON.stringify(scenario)).not.toContain('receive-token-dismiss');
  });

  it('promotes pending Cashu reclaim through rendered overflow actions and wallet conservation', () => {
    const scenario = loaded.scenarios.get('send.cashu.pending-reclaim')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Send' } }],
      until: { id: 'send-method-createEcash' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { id: 'amount-next' },
      state: 'enabled',
      timeoutMs: 30_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'transaction-probe-', captureSuffixAs: 'sendTx' },
      timeoutMs: 30_000,
    });

    const pendingProof = {
      action: 'assert' as const,
      that: 'tx' as const,
      txRef: '${sendTx}',
      direction: 'out' as const,
      amount: 40,
      unit: 'sat' as const,
      mintHost: 'mint.sovran.money',
      status: 'pending',
      source: null,
    };
    const rolledBackProof = { ...pendingProof, status: 'rolledBack' };
    expect(scenario.steps).toContainEqual(pendingProof);
    expect(scenario.steps).toContainEqual(rolledBackProof);
    expect(scenario.steps).toContainEqual({
      action: 'assert',
      that: 'notVisible',
      selector: { id: 'payment-info-token-data' },
      timeoutMs: 30_000,
    });

    // The iOS action menu can silently wedge (probe never renders) and the
    // pending toast lingers over the header. Every open and every semantic
    // row action must therefore retry against observable app state.
    const actionMenuOpen = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { id: 'more-button' } }],
      until: { id: 'e2e-action-menu-open' },
      attempts: 4,
      settleMs: 6_000,
    };
    expect(
      scenario.steps.filter((step) => JSON.stringify(step) === JSON.stringify(actionMenuOpen))
    ).toHaveLength(2);
    expect(
      scenario.steps.filter(
        (step) =>
          step.action === 'tap' && 'id' in step.selector && step.selector.id === 'more-button'
      )
    ).toHaveLength(0);
    expect(scenario.steps.filter((step) => step.action === 'tapAt')).toEqual([]);
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'send-token-check-status' } }],
      until: { id: 'e2e-toast-token-pending-not-redeemed' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'send-token-cancel-transaction' } }],
      until: { id: 'e2e-toast-transaction-cancelled' },
      attempts: 4,
      settleMs: 12_000,
    });

    const authored = JSON.stringify(scenario);
    expect(authored).toContain('e2e-toast-token-pending-not-redeemed');
    expect(authored).toContain('e2e-toast-transaction-cancelled');
    expect(authored).not.toContain('pendingToken');
    expect(authored).toContain('send-token-check-status');
    expect(authored).toContain('send-token-cancel-transaction');
    expect(authored).not.toContain('Token is still pending — not yet redeemed');
    expect(authored).not.toContain('Transaction cancelled successfully');

    const indexOfWaitLabel = (label: string) =>
      scenario.steps.findIndex(
        (step) =>
          step.action === 'waitFor' && 'label' in step.selector && step.selector.label === label
      );
    const indexOfDelta = (delta: number) =>
      scenario.steps.findIndex(
        (step) => step.action === 'assert' && step.that === 'balanceDelta' && step.delta === delta
      );
    const pendingHome = scenario.steps.findIndex((step) => step.action === 'goHome');
    const pendingProofIndex = scenario.steps.findIndex(
      (step) =>
        step.action === 'assert' &&
        step.that === 'tx' &&
        step.txRef === '${sendTx}' &&
        step.status === 'pending'
    );
    const pendingBalance = indexOfWaitLabel('₿ 60');
    const pendingDelta = indexOfDelta(-40);
    const transactionReopens = scenario.steps.flatMap((step, index) =>
      step.action === 'tapUntil' &&
      step.sequence.some(
        (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'transaction-send-${sendTx}'
      ) &&
      'id' in step.until &&
      step.until.id === 'send-token-id-${sendTx}'
        ? [index]
        : []
    );
    expect(transactionReopens).toHaveLength(2);
    const [firstReopen, persistedReopen] = transactionReopens;
    const rolledBackIndex = scenario.steps.findIndex(
      (step) =>
        step.action === 'assert' &&
        step.that === 'tx' &&
        step.txRef === '${sendTx}' &&
        step.status === 'rolledBack'
    );
    const restoredHome = scenario.steps.findIndex(
      (step, index) => index > rolledBackIndex && step.action === 'goHome'
    );
    const restoredBalance = indexOfWaitLabel('₿ 100');
    const restoredDelta = indexOfDelta(0);
    expect(pendingHome).toBeGreaterThan(pendingProofIndex);
    expect(pendingBalance).toBeGreaterThan(pendingHome);
    expect(pendingDelta).toBeGreaterThan(pendingBalance);
    expect(firstReopen).toBeGreaterThan(pendingDelta);
    expect(restoredHome).toBeGreaterThan(rolledBackIndex);
    expect(restoredBalance).toBeGreaterThan(restoredHome);
    expect(restoredDelta).toBeGreaterThan(restoredBalance);
    expect(persistedReopen).toBeGreaterThan(restoredDelta);

    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'visible',
      selector: { label: 'Cancelled' },
    });
    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'visible',
      selector: { label: 'Funds returned to your balance' },
    });
    expect(scenario.verify.at(-2)).toEqual({ action: 'goHome' });
    expect(scenario.verify.at(-1)).toEqual({
      action: 'waitFor',
      selector: { id: 'wallet-send' },
      timeoutMs: 45_000,
    });
    expect(scenario.finally).toEqual([
      {
        use: 'flow.sweep-mint',
        with: {
          mintUrl: 'https://mint.sovran.money',
          unit: 'sat',
          accountIndex: 0,
        },
      },
      { action: 'waitFor', selector: { label: '₿ 0' }, timeoutMs: 45_000 },
    ]);
  });

  it('addresses every funded transaction overflow action by stable id', () => {
    const cases = [
      { id: 'send.cashu.dm-contact', actions: ['send-token-cancel-transaction'] },
      {
        id: 'send.cashu.pending-reclaim',
        actions: ['send-token-check-status', 'send-token-cancel-transaction'],
      },
      { id: 'send.cashu.pending-relaunch', actions: ['send-token-cancel-transaction'] },
      {
        id: 'transactions.filter.status',
        actions: ['send-token-check-status', 'send-token-cancel-transaction'],
      },
    ] as const;

    for (const { id, actions } of cases) {
      const scenario = loaded.scenarios.get(id)!;
      const moreMenuIndexes = scenario.steps.flatMap((step, index) =>
        step.action === 'tapUntil' &&
        step.sequence.some(
          (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'more-button'
        )
          ? [index]
          : []
      );
      expect(moreMenuIndexes).toHaveLength(actions.length);
      moreMenuIndexes.forEach((menuIndex, index) => {
        expect(scenario.steps[menuIndex + 1]).toMatchObject({
          action: 'tapUntil',
          sequence: [{ tap: { id: actions[index] } }],
        });
      });
    }
  });

  it('retries wallet transaction rows until the exact Cashu detail route is ready', () => {
    const cases = [
      { id: 'send.cashu.pending-reclaim', count: 2 },
      { id: 'send.cashu.pending-relaunch', count: 1 },
      { id: 'send.cashu.dm-contact', count: 1 },
    ] as const;
    const expected = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { id: 'transaction-send-${sendTx}' } }],
      until: { id: 'send-token-id-${sendTx}' },
      attempts: 4,
      settleMs: 8_000,
    };

    for (const { id, count } of cases) {
      const steps = loaded.scenarios.get(id)!.steps;
      expect(
        steps.filter((step) => JSON.stringify(step) === JSON.stringify(expected)),
        id
      ).toHaveLength(count);
      expect(steps, id).not.toContainEqual({
        action: 'tap',
        selector: { id: 'transaction-send-${sendTx}' },
      });
      expect(steps, id).not.toContainEqual({
        action: 'waitFor',
        selector: { id: 'send-token-id-${sendTx}' },
        timeoutMs: 30_000,
      });
    }
  });

  it('promotes contact Cashu DM only with the two-minute thread-decay regression hold', () => {
    const scenario = loaded.scenarios.get('send.cashu.dm-contact')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { id: 'amount-next-menu-ecash' },
    });
    expect(scenario.steps).not.toContainEqual({ action: 'tapAt', x: 0.5, y: 0.845 });
    expect(scenario.steps).not.toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'amount-next-menu-ecash' } }],
      until: { id: 'dm-chat-probe' },
      attempts: expect.any(Number),
      settleMs: expect.any(Number),
    });
    expect(JSON.stringify(scenario.steps)).not.toContain('amount-next-menu-lightning');

    const bubbleWait = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'id' in step.selector &&
        step.selector.id === 'cashu-bubble-own'
    );
    const regressionHold = scenario.steps.findIndex(
      (step) => step.action === 'delay' && step.ms === 130_000
    );
    const postHoldProbe = scenario.steps.findIndex(
      (step, index) =>
        index > regressionHold &&
        step.action === 'assert' &&
        step.that === 'visible' &&
        'id' in step.selector &&
        step.selector.id === 'dm-chat-probe'
    );
    const postHoldBubble = scenario.steps.findIndex(
      (step, index) =>
        index > regressionHold &&
        step.action === 'assert' &&
        step.that === 'visible' &&
        'id' in step.selector &&
        step.selector.id === 'cashu-bubble-own'
    );

    expect(bubbleWait).toBeGreaterThanOrEqual(0);
    expect(regressionHold).toBeGreaterThan(bubbleWait);
    expect(postHoldProbe).toBeGreaterThan(regressionHold);
    expect(postHoldBubble).toBeGreaterThan(regressionHold);
  });

  it('promotes receive mint-change through the observable iOS action-menu seam', () => {
    const scenario = loaded.scenarios.get('receive.lightning.change-mint.amount')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.requires).toContain('unit.sat');
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'amount-next' } }],
      until: { id: 'e2e-action-menu-open' },
      attempts: 4,
      settleMs: 8000,
    });
    expect(scenario.steps).toContainEqual({ action: 'tapAt', x: 0.5, y: 0.905 });
    expect(JSON.stringify(scenario.steps)).not.toContain('amount-next-menu-lightning');
  });

  it('promotes the balance-split consolidation with a declared transfer and dual sweeps', () => {
    const scenario = loaded.scenarios.get('mint.split.consolidate')!;
    expect(scenario.deferredReason).toBeUndefined();
    // The reconciliation contract: the rebalance's Minibits→Sovran move is
    // DECLARED so the funded runtime can explain the cross-mint value shift
    // within an explicit fee budget instead of quarantining.
    expect(scenario.funds?.transfers).toEqual([
      {
        fromMintUrl: 'https://mint.minibits.cash/Bitcoin',
        toMintUrl: 'https://mint.sovran.money',
        unit: 'sat',
        accountIndex: 0,
        maxFeeSats: 10,
      },
    ]);
    // 100% to Sovran is reached by switching Minibits OFF. A BLIND tapUntil
    // re-tap would toggle the mint back on, so the retry is value-gated:
    // untilValue '0' re-taps only while the toggle still reads ON — a
    // swallowed tap retries, a landed tap can never be undone.
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'mint-distribution-toggle:https://mint.minibits.cash/Bitcoin' } }],
      until: { id: 'mint-distribution-toggle:https://mint.minibits.cash/Bitcoin' },
      untilValue: '0',
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { id: 'rebalance-start' },
    });
    // Waiting on 'rebalance-done' (not 'rebalance-done-noop') proves the plan
    // computed a real transfer and finished it.
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { id: 'rebalance-done' },
      timeoutMs: 180_000,
    });
    // The rebalance fee is unknowable up front — the verify must stay
    // fee-tolerant instead of pinning an exact ₿ balance label.
    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'balanceDelta',
      unit: 'sat',
      delta: -5,
      feeEnvelopeSats: 5,
    });
    // One sweep invocation is enough: the funded host reconciles EVERY declared
    // asset in a single pass (runtime #reconcileHost), so Minibits' fee-headroom
    // residual (~3 sats stay behind — the rebalancer never fully drains its
    // source) is still recovered without naming it here.
    const sweeps = scenario.finally.filter(
      (item): item is Extract<(typeof scenario.finally)[number], { use: string }> =>
        'use' in item && item.use === 'flow.sweep-mint'
    );
    expect(sweeps.map((item) => item.with?.mintUrl)).toEqual(['https://mint.sovran.money']);
    const authored = JSON.stringify(scenario);
    expect(authored).not.toContain('"mask"');
    expect(authored).not.toContain('rebalance-done-noop');
  });

  it('promotes the QR Lightning receive through the AX-visible toast lifecycle', () => {
    const scenario = loaded.scenarios.get('receive.lightning.qr')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.tags).toContain('io:display');
    // heroui taps intermittently miss — menu opens must be retried tapUntil,
    // never bare tap + waitFor (T09 timeout, 2026-07-14).
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'amount-next' } }],
      until: { id: 'e2e-action-menu-open' },
      attempts: 4,
      settleMs: 8000,
    });
    expect(scenario.steps).toContainEqual({ action: 'tapAt', x: 0.5, y: 0.905 });

    const authored = JSON.stringify([...scenario.steps, ...scenario.verify]);
    expect(authored).not.toContain('amount-next-menu-lightning');
    expect(authored).not.toContain('Adding to wallet...');
    expect(authored).not.toContain('"label":"Received"');
    expect(authored).not.toContain('lightning-toast-processing');
    expect(authored).not.toContain('lightning-toast-confirmed');
    for (const id of ['payment-status-receive-confirmed', 'payment-status-view']) {
      expect(authored).toContain(id);
    }
    // The ~3s processing stage can expire during the preceding evidence
    // capture — the first toast wait matches EITHER stage via idPrefix instead
    // of pinning the exact processing id.
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'payment-status-receive-' },
      timeoutMs: 60_000,
    });
    // The QR path reads the invoice from the displayed screen — never the
    // clipboard — and stays in-app: no Copy, no relaunch/no-replay coda.
    expect(scenario.steps).toContainEqual({
      action: 'capture',
      as: 'invoice',
      fromSelector: { id: 'payment-info-lightning-invoice-data' },
      attribute: 'label',
    });
    expect(authored).not.toContain('fromClipboard');
    expect(authored).not.toContain('"label":"Copy"');
    expect(scenario.steps.some((step) => step.action === 'launch')).toBe(false);
    expect(scenario.steps.some((step) => step.action === 'delay')).toBe(false);
    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'balanceDelta',
      unit: 'sat',
      delta: 33,
    });
    expect(scenario.steps).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'transaction-probe-', captureSuffixAs: 'quoteTx' },
      timeoutMs: 30_000,
    });
    const confirmedAt = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'id' in step.selector &&
        step.selector.id === 'payment-status-receive-confirmed'
    );
    // A toast is NEVER a tapUntil target: the first press consumes the probe
    // (clearPayment), and the standalone-ready id only mounts on the standalone
    // /lightningReceive route — unreachable from the in-flow toast press. A
    // single plain tap plus the transaction-probe wait below is the contract.
    expect(scenario.steps[confirmedAt + 1]).toEqual({
      action: 'tap',
      selector: { id: 'payment-status-view' },
    });
    expect(authored).not.toContain('lightning-receive-standalone-ready');
    expect(scenario.steps[confirmedAt + 2]).toEqual({
      action: 'waitFor',
      selector: { id: 'transaction-probe-${quoteTx}' },
      timeoutMs: 60_000,
    });
    expect(authored).not.toContain('mint-quote-id-');
    expect(scenario.steps).toContainEqual({
      action: 'assert',
      that: 'tx',
      txRef: '${quoteTx}',
      direction: 'in',
      amount: 33,
      unit: 'sat',
      mintHost: 'mint.sovran.money',
      status: 'finalized',
    });
    expect(scenario.finally).toContainEqual({
      use: 'flow.sweep-mint',
      with: {
        mintUrl: 'https://mint.sovran.money',
        unit: 'sat',
        accountIndex: 0,
      },
    });
  });

  it('interrupts the pending-relaunch receive between the UNPAID proof and payment', () => {
    // The scenario's whole claim is ordering: the quote is proven UNPAID, the
    // app cold-relaunches (reset:none), and only THEN does cocod pay — so the
    // resumed watcher settles the SAME pre-relaunch transaction.
    const scenario = loaded.scenarios.get('receive.lightning.pending-relaunch')!;
    const unpaidAt = scenario.steps.findIndex(
      (step) => step.action === 'assert' && step.that === 'tx' && step.status === 'UNPAID'
    );
    const relaunchAt = scenario.steps.findIndex(
      (step) => step.action === 'launch' && step.reset === 'none'
    );
    const payAt = scenario.steps.findIndex(
      (step) => step.action === 'counterparty' && step.operation === 'bolt11.pay'
    );
    const finalizedAt = scenario.steps.findIndex(
      (step) => step.action === 'assert' && step.that === 'tx' && step.status === 'finalized'
    );
    expect(unpaidAt).toBeGreaterThan(-1);
    expect(relaunchAt).toBeGreaterThan(unpaidAt);
    expect(payAt).toBeGreaterThan(relaunchAt);
    expect(finalizedAt).toBeGreaterThan(payAt);
    // Same-transaction continuity: both asserts reference the captured id.
    for (const at of [unpaidAt, finalizedAt]) {
      const step = scenario.steps[at];
      expect(step.action === 'assert' && step.that === 'tx' && step.txRef).toBe('${quoteTx}');
    }
    expect(scenario.tags).toContain('check:interruption');
  });

  it('keeps every recovery sweep exact-asset, amountless, and host-side', () => {
    const sweep = loaded.fixtures.get('flow.sweep-mint')!;
    expect(sweep.params).toEqual(['mintUrl', 'unit', 'accountIndex']);
    expect(sweep.requires).toEqual(['cocod.receive.cashu', 'unit.sat']);
    expect(sweep.steps).toEqual([
      {
        action: 'counterparty',
        operation: 'recovery.sweep',
        mintUrl: '${mintUrl}',
        unit: '${unit}',
        accountIndex: '${accountIndex}',
        timeoutMs: 120_000,
      },
    ]);

    const users = [...loaded.scenarios.values()].filter((scenario) =>
      scenario.finally.some((item) => 'use' in item && item.use === 'flow.sweep-mint')
    );
    expect(users).toHaveLength(38);
    const full = loaded.suites.find((suite) => suite.name === 'full')!;
    for (const scenario of users) {
      const invocations = scenario.finally.filter(
        (item): item is Extract<(typeof scenario.finally)[number], { use: string }> =>
          'use' in item && item.use === 'flow.sweep-mint'
      );
      expect(invocations.length).toBeGreaterThan(0);
      for (const invocation of invocations) {
        expect(Object.keys(invocation.with ?? {}).sort()).toEqual([
          'accountIndex',
          'mintUrl',
          'unit',
        ]);
      }
      const suiteRef = full.scenarios.find((ref) => ref.id === scenario.id)!;
      expect(suiteRef.requires).toContain('cocod.receive.cashu');
      expect(suiteRef.requires).toContain('unit.sat');
      expect([...suiteRef.requires].sort().join(',')).toBe(
        [...effectiveRequirements(scenario, loaded.fixtures)].sort().join(',')
      );
    }
  });

  it('gives all 61 funded plans exact bounded assets and no raw cocod argv', () => {
    const funded = [...loaded.scenarios.values()].filter((scenario) => scenario.lane === 'funded');
    expect(funded).toHaveLength(61);
    for (const scenario of funded) {
      expect(scenario.funds?.assets.length).toBeGreaterThan(0);
      expect(
        scenario.funds!.assets.reduce((total, asset) => total + asset.maxPrincipal, 0)
      ).toBeLessThanOrEqual(200);
      expect(unsafeCocodEffects(scenario, loaded.fixtures)).toEqual([]);
    }
  });

  it('limits Android AX value checks to audited semantic checked controls', () => {
    // Android flattens a labeled non-editable node's accessibilityValue into
    // content-desc. Only native checked state survives that merge as a
    // separately parseable 0/1 value. Each selector below is pinned to a
    // checkbox, radio, or switch contract in the focused product-source tests.
    const auditedCheckedSelectors = [
      'filter-direction-in',
      'filter-direction-out',
      'filter-mint-https://mint.minibits.cash/Bitcoin',
      'filter-mint-https://mint.sovran.money',
      'mint-distribution-toggle:https://mint.chorus.community',
      'mint-distribution-toggle:https://mint.cubabitcoin.org',
      'mint-distribution-toggle:https://mint.minibits.cash/Bitcoin',
      'mint-distribution-toggle:https://mint.sovran.money',
      'notification-policy-relaxed',
      'notification-policy-strict',
      'profile-reveal-mnemonic',
      'settings-mock-fail-melt-toggle',
      'settings-mock-fail-send-toggle',
      'settings-mock-offline-toggle',
      'terms-acceptance',
    ].sort();
    const auditedSet = new Set(auditedCheckedSelectors);
    const observed = new Set<string>();

    for (const scenario of loaded.scenarios.values()) {
      if (scenario.lane !== 'simulator' && scenario.lane !== 'funded') continue;
      const requirements = effectiveRequirements(scenario, loaded.fixtures);
      if (!scenarioPlatforms(requirements).includes('android')) continue;

      const plan = expandScenario(scenario, loaded.fixtures, {
        capabilities: new Set([...DRIVER_CAPS.android, ...requirements]),
      });
      for (const planned of plan.steps) {
        const { step } = planned;
        const valueCheck =
          step.action === 'tapUntil' && step.untilValue !== undefined
            ? { selector: step.until, value: step.untilValue }
            : step.action === 'waitFor' && step.value !== undefined
              ? { selector: step.selector, value: step.value }
              : step.action === 'assert' && step.that === 'ax' && step.value !== undefined
                ? { selector: step.selector, value: step.value }
                : undefined;
        if (!valueCheck) continue;

        if (!('id' in valueCheck.selector)) {
          throw new Error(
            `${scenario.id} ${planned.id} uses Android AX value equality without an exact id`
          );
        }
        if (valueCheck.value !== '0' && valueCheck.value !== '1') {
          throw new Error(
            `${scenario.id} ${planned.id} reads non-semantic Android AX value ${JSON.stringify(valueCheck.value)}`
          );
        }
        if (!auditedSet.has(valueCheck.selector.id)) {
          throw new Error(
            `${scenario.id} ${planned.id} must use checked state or an Android-safe dynamic id: ${valueCheck.selector.id}`
          );
        }
        observed.add(valueCheck.selector.id);
      }
    }

    // Keep this an exact inventory: stale exemptions and newly introduced
    // labeled-value checks both fail until their product semantics are audited.
    expect([...observed].sort()).toEqual(auditedCheckedSelectors);
  });

  it('observes amount state by semantic id instead of Android-merged AX values', () => {
    for (const scenario of loaded.scenarios.values()) {
      const plan = expandScenario(scenario, loaded.fixtures, {
        capabilities: new Set(CAPABILITIES),
      });
      for (const { step } of plan.steps) {
        if (step.action === 'tap') {
          expect('label' in step.selector && /^[0-9.]$/.test(step.selector.label)).toBe(false);
        }
        if (step.action === 'tapUntil') {
          expect(
            'id' in step.until && step.until.id === 'amount-value' && step.untilValue !== undefined
          ).toBe(false);
        }
        if (step.action === 'waitFor' || step.action === 'assert') {
          if ('selector' in step && 'id' in step.selector && step.selector.id === 'amount-value') {
            expect('value' in step && step.value !== undefined).toBe(false);
          }
        }
      }
    }

    for (const [fixtureId, states] of [
      ['flow.fund-lightning-50', ['5', '50']],
      ['flow.fund-lightning-100', ['1', '10', '100']],
      ['flow.fund-lightning-200', ['2', '20', '200']],
    ] as const) {
      const fixture = loaded.fixtures.get(fixtureId)!;
      for (const state of states) {
        expect(fixture.steps).toContainEqual(
          expect.objectContaining({
            action: 'tapUntil',
            until: { id: `amount-state:${state}` },
          })
        );
      }
    }
  });

  it('records Lightning settlement only after product PAID proof', () => {
    for (const id of [
      'send.lightning.sat',
      'send.lightning.change-mint.preview',
      'send.lightning.preselect-funded-mint',
    ]) {
      const steps = loaded.scenarios.get(id)!.steps;
      const paidProof = steps.findIndex(
        (step) => step.action === 'assert' && step.that === 'tx' && step.status === 'PAID'
      );
      expect(paidProof).toBeGreaterThan(-1);
      expect(steps[paidProof + 1]).toMatchObject({
        action: 'counterparty',
        operation: 'bolt11.settled',
      });
    }
    expect(
      loaded.scenarios
        .get('send.lightning.dismiss')!
        .steps.some((step) => step.action === 'counterparty' && step.operation === 'bolt11.settled')
    ).toBe(false);
  });

  it('promotes Lightning preview dismissal without paying or persisting a melt', () => {
    const scenario = loaded.scenarios.get('send.lightning.dismiss')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Send' } }],
      until: { label: 'Paste' },
      attempts: 4,
      settleMs: 6_000,
    });
    // The Paste tap retries until the post-paste melt preview mounts — never
    // until the iOS-only 'Allow Paste' alert, which Android has no equivalent
    // of (see receive.cashu.paste pin). The grant tap is optional for the same
    // reason.
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Paste' } }],
      until: { id: 'melt-pay' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { label: 'Allow Paste' },
      optional: { reason: 'android has no blocking paste dialog' },
    });

    const previewCapture = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'idPrefix' in step.selector &&
        step.selector.idPrefix === 'transaction-probe-' &&
        step.selector.captureSuffixAs === 'previewTx'
    );
    const unpaidProof = scenario.steps.findIndex(
      (step) =>
        step.action === 'assert' &&
        step.that === 'tx' &&
        step.txRef === '${previewTx}' &&
        step.status === 'UNPAID'
    );
    const dismiss = scenario.steps.findIndex(
      (step) => step.action === 'tap' && 'id' in step.selector && step.selector.id === 'melt-cancel'
    );
    expect(previewCapture).toBeGreaterThan(-1);
    expect(unpaidProof).toBeGreaterThan(previewCapture);
    expect(dismiss).toBeGreaterThan(unpaidProof);

    // melt-pay may appear as the post-paste join TARGET, but the dismissal
    // contract is that it is never tapped — the flow cancels, never pays.
    expect(
      scenario.steps.some(
        (step) =>
          (step.action === 'tap' && 'id' in step.selector && step.selector.id === 'melt-pay') ||
          (step.action === 'tapUntil' &&
            step.sequence.some(
              (item) => 'tap' in item && 'id' in item.tap && item.tap.id === 'melt-pay'
            ))
      )
    ).toBe(false);
    const authored = JSON.stringify(scenario);
    expect(authored).not.toContain('bolt11.settled');
    expect(authored).not.toContain('send-paste');
    expect(authored).not.toContain('"mask"');
    expect(
      scenario.steps.some((step) => step.action === 'assert' && step.that === 'balanceDelta')
    ).toBe(false);
    expect(scenario.verify).toContainEqual({
      action: 'waitFor',
      selector: { idPrefix: 'transaction-mint-' },
      timeoutMs: 30_000,
    });
    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'notVisible',
      selector: { idPrefix: 'transaction-melt-' },
      timeoutMs: 3_000,
    });
    expect(scenario.verify).toContainEqual({
      action: 'assert',
      that: 'balanceDelta',
      unit: 'sat',
      delta: 0,
    });
    expect(scenario.finally).toEqual([
      {
        use: 'flow.sweep-mint',
        with: {
          mintUrl: 'https://mint.sovran.money',
          unit: 'sat',
          accountIndex: 0,
        },
      },
      { action: 'waitFor', selector: { label: '₿ 0' }, timeoutMs: 45_000 },
    ]);
  });

  it('promotes Lightning send through stable controls and the persisted transaction probe', () => {
    const scenario = loaded.scenarios.get('send.lightning.sat')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'wallet-send' } }],
      until: { label: 'Paste' },
      attempts: 4,
      settleMs: 6_000,
    });
    // The Paste tap retries until the post-paste melt preview mounts — never
    // until the iOS-only 'Allow Paste' alert, which Android has no equivalent
    // of (see receive.cashu.paste pin). The grant tap is optional for the same
    // reason.
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Paste' } }],
      until: { id: 'melt-pay' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { label: 'Allow Paste' },
      optional: { reason: 'android has no blocking paste dialog' },
    });

    const pay = scenario.steps.findIndex(
      (step) => step.action === 'tap' && 'id' in step.selector && step.selector.id === 'melt-pay'
    );
    const close = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' && 'id' in step.selector && step.selector.id === 'melt-close'
    );
    const transactionProbe = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'idPrefix' in step.selector &&
        step.selector.idPrefix === 'transaction-probe-' &&
        step.selector.captureSuffixAs === 'meltTx'
    );
    const paidProof = scenario.steps.findIndex(
      (step) =>
        step.action === 'assert' &&
        step.that === 'tx' &&
        step.txRef === '${meltTx}' &&
        step.status === 'PAID'
    );

    expect(pay).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(pay);
    expect(transactionProbe).toBeGreaterThan(close);
    expect(paidProof).toBeGreaterThan(transactionProbe);
  });

  it('binds a changed Lightning preview to the newly selected mint before paying', () => {
    const scenario = loaded.scenarios.get('send.lightning.change-mint.preview')!;
    expect(scenario.deferredReason).toBeUndefined();
    expect(scenario.setup).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Receive' } }],
      until: { id: 'receive-method-fixedAmount' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.setup).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'amount-next' } }],
      until: { id: 'e2e-action-menu-open' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.setup).toContainEqual({ action: 'tapAt', x: 0.5, y: 0.905 });
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Send' } }],
      until: { label: 'Paste' },
      attempts: 4,
      settleMs: 6_000,
    });

    const initialPreview = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'idPrefix' in step.selector &&
        step.selector.idPrefix === 'melt-selected-mint:mint.sovran.money:' &&
        step.selector.captureSuffixAs === 'initialPreviewTx'
    );
    const changedPreview = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'idPrefix' in step.selector &&
        step.selector.idPrefix === 'melt-selected-mint:mint.minibits.cash:' &&
        step.selector.captureSuffixAs === 'changedPreviewTx'
    );
    expect(scenario.steps[changedPreview - 1]).toEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'contact-row:mint:https://mint.minibits.cash/Bitcoin' } }],
      until: { idPrefix: 'melt-selected-mint:mint.minibits.cash:' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).not.toContainEqual({
      action: 'tap',
      selector: { id: 'contact-row:mint:https://mint.minibits.cash/Bitcoin' },
    });
    const changedProof = scenario.steps.findIndex(
      (step) =>
        step.action === 'assert' &&
        step.that === 'tx' &&
        step.txRef === '${changedPreviewTx}' &&
        step.mintHost === 'mint.minibits.cash' &&
        step.status === 'UNPAID'
    );
    expect(initialPreview).toBeGreaterThan(-1);
    expect(changedPreview).toBeGreaterThan(initialPreview);
    expect(changedProof).toBeGreaterThan(changedPreview);

    const paidCapture = scenario.steps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'idPrefix' in step.selector &&
        step.selector.idPrefix === 'transaction-probe-' &&
        step.selector.captureSuffixAs === 'paidMeltTx'
    );
    const paidProof = scenario.steps.findIndex(
      (step) =>
        step.action === 'assert' &&
        step.that === 'tx' &&
        step.txRef === '${paidMeltTx}' &&
        step.status === 'PAID'
    );
    expect(paidCapture).toBeGreaterThan(changedProof);
    expect(paidProof).toBeGreaterThan(paidCapture);
    expect(scenario.steps[paidProof + 1]).toMatchObject({
      action: 'counterparty',
      operation: 'bolt11.settled',
    });

    const authored = JSON.stringify(scenario);
    expect(authored).not.toContain('amount-next-menu-lightning');
    expect(authored).not.toContain('"mask"');
    expect(scenario.finally).toEqual([
      {
        use: 'flow.sweep-mint',
        with: {
          mintUrl: 'https://mint.sovran.money',
          unit: 'sat',
          accountIndex: 0,
        },
      },
      {
        use: 'flow.sweep-mint',
        with: {
          mintUrl: 'https://mint.minibits.cash/Bitcoin',
          unit: 'sat',
          accountIndex: 0,
        },
      },
      { action: 'waitFor', selector: { label: '₿ 0' }, timeoutMs: 45_000 },
    ]);
  });

  it('expands onboarding.fresh to a ready plan with the whole journey in the test phase', () => {
    const p = expandScenario(loaded.scenarios.get('onboarding.fresh')!, loaded.fixtures, {
      capabilities: new Set(['fresh-install']),
    });
    expect(p.availability).toBe('ready');
    expect(p.steps[0]).toMatchObject({ phase: 'test', action: 'launch' }); // onboarding owns its launch
    const shots = p.steps.filter((s) => s.phase === 'test' && s.action === 'screenshot');
    // splash, terms, four carousel slides (occurrences 1-4), and the welcome checkpoint
    expect(shots.map((s) => s.step.action === 'screenshot' && s.step.name)).toEqual([
      'splash',
      'terms',
      'onboarding-carousel',
      'onboarding-carousel',
      'onboarding-carousel',
      'onboarding-carousel',
      'welcome',
    ]);
    expect(p.endState).toBe('wallet');
  });

  it('retries every onboarding carousel transition until the destination slide is visible', () => {
    const transitions = [
      ['Bitcoin that feels like cash', 'Powered by Nostr'],
      ['Powered by Nostr', 'Private by Design'],
      ['Private by Design', 'Stay private, stay sovereign'],
    ] as const;
    const authoredJourneys = [
      ['flow.onboard', loaded.fixtures.get('flow.onboard')!.steps],
      ['onboarding.fresh', loaded.scenarios.get('onboarding.fresh')!.steps],
      ['onboarding.terms-gate', loaded.scenarios.get('onboarding.terms-gate')!.steps],
      [
        'onboarding.relaunch-interrupt',
        loaded.scenarios.get('onboarding.relaunch-interrupt')!.steps,
      ],
      ['onboarding.offline', loaded.scenarios.get('onboarding.offline')!.steps],
    ] as const;

    for (const [owner, steps] of authoredJourneys) {
      for (const [from, to] of transitions) {
        expect(steps, owner).toContainEqual({
          action: 'tapUntil',
          sequence: [{ tap: { label: from } }],
          until: { label: to },
          attempts: 4,
          settleMs: 6_000,
        });
        expect(steps, owner).not.toContainEqual({ action: 'tap', selector: { label: from } });
      }
    }
  });

  it('retries the empty-wallet ecash action until the product exposes its balance stop', () => {
    const steps = loaded.scenarios.get('send.zero-balance')!.steps;
    expect(steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'send-method-createEcash' } }],
      until: { id: 'e2e-toast-balance-too-low' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(steps).not.toContainEqual({
      action: 'tap',
      selector: { id: 'send-method-createEcash' },
    });
  });

  it('opens Nostr DMs through the semantic action-menu row until chat is visible', () => {
    for (const scenarioId of ['mint.info.send-message', 'dm.send.nostr']) {
      const steps = loaded.scenarios.get(scenarioId)!.steps;
      expect(steps, scenarioId).toContainEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: 'send-message-menu' } }],
        until: { id: 'send-message-menu-nostr' },
        attempts: 6,
        settleMs: 8_000,
      });
      expect(steps, scenarioId).toContainEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: 'send-message-menu-nostr' } }],
        until: { id: 'dm-chat-probe' },
        attempts: 4,
        settleMs: 15_000,
      });
      expect(steps, scenarioId).not.toContainEqual({ action: 'tapAt', x: 0.5, y: 0.755 });
    }
  });

  it('retries the Lightning BOLT 12 tab until its content is visible', () => {
    const steps = loaded.scenarios.get('receive.qr-display.tabs')!.steps;
    expect(steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'receive-lightning-mode-offer' } }],
      until: { id: 'receive-bolt12-find-mints' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(steps).not.toContainEqual({
      action: 'tap',
      selector: { id: 'receive-lightning-mode-offer' },
    });
  });

  it('retries receive navigation only against destination-specific evidence', () => {
    const lightningTab = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { label: 'Lightning' } }],
      until: { id: 'receive-lightning-mode-address' },
      attempts: 4,
      settleMs: 6_000,
    };
    for (const scenarioId of [
      'receive.npc.default-mint',
      'receive.npc.change-mint',
      'receive.npc.toast-view',
    ]) {
      const steps = loaded.scenarios.get(scenarioId)!.steps;
      expect(steps, scenarioId).toContainEqual(lightningTab);
      expect(steps, scenarioId).not.toContainEqual({
        action: 'tap',
        selector: { label: 'Lightning' },
      });
    }

    const paymentRequestSteps = loaded.scenarios.get('receive.payment-request.sat')!.steps;
    expect(paymentRequestSteps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Cashu' } }],
      until: { id: 'receive-creq-p2pk-state' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(paymentRequestSteps).not.toContainEqual({
      action: 'tap',
      selector: { label: 'Cashu' },
    });

    const tabsSteps = loaded.scenarios.get('receive.qr-display.tabs')!.steps;
    for (const destination of ['receive-bolt12-find-mints', 'receive-onchain-find-mints']) {
      expect(tabsSteps, destination).toContainEqual({
        action: 'tapUntil',
        sequence: [{ tap: { id: 'mint-add-cancel' } }],
        until: { id: destination },
        attempts: 4,
        settleMs: 6_000,
      });
    }
    expect(
      tabsSteps.filter(
        (step) =>
          step.action === 'tap' && 'id' in step.selector && step.selector.id === 'mint-add-cancel'
      )
    ).toEqual([]);

    const toastView = {
      action: 'tapUntil' as const,
      sequence: [{ tap: { id: 'payment-status-view' } }],
      until: { idPrefix: 'transaction-probe-' },
      attempts: 4,
      settleMs: 4_000,
    };
    const npcToastSteps = loaded.scenarios.get('receive.npc.toast-view')!.steps;
    const npcConfirmedAt = npcToastSteps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'id' in step.selector &&
        step.selector.id === 'payment-status-receive-confirmed'
    );
    expect(npcToastSteps[npcConfirmedAt + 1]).toEqual(toastView);

    const pendingSteps = loaded.scenarios.get('receive.lightning.pending-relaunch')!.steps;
    const pendingConfirmedAt = pendingSteps.findIndex(
      (step) =>
        step.action === 'waitFor' &&
        'id' in step.selector &&
        step.selector.id === 'payment-status-receive-confirmed'
    );
    expect(pendingSteps[pendingConfirmedAt + 1]).toEqual({
      ...toastView,
      until: { id: 'transaction-probe-${quoteTx}' },
    });
    expect(pendingSteps).not.toContainEqual({
      action: 'tap',
      selector: { id: 'payment-status-view' },
    });
  });

  it('runs recovery.reinstall against the wallet inherited from the preceding scenario', () => {
    const scenario = loaded.scenarios.get('recovery.reinstall')!;

    expect(scenario.requires).toContain(REINSTALL_KEYCHAIN_RETENTION_CAPABILITY);
    expect(scenarioPlatforms(scenario.requires)).toEqual(['ios']);
    expect(
      expandScenario(scenario, loaded.fixtures, {
        capabilities: new Set(DRIVER_CAPS.sim),
      }).availability
    ).toBe('ready');
    expect(
      expandScenario(scenario, loaded.fixtures, {
        capabilities: new Set(DRIVER_CAPS.android),
      })
    ).toMatchObject({
      availability: 'deferred',
      deferredReason: `missing capability: ${REINSTALL_KEYCHAIN_RETENTION_CAPABILITY}`,
    });
    expect(scenario.setup).not.toContainEqual({ use: 'flow.onboard' });
    const profileCaptureIndex = scenario.setup.findIndex(
      (step) => 'action' in step && step.action === 'capture' && step.as === 'profileNameBefore'
    );
    // Drawer open is dead-tap-hardened (avatar tap swallowed on a live run,
    // 2026-07-17) — the proven tapUntil leg other drawer scenarios use.
    expect(scenario.setup.slice(0, profileCaptureIndex)).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'header-profile-avatar' } }],
      until: { id: 'drawer-menu-settings' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.setup).toContainEqual({
      action: 'capture',
      as: 'profileNameBefore',
      fromSelector: { id: 'drawer-profile-name' },
      attribute: 'label',
    });
    expect(scenario.steps).toContainEqual({ action: 'launch', reset: 'reinstall' });
    expect(scenario.steps).toContainEqual({
      action: 'drag',
      selector: { id: 'slide-to-confirm' },
      from: { x: 0.07, y: 0.5 },
      to: { x: 0.97, y: 0.5 },
      durationMs: 800,
    });
    expect(scenario.steps).not.toContainEqual({ action: 'swipe', dir: 'right' });
    expect(scenario.steps).toContainEqual({
      action: 'assert',
      that: 'ax',
      selector: { id: 'drawer-profile-name' },
      label: '${profileNameBefore}',
    });
    // Reload and explicitly select the Wallet tab. The drawer overlay is
    // present in AX but has no tappable geometry on iOS, while the old raw
    // backdrop coordinate could miss and leave wallet-send hidden.
    expect(scenario.steps).toContainEqual({ action: 'goHome' });
    // Android exposes the underlying wallet AX while the drawer is open, so
    // wallet-send alone cannot prove that the semantic close actually landed.
    expect(scenario.steps).toContainEqual({
      action: 'assert',
      that: 'notVisible',
      selector: { label: 'Close drawer' },
      timeoutMs: 30_000,
    });
    expect(scenario.steps).not.toContainEqual({
      action: 'tap',
      selector: { label: 'Close drawer' },
    });
    expect(scenario.steps).not.toContainEqual({ action: 'tapAt', x: 0.95, y: 0.5 });
    expect(JSON.stringify(scenario)).not.toContain('payment-info-address-data');
    expect(scenario.deferredReason).toBeUndefined();
  });
});

describe('loadE2E funded authoring contracts', () => {
  it('rejects a raw cocod command reached through a setup fixture', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-e2e-loader-'));
    mkdirSync(join(root, 'fixtures'));
    mkdirSync(join(root, 'scenarios'));
    writeFileSync(
      join(root, 'fixtures', 'raw.json'),
      formatDoc({
        version: 1,
        id: 'flow.raw',
        params: [],
        requires: ['cocod.send.bolt11'],
        steps: [{ action: 'exec', command: ['cocod', 'send', 'bolt11', '${invoice}'] }],
      })
    );
    writeFileSync(
      join(root, 'scenarios', 'funded.json'),
      formatDoc({
        version: 1,
        id: 'funded.raw-fixture',
        name: 'Funded fixture',
        description: 'Raw cocod must not hide behind a fixture',
        lane: 'funded',
        tags: ['flow:send'],
        requires: ['fresh-install', 'cocod.send.bolt11', 'unit.sat'],
        funds: {
          assets: [
            {
              mintUrl: 'https://mint.sovran.money',
              unit: 'sat',
              accountIndex: 0,
              maxPrincipal: 100,
            },
          ],
        },
        setup: [{ use: 'flow.raw' }],
        steps: [{ action: 'goHome' }],
        verify: [{ action: 'assert', that: 'visible', selector: { id: 'wallet-send' } }],
        finally: [],
        endState: 'wallet',
      })
    );

    expect(loadE2E(root).issues).toContainEqual({
      file: 'scenarios/funded.json',
      issue: {
        path: 'setup.0(flow.raw).steps.0',
        message: 'funded scenarios must use typed counterparty steps, not raw cocod commands',
      },
    });
  });
  it('validates expanded fixture operations against funds.assets', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-e2e-loader-'));
    mkdirSync(join(root, 'fixtures'));
    mkdirSync(join(root, 'scenarios'));
    writeFileSync(
      join(root, 'fixtures', 'pay.json'),
      formatDoc({
        version: 1,
        id: 'flow.pay',
        params: ['mintUrl', 'unit', 'accountIndex', 'amount'],
        requires: ['cocod.send.bolt11'],
        steps: [
          {
            action: 'counterparty',
            operation: 'bolt11.pay',
            mintUrl: '${mintUrl}',
            unit: '${unit}',
            accountIndex: '${accountIndex}',
            amount: '${amount}',
            invoice: '${invoice}',
          },
        ],
      })
    );
    writeFileSync(
      join(root, 'scenarios', 'funded.json'),
      formatDoc({
        version: 1,
        id: 'funded.over-budget-fixture',
        name: 'Funded fixture',
        description: 'Expanded fixture amount must stay inside the asset budget',
        lane: 'funded',
        tags: ['flow:send'],
        requires: ['fresh-install', 'cocod.send.bolt11', 'unit.sat'],
        funds: {
          assets: [
            {
              mintUrl: 'https://mint.sovran.money',
              unit: 'sat',
              accountIndex: 0,
              maxPrincipal: 100,
            },
          ],
        },
        setup: [
          {
            use: 'flow.pay',
            with: {
              mintUrl: 'https://mint.sovran.money',
              unit: 'sat',
              accountIndex: 0,
              amount: 101,
            },
          },
        ],
        steps: [{ action: 'goHome' }],
        verify: [{ action: 'assert', that: 'visible', selector: { id: 'wallet-send' } }],
        finally: [],
        endState: 'wallet',
      })
    );

    expect(loadE2E(root).issues).toContainEqual({
      file: 'scenarios/funded.json',
      issue: {
        path: 'setup.0(flow.pay).steps.0.amount',
        message: 'counterparty amount 101 exceeds exact asset maxPrincipal 100',
      },
    });
  });
});
