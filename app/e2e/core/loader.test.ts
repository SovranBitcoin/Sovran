import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadE2E } from './loader';
import { isValuelessTestMint } from '../funded/test-mints';
import { effectiveRequirements, expandScenario, unsafeCocodEffects } from './plan';
import { formatDoc } from '../schema';

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
    expect(loaded.scenarios.size).toBe(54);
    for (const scenario of loaded.scenarios.values()) {
      expect(scenario.verify.length).toBeGreaterThan(0);
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

  it('retries the 100-sat Lightning funding handoff through the rendered method sheet', () => {
    const fixture = loaded.fixtures.get('flow.fund-lightning-100')!;
    expect(fixture.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [
        { tap: { id: 'amount-next' } },
        { delayMs: 2_600 },
        { tapAt: { x: 0.5, y: 0.905 } },
      ],
      until: { label: 'Copy' },
      attempts: 6,
      settleMs: 8_000,
    });
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
    // The paste-method tap is dead-tap-hardened AND routed through the iOS
    // paste-consent alert (fresh installs ALWAYS prompt on the first host-set
    // clipboard read — observed live 2026-07-17 on iOS 26.2): retry the
    // chooser tap until the alert appears, grant, then wait for the redeem
    // sheet. The redeem ACTION itself stays a single plain tap.
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { id: 'receive-method-paste' } }],
      until: { label: 'Allow Paste' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({
      action: 'tap',
      selector: { label: 'Allow Paste' },
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
    // pending toast lingers ~8s over the header — every menu open must be a
    // retried tapUntil, never a bare tap + waitFor (T29 timeout, 2026-07-14).
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
    expect(scenario.steps.filter((step) => step.action === 'tapAt')).toEqual([
      { action: 'tapAt', x: 0.5, y: 0.84 },
      { action: 'tapAt', x: 0.5, y: 0.905 },
    ]);

    const authored = JSON.stringify(scenario);
    expect(authored).toContain('e2e-toast-token-pending-not-redeemed');
    expect(authored).toContain('e2e-toast-transaction-cancelled');
    expect(authored).not.toContain('pendingToken');
    expect(authored).not.toContain('send-token-check-status');
    expect(authored).not.toContain('send-token-cancel-transaction');
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
    const firstReopen = scenario.steps.findIndex(
      (step) =>
        step.action === 'tap' &&
        'id' in step.selector &&
        step.selector.id === 'transaction-send-${sendTx}'
    );
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
    const persistedReopen = scenario.steps.findIndex(
      (step, index) =>
        index > restoredDelta &&
        step.action === 'tap' &&
        'id' in step.selector &&
        step.selector.id === 'transaction-send-${sendTx}'
    );

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
    for (const id of [
      'payment-status-receive-processing',
      'payment-status-receive-confirmed',
      'payment-status-view',
    ]) {
      expect(authored).toContain(id);
    }
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
    expect(scenario.steps).toContainEqual({
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
    expect(users).toHaveLength(29);
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

  it('gives all 31 funded plans exact bounded assets and no raw cocod argv', () => {
    const funded = [...loaded.scenarios.values()].filter((scenario) => scenario.lane === 'funded');
    expect(funded).toHaveLength(31);
    for (const scenario of funded) {
      expect(scenario.funds?.assets.length).toBeGreaterThan(0);
      expect(
        scenario.funds!.assets.reduce((total, asset) => total + asset.maxPrincipal, 0)
      ).toBeLessThanOrEqual(200);
      expect(unsafeCocodEffects(scenario, loaded.fixtures)).toEqual([]);
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
    // Paste is consent-hardened: fresh installs raise the iOS paste alert on
    // the first clipboard read (see receive.cashu.paste pin).
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Paste' } }],
      until: { label: 'Allow Paste' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({ action: 'tap', selector: { label: 'Allow Paste' } });

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

    const authored = JSON.stringify(scenario);
    expect(authored).not.toContain('melt-pay');
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
    // Paste is consent-hardened: fresh installs raise the iOS paste alert on
    // the first clipboard read (see receive.cashu.paste pin).
    expect(scenario.steps).toContainEqual({
      action: 'tapUntil',
      sequence: [{ tap: { label: 'Paste' } }],
      until: { label: 'Allow Paste' },
      attempts: 4,
      settleMs: 6_000,
    });
    expect(scenario.steps).toContainEqual({ action: 'tap', selector: { label: 'Allow Paste' } });

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

  it('runs recovery.reinstall against the wallet inherited from the preceding scenario', () => {
    const scenario = loaded.scenarios.get('recovery.reinstall')!;

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
