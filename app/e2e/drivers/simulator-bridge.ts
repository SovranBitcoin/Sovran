/**
 * E2E-only simulator bridge. It intentionally exposes accessibility and HID,
 * but never constructs serve-sim's NativeCapture: the JSON harness captures
 * bitmaps with `simctl io screenshot`, so starting a framebuffer stream is both
 * unnecessary and (in serve-sim 0.1.44) a native crash surface.
 */
import { createRequire } from 'node:module';

interface NativeHid {
  touch(type: string, x: number, y: number, width: number, height: number, edge: number): void;
}

export interface SimulatorBridgeNative {
  SimHID: new (udid: string) => NativeHid;
  axDescribe(udid: string): Promise<string>;
}

export interface SimulatorBridge {
  readonly port: number;
  readonly axEndpoint: string;
  readonly touchEndpoint: string;
  stop(): void;
}

interface RawAxNode {
  frame: { x: number; y: number; width: number; height: number };
  AXUniqueId?: string | null;
  AXLabel?: string | null;
  AXValue?: string | null;
  role_description?: string;
  type?: string;
  enabled?: boolean;
  children?: RawAxNode[];
}

function parseRawAx(raw: string): RawAxNode[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || !value.length || !value[0]?.frame) {
    throw new Error('native simulator bridge returned an invalid accessibility tree');
  }
  return value as RawAxNode[];
}

function normalizeAx(roots: RawAxNode[]) {
  const screen = roots[0]!.frame;
  const elements: Record<string, unknown>[] = [];
  const sameFrame = (frame: RawAxNode['frame']) =>
    Math.abs(frame.x - screen.x) < 0.5 &&
    Math.abs(frame.y - screen.y) < 0.5 &&
    Math.abs(frame.width - screen.width) < 0.5 &&
    Math.abs(frame.height - screen.height) < 0.5;
  const visit = (node: RawAxNode, path: string) => {
    if (elements.length >= 500) return;
    if (!sameFrame(node.frame)) {
      elements.push({
        id: node.AXUniqueId ?? path,
        path,
        label: node.AXLabel ?? '',
        value: node.AXValue ?? '',
        role: node.role_description ?? '',
        type: node.type ?? '',
        enabled: node.enabled !== false,
        frame: node.frame,
      });
    }
    for (let index = 0; index < (node.children?.length ?? 0) && elements.length < 500; index++) {
      visit(node.children![index]!, `${path}.${index}`);
    }
  };
  roots.forEach((root, index) => visit(root, String(index)));
  return { screen: { width: screen.width, height: screen.height }, elements };
}

export function startSimulatorBridge(options: {
  udid: string;
  port: number;
  native: SimulatorBridgeNative;
  pollMs?: number;
}): SimulatorBridge {
  const { udid, native } = options;
  const hid = new native.SimHID(udid);
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  let width = 0;
  let height = 0;
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let axTail: Promise<void> = Promise.resolve();

  // The private translator is process-global. Serialize the whole query, not
  // just its token map, so SSE polling and screenshot bracketing cannot race it.
  const describe = (): Promise<{ raw: string; roots: RawAxNode[] }> => {
    const result = axTail
      .catch(() => {})
      .then(async () => {
        const raw = await native.axDescribe(udid);
        const roots = parseRawAx(raw);
        width = roots[0]!.frame.width;
        height = roots[0]!.frame.height;
        return { raw, roots };
      });
    axTail = result.then(
      () => {},
      () => {}
    );
    return result;
  };

  const poll = async () => {
    pollTimer = undefined;
    if (stopped || clients.size === 0) return;
    try {
      const message = `data: ${JSON.stringify(normalizeAx((await describe()).roots))}\n\n`;
      // Every successful native read is a fresh observation, even when its
      // contents are unchanged. Consumers use these frames to distinguish a
      // stable screen from repeatedly polling one cached snapshot.
      const bytes = encoder.encode(message);
      for (const client of clients) client.enqueue(bytes);
    } catch (error) {
      const message = `data: ${JSON.stringify({
        screen: { width: 1, height: 1 },
        elements: [],
        errors: [error instanceof Error ? error.message : String(error)],
      })}\n\n`;
      const bytes = encoder.encode(message);
      for (const client of clients) client.enqueue(bytes);
    } finally {
      if (!stopped && clients.size > 0) pollTimer = setTimeout(poll, options.pollMs ?? 500);
    }
  };

  const server = Bun.serve<{ udid: string }>({
    hostname: '127.0.0.1',
    port: options.port,
    fetch: async (request, socketServer) => {
      const url = new URL(request.url);
      if (url.pathname === '/ws') {
        return socketServer.upgrade(request, { data: { udid } })
          ? undefined
          : new Response('upgrade failed', { status: 500 });
      }
      if (url.pathname === '/status') return new Response('ok');
      if (url.pathname === `/helper/${encodeURIComponent(udid)}/ax`) {
        try {
          return new Response((await describe()).raw, {
            headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 503 }
          );
        }
      }
      if (url.pathname === '/ax') {
        let controller: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
            clients.add(value);
            value.enqueue(encoder.encode(':\n\n'));
            if (!pollTimer) void poll();
          },
          cancel() {
            clients.delete(controller);
            if (clients.size === 0 && pollTimer) {
              clearTimeout(pollTimer);
              pollTimer = undefined;
            }
          },
        });
        return new Response(body, {
          headers: {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
          },
        });
      }
      return new Response('not found', { status: 404 });
    },
    websocket: {
      async message(_socket, message) {
        try {
          const bytes =
            typeof message === 'string'
              ? new TextEncoder().encode(message)
              : new Uint8Array(message);
          if (bytes[0] !== 3) return;
          const payload = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as {
            type: string;
            x: number;
            y: number;
            edge?: number;
          };
          if (width <= 1 || height <= 1) await describe();
          hid.touch(payload.type, payload.x, payload.y, width, height, payload.edge ?? 0);
        } catch (error) {
          process.stderr.write(
            `[bridge] ignored invalid HID packet: ${error instanceof Error ? error.message : String(error)}\n`
          );
        }
      },
    },
  });
  const boundPort = server.port;
  if (!boundPort) {
    server.stop(true);
    throw new Error('simulator bridge failed to bind its owned loopback port');
  }

  return {
    port: boundPort,
    axEndpoint: `http://127.0.0.1:${boundPort}/ax`,
    touchEndpoint: `ws://127.0.0.1:${boundPort}/ws`,
    stop() {
      if (stopped) return;
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      for (const client of clients) client.close();
      clients.clear();
      server.stop(true);
    },
  };
}

async function main() {
  const port = Number(process.argv[2]);
  const udid = process.argv[3];
  const addonPath = process.argv[4];
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !udid || !addonPath) {
    throw new Error('usage: simulator-bridge <port> <udid> <native-addon>');
  }
  const require = createRequire(import.meta.url);
  const native = require(addonPath) as SimulatorBridgeNative;
  const bridge = startSimulatorBridge({ udid, port, native });
  process.stdout.write(
    `${JSON.stringify({
      device: udid,
      port: bridge.port,
      streamUrl: `http://127.0.0.1:${bridge.port}/unused`,
      wsUrl: bridge.touchEndpoint,
    })}\n`
  );
  const stop = () => {
    bridge.stop();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exit(1);
  });
}
