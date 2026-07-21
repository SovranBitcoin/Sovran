import { describe, expect, it } from 'bun:test';

import { startSimulatorBridge, type SimulatorBridgeNative } from './simulator-bridge';

const UDID = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE';
const RAW_AX = JSON.stringify([
  {
    AXUniqueId: 'screen',
    AXLabel: null,
    AXValue: null,
    enabled: true,
    frame: { x: 0, y: 0, width: 400, height: 800 },
    role_description: 'application',
    type: 'Application',
    children: [
      {
        AXUniqueId: 'wallet',
        AXLabel: 'Wallet',
        AXValue: null,
        enabled: true,
        frame: { x: 20, y: 20, width: 100, height: 40 },
        role_description: 'button',
        type: 'Button',
        children: [],
      },
    ],
  },
]);

describe('capture-free simulator bridge', () => {
  it('emits a fresh SSE observation when the accessibility tree is unchanged', async () => {
    let descriptions = 0;
    const native: SimulatorBridgeNative = {
      SimHID: class {
        touch() {}
        key() {}
      },
      axDescribe: async () => {
        descriptions++;
        return RAW_AX;
      },
    };
    const bridge = startSimulatorBridge({ udid: UDID, port: 0, native, pollMs: 2 });
    const abort = new AbortController();
    try {
      // eslint-disable-next-line no-restricted-globals -- test-only owned loopback SSE stream
      const response = await fetch(bridge.axEndpoint, { signal: abort.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let frames = 0;
      const deadline = Date.now() + 250;
      while (frames < 2 && Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const result = await Promise.race([
          reader.read(),
          Bun.sleep(Math.max(1, remaining)).then(() => null),
        ]);
        if (!result) break;
        const { done, value } = result;
        if (done) break;
        frames += decoder
          .decode(value)
          .split('\n')
          .filter((line) => line.startsWith('data: ')).length;
      }
      await reader.cancel();
      expect(descriptions).toBeGreaterThanOrEqual(2);
      expect(frames).toBeGreaterThanOrEqual(2);
    } finally {
      abort.abort();
      bridge.stop();
    }
  });

  it('serializes SSE and one-shot AX without requiring a frame-capture primitive', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const native: SimulatorBridgeNative = {
      SimHID: class {
        touch() {}
        key() {}
      },
      axDescribe: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Bun.sleep(5);
        inFlight--;
        return RAW_AX;
      },
    };
    const bridge = startSimulatorBridge({ udid: UDID, port: 0, native, pollMs: 1000 });
    const abort = new AbortController();
    try {
      // eslint-disable-next-line no-restricted-globals -- test-only owned loopback SSE stream
      const sse = await fetch(bridge.axEndpoint, { signal: abort.signal });
      const reader = sse.body!.getReader();
      const firstSse = reader.read();
      const origin = new URL(bridge.axEndpoint).origin;
      // eslint-disable-next-line no-restricted-globals -- test-only owned loopback AX helper
      const firstHelper = fetch(`${origin}/helper/${UDID}/ax`);
      // eslint-disable-next-line no-restricted-globals -- test-only owned loopback AX helper
      const secondHelper = fetch(`${origin}/helper/${UDID}/ax`);
      const [first, second] = await Promise.all([firstHelper, secondHelper]);
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      await firstSse;
      expect(maxInFlight).toBe(1);
      await reader.cancel();
    } finally {
      abort.abort();
      bridge.stop();
    }
  });

  it('redacts secret-profile fields in both raw helper and SSE serialization', async () => {
    const rawPrivateLabel = 'raw-private-label';
    const rawPrivateValue = 'raw-private-value';
    const roots = JSON.parse(RAW_AX) as { children: unknown[] }[];
    roots[0]!.children.push({
      AXUniqueId: 'profile-secret-value-mnemonic',
      AXLabel: rawPrivateLabel,
      AXValue: rawPrivateValue,
      enabled: false,
      frame: { x: -500, y: -500, width: 10, height: 10 },
      role_description: 'text',
      type: 'TextField',
      children: [],
    });
    roots[0]!.children.push({
      AXUniqueId: 'profile-reveal-mnemonic',
      AXLabel: 'Show',
      AXValue: '0',
      enabled: true,
      frame: { x: 20, y: 120, width: 100, height: 40 },
      role_description: 'switch',
      type: 'Switch',
      children: [],
    });
    const native: SimulatorBridgeNative = {
      SimHID: class {
        touch() {}
        key() {}
      },
      axDescribe: async () => JSON.stringify(roots),
    };
    const bridge = startSimulatorBridge({ udid: UDID, port: 0, native, pollMs: 2 });
    const abort = new AbortController();
    try {
      const origin = new URL(bridge.axEndpoint).origin;
      // eslint-disable-next-line no-restricted-globals -- test-only owned loopback AX helper
      const helperText = await (await fetch(`${origin}/helper/${UDID}/ax`)).text();
      expect(helperText).not.toContain(rawPrivateLabel);
      expect(helperText).not.toContain(rawPrivateValue);
      const helperRoots = JSON.parse(helperText) as {
        children: Record<string, unknown>[];
      }[];
      expect(
        helperRoots[0]?.children.find((node) => node.AXUniqueId === 'profile-secret-value-mnemonic')
      ).toMatchObject({
        AXUniqueId: 'profile-secret-value-mnemonic',
        AXLabel: '‹profile-secret:redacted›',
        AXValue: '‹profile-secret:redacted›',
        enabled: false,
      });
      expect(
        helperRoots[0]?.children.find((node) => node.AXUniqueId === 'profile-reveal-mnemonic')
      ).toMatchObject({ AXLabel: 'Show', AXValue: '0', enabled: true });
      // eslint-disable-next-line no-restricted-globals -- test-only owned loopback SSE stream
      const sse = await fetch(bridge.axEndpoint, { signal: abort.signal });
      const reader = sse.body!.getReader();
      const decoder = new TextDecoder();
      let dataLine = '';
      const deadline = Date.now() + 250;
      while (!dataLine && Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        dataLine =
          decoder
            .decode(chunk.value)
            .split('\n')
            .find((line) => line.startsWith('data: ')) ?? '';
      }
      await reader.cancel();

      expect(dataLine).not.toContain(rawPrivateLabel);
      expect(dataLine).not.toContain(rawPrivateValue);
      const snapshot = JSON.parse(dataLine.slice('data: '.length)) as {
        elements: Record<string, unknown>[];
      };
      expect(
        snapshot.elements.find((node) => node.id === 'profile-secret-value-mnemonic')
      ).toMatchObject({
        id: 'profile-secret-value-mnemonic',
        label: '‹profile-secret:redacted›',
        value: '‹profile-secret:redacted›',
        enabled: false,
      });
    } finally {
      abort.abort();
      bridge.stop();
    }
  });

  it('drives HID from AX dimensions without starting native video', async () => {
    const touches: unknown[][] = [];
    const keys: unknown[][] = [];
    const native: SimulatorBridgeNative = {
      SimHID: class {
        touch(...args: unknown[]) {
          touches.push(args);
        }
        key(...args: unknown[]) {
          keys.push(args);
        }
      },
      axDescribe: async () => RAW_AX,
    };
    const bridge = startSimulatorBridge({ udid: UDID, port: 0, native });
    try {
      const socket = new WebSocket(bridge.touchEndpoint);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error('bridge WebSocket failed'));
      });
      const body = new TextEncoder().encode(JSON.stringify({ type: 'begin', x: 0.25, y: 0.75 }));
      const packet = new Uint8Array(body.length + 1);
      packet[0] = 3;
      packet.set(body, 1);
      socket.send(packet);
      const keyBody = new TextEncoder().encode(JSON.stringify({ type: 'down', usage: 0x0b }));
      const keyPacket = new Uint8Array(keyBody.length + 1);
      keyPacket[0] = 4;
      keyPacket.set(keyBody, 1);
      socket.send(keyPacket);
      await Bun.sleep(20);
      socket.close();
      expect(touches).toEqual([['begin', 0.25, 0.75, 400, 800, 0]]);
      expect(keys).toEqual([['down', 0x0b]]);
    } finally {
      bridge.stop();
    }
  });
});
