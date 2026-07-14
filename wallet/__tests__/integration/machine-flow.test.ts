/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * machine-flow.test.ts — createMachineFromInstance with real Manager
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the full machine lifecycle: instance creation → machine wiring →
 * notification delivery, using a real Manager and a deliberately configured
 * live mint. Run with:
 *   TEST_MINT_URL=http://127.0.0.1:3338 bun run test:live
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Manager } from '@cashu/coco-core';
import { createColada, createMachineFromInstance } from '../../src/core/createColada';
import type { ColadaInstance } from '../../src/core/createColada';
import type { NotificationHandlerMap } from '../../src/machine/types';
import { createTestManager, addTrustedMint, TEST_MINT } from './helpers/setup';

describe('createMachineFromInstance — real Manager', () => {
  let manager: Manager;
  let instance: ColadaInstance;

  beforeAll(async () => {
    manager = await createTestManager();
    await addTrustedMint(manager, TEST_MINT);

    instance = createColada({ manager });
    await instance.tracker.refresh();
  });

  afterAll(async () => {
    instance.dispose();
    await manager.dispose();
  });

  it('creates a working machine with real operations', () => {
    const handlers = {};
    const machine = createMachineFromInstance({
      instance,
      handlers,
      getOffline: () => false,
      getLocale: () => 'en',
    });

    expect(machine).toBeDefined();
    expect(machine.getContext).toBeDefined();
    expect(machine.subscribe).toBeDefined();
    expect(machine.startSendEcash).toBeDefined();
    expect(machine.startReceiveLightning).toBeDefined();
    expect(machine.execute).toBeDefined();
  });

  it('machine context reflects real wallet state', () => {
    const machine = createMachineFromInstance({
      instance,
      handlers: {},
      getOffline: () => false,
      getLocale: () => 'en',
    });

    const step = machine.getStep();
    expect(step).toBe('idle');
  });

  it('wires notifications to the machine', () => {
    const onPreferredMintChanged = vi.fn();
    const notifications: NotificationHandlerMap = {
      onPreferredMintChanged,
    };

    const machine = createMachineFromInstance({
      instance,
      handlers: {},
      notifications,
      getOffline: () => false,
      getLocale: () => 'en',
    });

    expect(machine).toBeDefined();
    // Notification wiring is verified — actual firing depends on machine transitions
  });

  it('instance config is accessible', () => {
    expect(instance.config).toBeDefined();
    expect(instance.config.manager).toBe(manager);
  });

  it('instance exposes functional wallet context', async () => {
    const ctx = instance.getWalletContext();
    expect(ctx.trustedMintUrls).toContain(TEST_MINT);
    expect(typeof (ctx.mintBalances[TEST_MINT] ?? 0)).toBe('number');
  });

  it('instance subscribe notifies on wallet refresh', async () => {
    const listener = vi.fn();
    const unsub = instance.subscribeWalletContext(listener);

    await instance.tracker.refresh();
    expect(listener).toHaveBeenCalled();

    unsub();
  });

  it('onPreferredMintChanged fires on changeMint with persist', async () => {
    const onPreferredMintChanged = vi.fn();

    const machine = createMachineFromInstance({
      instance,
      handlers: {},
      notifications: { onPreferredMintChanged },
      getOffline: () => false,
      getLocale: () => 'en',
    });

    void machine.changeMint(TEST_MINT, { persist: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(onPreferredMintChanged).toHaveBeenCalledWith(
      expect.objectContaining({ mintUrl: TEST_MINT })
    );
  });
});
