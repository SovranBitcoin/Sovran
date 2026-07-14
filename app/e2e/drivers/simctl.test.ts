import { describe, expect, it } from 'bun:test';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gesture, preparePrivateLog, pressAt, resolveServeSimBin, run } from './simctl';

describe('optional serve-sim resolution', () => {
  it('imports offline and resolves native tooling only when explicitly requested', () => {
    expect(() => resolveServeSimBin('/missing-app', () => false)).toThrow(/serve-sim not found/);
    expect(
      resolveServeSimBin('/test-app', (path) => path === '/test-app/node_modules/.bin/serve-sim')
    ).toBe('/test-app/node_modules/.bin/serve-sim');
  });
});

describe('preparePrivateLog', () => {
  it('prepares host-tool output behind 0700/0600 permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'sovran-metro-'));
    const directory = join(root, 'artifacts');
    const path = join(directory, 'metro.log');
    preparePrivateLog(path);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('host command failures', () => {
  it('propagates nonzero exits through the simulator command boundary', async () => {
    await expect(run(['/usr/bin/false'])).rejects.toThrow(/command failed/);
  });
});

describe('owned simulator bridge touch connection', () => {
  it('sends a gesture packet through the same owned bridge boundary', async () => {
    const packets: Uint8Array[] = [];
    const socket = {
      binaryType: 'blob',
      readyState: 0,
      onopen: null as null | (() => void),
      onerror: null as null | (() => void),
      onclose: null as null | (() => void),
      send(data: Uint8Array) {
        packets.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };
    await gesture('ws://127.0.0.1:41002/ws', 'move', 0.2, 0.8, {
      createSocket: () => {
        queueMicrotask(() => {
          socket.readyState = 1;
          socket.onopen?.();
        });
        return socket;
      },
      wait: async () => {},
    });
    expect(packets).toHaveLength(1);
    expect(packets[0]?.[0]).toBe(3);
    expect(JSON.parse(new TextDecoder().decode(packets[0]!.slice(1)))).toEqual({
      type: 'move',
      x: 0.2,
      y: 0.8,
    });
  });

  it('sends one bounded press over one WebSocket', async () => {
    const packets: Uint8Array[] = [];
    const waits: number[] = [];
    let connections = 0;
    const socket = {
      binaryType: 'blob',
      readyState: 0,
      onopen: null as null | (() => void),
      onerror: null as null | (() => void),
      onclose: null as null | (() => void),
      send(data: Uint8Array) {
        packets.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };

    const pressing = pressAt('ws://127.0.0.1:41002/ws', 0.25, 0.75, {
      createSocket: () => {
        connections++;
        queueMicrotask(() => {
          socket.readyState = 1;
          socket.onopen?.();
        });
        return socket;
      },
      wait: async (ms) => void waits.push(ms),
    });
    await pressing;

    const decode = (packet: Uint8Array) => {
      expect(packet[0]).toBe(3);
      return JSON.parse(new TextDecoder().decode(packet.slice(1)));
    };
    expect(connections).toBe(1);
    expect(packets.map(decode)).toEqual([
      { type: 'begin', x: 0.25, y: 0.75 },
      { type: 'end', x: 0.25, y: 0.75 },
    ]);
    expect(waits).toEqual([120, 50]);
  });

  it('rejects invalid coordinates before opening a socket', async () => {
    let connections = 0;
    await expect(
      pressAt('ws://127.0.0.1:41002/ws', Number.NaN, 0.5, {
        createSocket: () => {
          connections++;
          throw new Error('must not connect');
        },
      })
    ).rejects.toThrow(/coordinates/);
    expect(connections).toBe(0);
  });

  it('closes every failed-open socket before retrying', async () => {
    const sockets: { closed: boolean }[] = [];
    await expect(
      pressAt('ws://127.0.0.1:41002/ws', 0.5, 0.5, {
        createSocket: () => {
          const socket = {
            binaryType: 'blob',
            readyState: 0,
            onopen: null as null | (() => void),
            onerror: null as null | (() => void),
            onclose: null as null | (() => void),
            closed: false,
            send: () => {},
            close() {
              this.closed = true;
              this.readyState = 3;
            },
          };
          sockets.push(socket);
          queueMicrotask(() => socket.onerror?.());
          return socket;
        },
        wait: async () => {},
      })
    ).rejects.toThrow(/touch connection failed/);
    expect(sockets).toHaveLength(3);
    expect(sockets.every((socket) => socket.closed)).toBe(true);
  });

  it('does not start a second press after touch-down may have been sent', async () => {
    let connections = 0;
    const packets: Uint8Array[] = [];
    const socket = {
      binaryType: 'blob',
      readyState: 0,
      onopen: null as null | (() => void),
      onerror: null as null | (() => void),
      onclose: null as null | (() => void),
      send(data: Uint8Array) {
        packets.push(data);
      },
      close() {
        this.readyState = 3;
      },
    };
    await expect(
      pressAt('ws://127.0.0.1:41002/ws', 0.5, 0.5, {
        createSocket: () => {
          connections++;
          queueMicrotask(() => {
            socket.readyState = 1;
            socket.onopen?.();
          });
          return socket;
        },
        wait: async (ms) => {
          if (ms === 120) socket.readyState = 3;
        },
      })
    ).rejects.toThrow(/closed mid-press/);
    expect(connections).toBe(1);
    expect(packets).toHaveLength(1);
  });

  it('closes a connecting socket immediately when aborted', async () => {
    const abort = new AbortController();
    let closed = false;
    const pressing = pressAt('ws://127.0.0.1:41002/ws', 0.5, 0.5, {
      signal: abort.signal,
      createSocket: () => ({
        binaryType: 'blob',
        readyState: 0,
        onopen: null,
        onerror: null,
        onclose: null,
        send: () => {},
        close: () => void (closed = true),
      }),
    });
    abort.abort(new Error('test abort'));
    await expect(pressing).rejects.toThrow(/test abort/);
    expect(closed).toBe(true);
  });
});
