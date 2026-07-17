/**
 * The sole owner of real simulator resources used by JSON-native E2E runs.
 * Every session owns a unique Metro process, a simulator created from the UDID
 * returned by `simctl create`, and a foreground serve-sim process. Callers get
 * only a bound install operation; no arbitrary device can cross this boundary.
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { dirname, join } from 'node:path';

import {
  E2E_READY_PROOF_RECONCILIATION_ENV,
  serializeE2EReadyProofAssets,
  type E2EReadyProofAsset,
} from '../../shared/lib/cashu/e2eProofReconciliationConfig';

import {
  APP_DIR,
  BUNDLE_ID,
  DEFAULT_DEVICE,
  findInstallableApp,
  log,
  preparePrivateLog,
  resolveServeSimBin,
  run,
  sleep,
  type RunOptions,
} from './simctl';

type ResetMode = 'erase' | 'reinstall' | 'none';
type CommandExecutor = (command: string[], options?: RunOptions) => Promise<string>;

interface RuntimeDevice {
  name: string;
  identifier: string;
  productFamily?: string;
}

interface RuntimeRecord {
  isAvailable: boolean;
  identifier: string;
  name: string;
  version: string;
  platform?: string;
  supportedDeviceTypes?: RuntimeDevice[];
}

export interface SimulatorTarget {
  runtimeIdentifier: string;
  runtimeName: string;
  runtimeVersion: string;
  deviceTypeIdentifier: string;
  deviceTypeName: string;
}

/** Select a device from the latest installed iOS runtime's own compatibility
 * list. This avoids guessing whether a globally listed device type can boot. */
export function selectSimulatorTarget(raw: string, preferred = DEFAULT_DEVICE): SimulatorTarget {
  let parsed: { runtimes?: RuntimeRecord[] };
  try {
    parsed = JSON.parse(raw) as { runtimes?: RuntimeRecord[] };
  } catch {
    throw new Error('simctl returned invalid runtime JSON');
  }
  const runtimes = (parsed.runtimes ?? [])
    .filter(
      (runtime) =>
        runtime.isAvailable &&
        (runtime.platform === 'iOS' || runtime.identifier.includes('SimRuntime.iOS'))
    )
    .sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true, sensitivity: 'base' })
    );
  for (const runtime of runtimes) {
    const phones = (runtime.supportedDeviceTypes ?? []).filter(
      (device) => device.productFamily === 'iPhone' && device.name.startsWith('iPhone ')
    );
    const device =
      phones.find((candidate) => candidate.name === preferred) ??
      phones.find((candidate) => / Pro$/.test(candidate.name)) ??
      phones[0];
    if (!device) continue;
    return {
      runtimeIdentifier: runtime.identifier,
      runtimeName: runtime.name,
      runtimeVersion: runtime.version,
      deviceTypeIdentifier: device.identifier,
      deviceTypeName: device.name,
    };
  }
  throw new Error('no available iOS runtime with a compatible iPhone simulator');
}

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

export interface EphemeralDevice extends SimulatorTarget {
  readonly udid: string;
  readonly name: string;
  dispose(): Promise<void>;
}

export interface CreateDeviceOptions {
  runId: string;
  preferredDevice?: string;
  signal?: AbortSignal;
  onLifecycle?: (message: string) => void;
}

export async function createEphemeralSimulatorDevice(
  options: CreateDeviceOptions,
  execute: CommandExecutor = run
): Promise<EphemeralDevice> {
  const runtimes = await execute(['xcrun', 'simctl', 'list', 'runtimes', '-j'], {
    signal: options.signal,
  });
  const target = selectSimulatorTarget(runtimes, options.preferredDevice);
  const safeRunId = options.runId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-48);
  const name = `Sovran E2E ${safeRunId}-${randomUUID().slice(0, 8)}`;
  const udid = (
    await execute(
      ['xcrun', 'simctl', 'create', name, target.deviceTypeIdentifier, target.runtimeIdentifier],
      { signal: options.signal }
    )
  ).trim();
  if (!UDID.test(udid))
    throw new Error(`simctl create returned an invalid simulator UDID: ${JSON.stringify(udid)}`);

  let disposePromise: Promise<void> | undefined;
  const dispose = (): Promise<void> => {
    disposePromise ??= (async () => {
      await execute(['xcrun', 'simctl', 'shutdown', udid], { allowFail: true });
      await execute(['xcrun', 'simctl', 'delete', udid]);
      (options.onLifecycle ?? log)(`deleted ephemeral simulator "${name}" (${udid})`);
    })();
    return disposePromise;
  };

  try {
    (options.onLifecycle ?? log)(`created fresh ephemeral simulator "${name}" (${udid})`);
    await execute(['xcrun', 'simctl', 'boot', udid], { signal: options.signal });
    await execute(['xcrun', 'simctl', 'bootstatus', udid, '-b'], { signal: options.signal });
    await execute(
      [
        'xcrun',
        'simctl',
        'status_bar',
        udid,
        'override',
        '--time',
        '9:41',
        '--batteryState',
        'charged',
        '--batteryLevel',
        '100',
        '--cellularBars',
        '4',
        '--operatorName',
        '',
      ],
      { allowFail: true, signal: options.signal }
    );
    return { ...target, udid, name, dispose };
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `ephemeral simulator setup failed and cleanup also failed for ${udid}`
      );
    }
    throw error;
  }
}

export function buildMetroEnvironment(
  source: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    seedExport?: { endpoint: string; token: string };
    controlledP2PKPubkey?: string;
    fundedAssets?: readonly E2EReadyProofAsset[];
    mockFailPaymentRequest?: boolean;
  } = {}
): Record<string, string | undefined> {
  const environment = { ...source };
  delete environment.DEBUG_MNEMONIC;
  delete environment.EXPO_PUBLIC_DEBUG_MNEMONIC;
  delete environment.EXPO_PUBLIC_E2E_SEED_EXPORT;
  delete environment.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT;
  delete environment.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN;
  delete environment.EXPO_PUBLIC_E2E_CONTROLLED_P2PK_PUBKEY;
  delete environment.EXPO_PUBLIC_E2E_MOCK_FAIL_PAYMENT_REQUEST;
  delete environment[E2E_READY_PROOF_RECONCILIATION_ENV];
  delete environment.EXPO_PUBLIC_E2E_ONBOARDING_SLIDE_MS;
  delete environment.EXPO_PUBLIC_E2E_TOAST_DISMISS_MS;
  delete environment.EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS;
  delete environment.EXPO_PUBLIC_E2E_STATE_MIRROR;
  delete environment.RCT_METRO_PORT;
  // The onboarding carousel's 3s auto-advance outpaces the harness's per-step
  // evidence capture (~1s each), so slide screenshots can never anchor to the
  // right slide. Every owned e2e Metro slows the slides; taps still advance.
  environment.EXPO_PUBLIC_E2E_ONBOARDING_SLIDE_MS = '20000';
  // Terminal payment toasts auto-dismiss after 3s while their AX probe is
  // retained 15s past dismissal, so a waitFor-then-screenshot always samples
  // after the visible toast is gone. Slow the dismiss the same way — but only
  // to 8s: capture needs ~4-6s, and a longer linger poisons later stable
  // screenshots (a toast is ~7% of the frame vs 0.1% tolerances).
  environment.EXPO_PUBLIC_E2E_TOAST_DISMISS_MS = '8000';
  // The settings dev-mode gesture is a 1.5s triple-tap; harness taps open one
  // HID session each (~2s apart), so the window must be widened to be
  // reachable at all from the simulator driver.
  environment.EXPO_PUBLIC_E2E_TRIPLE_TAP_WINDOW_MS = '20000';
  // Every owned e2e Metro turns on the in-app zustand state mirror so each
  // evidence frame gets a .store.json sidecar (see shared/lib/e2e/stateMirror).
  environment.EXPO_PUBLIC_E2E_STATE_MIRROR = '1';
  const nodeOptions = (environment.NODE_OPTIONS ?? '')
    .replace(/(?:^|\s)--dns-result-order(?:=|\s+)\S+/g, ' ')
    .trim();
  environment.NODE_OPTIONS = [nodeOptions, '--dns-result-order=ipv4first']
    .filter(Boolean)
    .join(' ');
  if (options.seedExport) {
    const endpoint = new URL(options.seedExport.endpoint);
    if (
      endpoint.protocol !== 'http:' ||
      endpoint.hostname !== '127.0.0.1' ||
      !endpoint.port ||
      endpoint.pathname !== '/seed' ||
      endpoint.search ||
      endpoint.hash ||
      !/^[0-9a-f]{64}$/.test(options.seedExport.token)
    ) {
      throw new Error('funded Metro seed export requires an owned private endpoint');
    }
    environment.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT = endpoint.toString();
    environment.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN = options.seedExport.token;
  }
  if (options.controlledP2PKPubkey) {
    if (!options.seedExport) {
      throw new Error('controlled P2PK target requires a funded Metro session');
    }
    if (!/^02[0-9a-f]{64}$/i.test(options.controlledP2PKPubkey)) {
      throw new Error('controlled P2PK public key must be compressed 02-prefixed hex');
    }
    environment.EXPO_PUBLIC_E2E_CONTROLLED_P2PK_PUBKEY = options.controlledP2PKPubkey.toLowerCase();
  }
  if (options.fundedAssets) {
    if (!options.seedExport) {
      throw new Error('funded asset reconciliation requires a funded Metro session');
    }
    environment[E2E_READY_PROOF_RECONCILIATION_ENV] = serializeE2EReadyProofAssets(
      options.fundedAssets
    );
  }
  if (options.mockFailPaymentRequest) {
    if (!options.seedExport) {
      throw new Error('payment-request delivery failure mock requires a funded Metro session');
    }
    environment.EXPO_PUBLIC_E2E_MOCK_FAIL_PAYMENT_REQUEST = '1';
  }
  return environment;
}

/** A legacy app bundle must never put recovery material back onto Metro stdout.
 * Reject the marker before persistence instead of trying to redact it later. */
export function sanitizeMetroLogLine(line: string): string {
  if (line.includes('E2E_SEED_EXPORT')) {
    throw new Error('forbidden legacy E2E seed export reached Metro output');
  }
  return line;
}

export function buildDevClientUrl(metroUrl: string, bundleId = BUNDLE_ID): string {
  const url = new URL(`${bundleId}://expo-development-client/`);
  url.searchParams.set('url', metroUrl);
  return url.toString();
}

export function resolveExpoBin(
  appDir = APP_DIR,
  pathExists: (path: string) => boolean = existsSync
): string {
  const executable = [
    join(appDir, 'node_modules', '.bin', 'expo'),
    join(appDir, '..', 'node_modules', '.bin', 'expo'),
  ].find(pathExists);
  if (!executable) throw new Error('Expo CLI not found in node_modules — run bun install');
  return executable;
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('could not allocate a loopback port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export interface PrivateSeedExportServer {
  readonly endpoint: string;
  readonly token: string;
  stop(): Promise<void>;
}

function readBoundedSeedBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > 512) {
        reject(new Error('seed export body exceeds limit'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.once('end', () => resolve(body));
    request.once('error', () => reject(new Error('seed export request failed')));
  });
}

function authenticatedSeedRequest(request: IncomingMessage, token: string): boolean {
  const supplied = request.headers['x-sovran-e2e-token'];
  if (typeof supplied !== 'string') return false;
  const expectedBytes = Buffer.from(token);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

/** One authenticated HTTP endpoint bound to IPv4 loopback for the lifetime of
 * the owned Metro session. It never logs or persists the request body. */
export async function startPrivateSeedExportServer(
  onSeedExport: (mnemonic: string) => void
): Promise<PrivateSeedExportServer> {
  const token = randomBytes(32).toString('hex');
  const server = createHttpServer((request, response) => {
    if (
      request.method !== 'POST' ||
      request.url !== '/seed' ||
      request.socket.remoteAddress !== '127.0.0.1' ||
      !authenticatedSeedRequest(request, token)
    ) {
      request.resume();
      response.writeHead(404).end();
      return;
    }
    void readBoundedSeedBody(request)
      .then((mnemonic) => {
        onSeedExport(mnemonic);
        response.writeHead(204).end();
      })
      .catch(() => {
        if (!response.headersSent) response.writeHead(400).end();
        else response.destroy();
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('could not start private seed-export server');
  }
  let stopPromise: Promise<void> | undefined;
  return {
    endpoint: `http://127.0.0.1:${address.port}/seed`,
    token,
    stop: () =>
      (stopPromise ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })),
  };
}

interface KillableProcess {
  readonly pid: number;
  readonly exited: Promise<number>;
  kill(signal?: number | NodeJS.Signals): void;
}

async function exitsWithin(process: KillableProcess, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      process.exited.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function stopOwnedProcess(process: KillableProcess): Promise<void> {
  try {
    process.kill('SIGTERM');
  } catch {
    // It already exited.
  }
  if (await exitsWithin(process, 5_000)) return;
  try {
    process.kill('SIGKILL');
  } catch {
    // It exited between the timeout and escalation.
  }
  await process.exited;
}

async function metroRunning(url: string): Promise<boolean> {
  try {
    // eslint-disable-next-line no-restricted-globals -- Metro's local status endpoint is plain text
    const response = await fetch(`${url}/status`, { signal: AbortSignal.timeout(2_000) });
    return (await response.text()).includes('packager-status:running');
  } catch {
    return false;
  }
}

interface MetroSession {
  readonly url: string;
  readonly port: number;
  readonly pid: number;
  readonly logPath: string;
  stop(): Promise<void>;
}

async function pumpSanitizedMetroOutput(
  stream: ReadableStream<Uint8Array>,
  logPath: string
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline + 1);
        buffer = buffer.slice(newline + 1);
        appendFileSync(logPath, sanitizeMetroLogLine(line), { mode: 0o600 });
      }
    }
    buffer += decoder.decode();
    if (buffer) appendFileSync(logPath, sanitizeMetroLogLine(buffer), { mode: 0o600 });
  } finally {
    reader.releaseLock();
  }
}

/** Bun prints a four-line tsconfig capability warning whenever the isolated
 * bridge starts from TypeScript. It is unrelated to the child process and
 * otherwise makes a healthy private diagnostic log look actionable. */
export function sanitizeSimulatorBridgeLog(output: string): string {
  return output
    .split('\n')
    .filter(
      (line) =>
        !line.includes('"moduleSuffixes"') &&
        !line.includes('moduleSuffixes is not supported yet') &&
        !line.includes('/tsconfig.json:14:5') &&
        line.trim() !== '^'
    )
    .join('\n')
    .trim();
}

async function pumpSimulatorBridgeOutput(
  stream: ReadableStream<Uint8Array>,
  logPath: string
): Promise<void> {
  const output = sanitizeSimulatorBridgeLog(await new Response(stream).text());
  if (output) appendFileSync(logPath, `${sanitizeMetroLogLine(output)}\n`, { mode: 0o600 });
}

interface MetroStartOptions {
  onSeedExport?: (mnemonic: string) => void;
  controlledP2PKPubkey?: string;
  fundedAssets?: readonly E2EReadyProofAsset[];
  mockFailPaymentRequest?: boolean;
  onLifecycle?: (message: string) => void;
}

async function startOwnedMetro(
  runDir: string,
  signal?: AbortSignal,
  options: MetroStartOptions = {}
): Promise<MetroSession> {
  if (signal?.aborted) throw signal.reason;
  const expo = resolveExpoBin();
  const port = await allocateLoopbackPort();
  // Expo's dev-client manifest emits 127.0.0.1 for `--localhost`; the sanitized
  // NODE_OPTIONS above makes the listener choose that same loopback family.
  const url = `http://localhost:${port}`;
  const logPath = join(runDir, 'metro.log');
  preparePrivateLog(logPath);
  const seedExport = options.onSeedExport
    ? await startPrivateSeedExportServer(options.onSeedExport)
    : undefined;
  (options.onLifecycle ?? log)(
    `starting owned Metro on ${port} (seed export ${seedExport ? 'private IPC' : 'disabled'})`
  );
  const child = await (async () => {
    try {
      return Bun.spawn([expo, 'start', '--port', String(port), '--localhost'], {
        cwd: APP_DIR,
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: 'ignore',
        env: buildMetroEnvironment(process.env, {
          seedExport,
          controlledP2PKPubkey: options.controlledP2PKPubkey,
          fundedAssets: options.fundedAssets,
          mockFailPaymentRequest: options.mockFailPaymentRequest,
        }),
      });
    } catch (error) {
      await seedExport?.stop();
      throw error;
    }
  })();
  let outputFailure: unknown;
  const output = Promise.all([
    pumpSanitizedMetroOutput(child.stdout, logPath),
    pumpSanitizedMetroOutput(child.stderr, logPath),
  ]).catch((error) => {
    outputFailure = error;
    child.kill('SIGTERM');
  });
  let stopPromise: Promise<void> | undefined;
  const stop = () =>
    (stopPromise ??= (async () => {
      try {
        await stopOwnedProcess(child);
        await output;
        if (outputFailure) throw outputFailure;
      } finally {
        await seedExport?.stop();
      }
    })());
  let exitCode: number | undefined;
  void child.exited.then((code) => {
    exitCode = code;
  });
  try {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason;
      if (outputFailure) throw outputFailure;
      if (exitCode !== undefined)
        throw new Error(`owned Metro exited with code ${exitCode} before becoming ready`);
      if (await metroRunning(url)) return { url, port, pid: child.pid, logPath, stop };
      await sleep(500);
    }
    throw new Error(`owned Metro did not come up on ${port} (see ${logPath})`);
  } catch (error) {
    await stop();
    throw error;
  }
}

interface ServeSimSession {
  readonly axEndpoint: string;
  readonly touchEndpoint: string;
  readonly port: number;
  readonly pid: number;
  readonly logPath: string;
  onUnexpectedExit(listener: (error: SimulatorInfrastructureError) => void): () => void;
  stop(): Promise<void>;
}

export class SimulatorInfrastructureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SimulatorInfrastructureError';
  }
}

async function readFirstLine(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buffer = '';
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;
      try {
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('timed out waiting for serve-sim metadata')),
              Math.max(1, deadline - Date.now())
            );
          }),
          new Promise<never>((_, reject) => {
            if (!signal) return;
            onAbort = () => reject(signal.reason);
            signal.addEventListener('abort', onAbort, { once: true });
          }),
        ]);
        if (next.done) throw new Error('serve-sim exited before emitting session metadata');
        buffer += decoder.decode(next.value, { stream: true });
        const newline = buffer.indexOf('\n');
        if (newline >= 0) return buffer.slice(0, newline).trim();
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) signal?.removeEventListener('abort', onAbort);
      }
    }
    throw new Error('timed out waiting for serve-sim metadata');
  } finally {
    reader.releaseLock();
  }
}

export function parseOwnedServeSimMetadata(
  line: string,
  expectedUdid: string,
  expectedPort: number
): Pick<ServeSimSession, 'axEndpoint' | 'touchEndpoint' | 'port'> {
  let metadata: {
    device?: string;
    streamUrl?: string;
    wsUrl?: string;
    port?: number;
  };
  try {
    metadata = JSON.parse(line);
  } catch {
    throw new Error('serve-sim returned invalid session metadata');
  }
  if (metadata.device !== expectedUdid) {
    throw new Error('serve-sim returned metadata for an unexpected device');
  }
  if (
    !Number.isInteger(metadata.port) ||
    metadata.port! < 1 ||
    metadata.port! > 65535 ||
    metadata.port !== expectedPort ||
    !metadata.streamUrl ||
    !metadata.wsUrl
  ) {
    throw new Error('serve-sim metadata is not the expected owned loopback session');
  }
  let streamUrl: URL;
  let touchUrl: URL;
  try {
    streamUrl = new URL(metadata.streamUrl);
    touchUrl = new URL(metadata.wsUrl);
  } catch {
    throw new Error('serve-sim metadata is not the expected owned loopback session');
  }
  const port = String(metadata.port);
  if (
    streamUrl.protocol !== 'http:' ||
    touchUrl.protocol !== 'ws:' ||
    streamUrl.hostname !== '127.0.0.1' ||
    touchUrl.hostname !== '127.0.0.1' ||
    streamUrl.port !== port ||
    touchUrl.port !== port
  ) {
    throw new Error('serve-sim metadata is not the expected owned loopback session');
  }
  return {
    axEndpoint: `${streamUrl.origin}/ax`,
    touchEndpoint: touchUrl.toString(),
    port: metadata.port,
  };
}

export function resolveServeSimNativeAddon(bin = resolveServeSimBin()): string {
  const addon = join(dirname(realpathSync(bin)), 'native', 'serve-sim-native.node');
  if (!existsSync(addon)) throw new Error('serve-sim native addon is missing — run bun install');
  return addon;
}

async function startOwnedServeSim(
  udid: string,
  runDir: string,
  signal?: AbortSignal,
  onLifecycle: (message: string) => void = log
): Promise<ServeSimSession> {
  if (signal?.aborted) throw signal.reason;
  const port = await allocateLoopbackPort();
  const logPath = join(runDir, 'simulator-bridge.log');
  preparePrivateLog(logPath);
  const bridgeScript = Bun.fileURLToPath(new URL('./simulator-bridge.ts', import.meta.url));
  const child = Bun.spawn(
    [process.execPath, bridgeScript, String(port), udid, resolveServeSimNativeAddon()],
    { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' }
  );
  const output = pumpSimulatorBridgeOutput(child.stderr, logPath);
  const listeners = new Set<(error: SimulatorInfrastructureError) => void>();
  let stopping = false;
  let unexpectedExit: SimulatorInfrastructureError | undefined;
  void child.exited.then((code) => {
    if (stopping) return;
    unexpectedExit = new SimulatorInfrastructureError(
      `owned simulator bridge exited unexpectedly with code ${code} (see ${logPath})`
    );
    for (const listener of listeners) listener(unexpectedExit);
  });
  let stopPromise: Promise<void> | undefined;
  const stop = async () => {
    stopPromise ??= (async () => {
      stopping = true;
      await stopOwnedProcess(child);
      await output;
    })();
    return stopPromise;
  };
  try {
    const line = await readFirstLine(child.stdout, signal, 20_000);
    const metadata = parseOwnedServeSimMetadata(line, udid, port);
    onLifecycle(`owned E2E bridge ready on ${metadata.axEndpoint} (video capture disabled)`);
    return {
      ...metadata,
      pid: child.pid,
      logPath,
      onUnexpectedExit(listener) {
        listeners.add(listener);
        if (unexpectedExit) listener(unexpectedExit);
        return () => listeners.delete(listener);
      },
      stop,
    };
  } catch (error) {
    await stop();
    const detail = readFileSync(logPath, 'utf8').trim();
    throw new Error(`could not start owned E2E bridge for ${udid}${detail ? `: ${detail}` : ''}`, {
      cause: error,
    });
  }
}

interface InstallOptions {
  udid: string;
  reset: ResetMode;
  appPath: string;
  metroUrl: string;
  signal: AbortSignal;
  execute: CommandExecutor;
  onLifecycle: (message: string) => void;
}

async function installOwnedApp(options: InstallOptions): Promise<void> {
  const { udid, reset, appPath, metroUrl, signal, execute, onLifecycle } = options;
  const devClientUrl = buildDevClientUrl(metroUrl);
  if (reset === 'none') {
    await execute(['xcrun', 'simctl', 'terminate', udid, BUNDLE_ID], {
      allowFail: true,
      signal,
    });
    await sleep(1_000);
    await execute(['xcrun', 'simctl', 'launch', udid, BUNDLE_ID], { signal });
    await sleep(2_000);
    await execute(['xcrun', 'simctl', 'openurl', udid, devClientUrl], { signal });
    return;
  }

  onLifecycle(`installing ${BUNDLE_ID} from ${appPath}`);
  await execute(['xcrun', 'simctl', 'terminate', udid, BUNDLE_ID], {
    allowFail: true,
    signal,
  });
  await execute(['xcrun', 'simctl', 'uninstall', udid, BUNDLE_ID], {
    allowFail: true,
    signal,
  });
  await execute(['xcrun', 'simctl', 'install', udid, appPath], { signal });
  const container = await execute(
    ['xcrun', 'simctl', 'get_app_container', udid, BUNDLE_ID, 'data'],
    { allowFail: true, signal }
  );
  if (container) {
    const preferences = join(container, 'Library', 'Preferences', `${BUNDLE_ID}.plist`);
    mkdirSync(dirname(preferences), { recursive: true });
    if (!existsSync(preferences))
      await execute(['plutil', '-create', 'binary1', preferences], { allowFail: true, signal });
    await execute(
      ['plutil', '-replace', 'EXDevMenuIsOnboardingFinished', '-bool', 'true', preferences],
      { allowFail: true, signal }
    );
    await execute(
      ['plutil', '-replace', 'EXDevMenuShowFloatingActionButton', '-bool', 'false', preferences],
      { allowFail: true, signal }
    );
  }
  await execute(['xcrun', 'simctl', 'privacy', udid, 'grant', 'location', BUNDLE_ID], {
    allowFail: true,
    signal,
  });
  await execute(['xcrun', 'simctl', 'launch', udid, BUNDLE_ID], { signal });
  await sleep(2_000);
  await execute(['xcrun', 'simctl', 'openurl', udid, devClientUrl], { signal });
}

export type RunSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

export class SimulatorRunInterrupted extends Error {
  readonly exitCode: number;
  constructor(readonly signal: RunSignal) {
    super(`simulator run interrupted by ${signal}`);
    this.name = 'SimulatorRunInterrupted';
    this.exitCode = signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 129;
  }
}

interface SignalSource {
  on(signal: RunSignal, listener: () => void): void;
  off(signal: RunSignal, listener: () => void): void;
}

const processSignals: SignalSource = {
  on: (signal, listener) => process.on(signal, listener),
  off: (signal, listener) => process.off(signal, listener),
};

export interface EphemeralSimulatorSession {
  readonly udid: string;
  readonly name: string;
  readonly runtimeName: string;
  readonly runtimeVersion: string;
  readonly deviceTypeName: string;
  readonly metroUrl: string;
  readonly metroPort: number;
  readonly metroPid: number;
  readonly serveSimPort: number;
  readonly serveSimPid: number;
  readonly serveSimLogPath: string;
  readonly axEndpoint: string;
  readonly touchEndpoint: string;
  reportInfrastructureFailure(error: Error): void;
  install(reset: ResetMode): Promise<void>;
}

interface SessionDependencies {
  execute?: CommandExecutor;
  findApp?: typeof findInstallableApp;
  startMetro?: typeof startOwnedMetro;
  createDevice?: typeof createEphemeralSimulatorDevice;
  startServeSim?: typeof startOwnedServeSim;
  signals?: SignalSource;
}

export async function withEphemeralSimulatorSession<T>(
  options: {
    runId: string;
    runDir: string;
    preferredDevice?: string;
    onSeedExport?: (mnemonic: string) => void;
    controlledP2PKPubkey?: string;
    fundedAssets?: readonly E2EReadyProofAsset[];
    mockFailPaymentRequest?: boolean;
    onLifecycle?: (message: string) => void;
  },
  callback: (session: EphemeralSimulatorSession, signal: AbortSignal) => Promise<T>,
  dependencies: SessionDependencies = {}
): Promise<T> {
  if (options.mockFailPaymentRequest && !options.onSeedExport) {
    throw new Error('payment-request delivery failure mock requires a funded simulator session');
  }
  const execute = dependencies.execute ?? run;
  const findApp = dependencies.findApp ?? findInstallableApp;
  const startMetro = dependencies.startMetro ?? startOwnedMetro;
  const createDevice = dependencies.createDevice ?? createEphemeralSimulatorDevice;
  const startServeSim = dependencies.startServeSim ?? startOwnedServeSim;
  const signals = dependencies.signals ?? processSignals;
  const onLifecycle = options.onLifecycle ?? log;
  const abort = new AbortController();
  const cleanups: { priority: number; run: () => Promise<void> }[] = [];
  const cleanupErrors: unknown[] = [];
  let interrupted: SimulatorRunInterrupted | undefined;
  const handlers = new Map<RunSignal, () => void>();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const handler = () => {
      interrupted ??= new SimulatorRunInterrupted(signal);
      abort.abort(interrupted);
    };
    handlers.set(signal, handler);
    signals.on(signal, handler);
  }

  let result: T | undefined;
  let failure: unknown;
  try {
    const appPath = await findApp(undefined, BUNDLE_ID, onLifecycle);
    if (abort.signal.aborted) throw abort.signal.reason;
    const metro = await startMetro(options.runDir, abort.signal, {
      onSeedExport: options.onSeedExport,
      controlledP2PKPubkey: options.controlledP2PKPubkey,
      fundedAssets: options.fundedAssets,
      mockFailPaymentRequest: options.mockFailPaymentRequest,
      onLifecycle,
    });
    cleanups.push({ priority: 20, run: () => metro.stop() });
    const device = await createDevice(
      {
        runId: options.runId,
        preferredDevice: options.preferredDevice,
        signal: abort.signal,
        onLifecycle,
      },
      execute
    );
    cleanups.push({ priority: 10, run: () => device.dispose() });
    const serveSim = await startServeSim(device.udid, options.runDir, abort.signal, onLifecycle);
    cleanups.push({ priority: 30, run: () => serveSim.stop() });
    const removeUnexpectedExit = serveSim.onUnexpectedExit((error) => abort.abort(error));
    cleanups.push({ priority: 40, run: async () => void removeUnexpectedExit() });
    const session: EphemeralSimulatorSession = {
      udid: device.udid,
      name: device.name,
      runtimeName: device.runtimeName,
      runtimeVersion: device.runtimeVersion,
      deviceTypeName: device.deviceTypeName,
      metroUrl: metro.url,
      metroPort: metro.port,
      metroPid: metro.pid,
      serveSimPort: serveSim.port,
      serveSimPid: serveSim.pid,
      serveSimLogPath: serveSim.logPath,
      axEndpoint: serveSim.axEndpoint,
      touchEndpoint: serveSim.touchEndpoint,
      reportInfrastructureFailure(error) {
        abort.abort(
          error instanceof SimulatorInfrastructureError
            ? error
            : new SimulatorInfrastructureError(error.message, { cause: error })
        );
      },
      install: (reset) =>
        installOwnedApp({
          udid: device.udid,
          reset,
          appPath,
          metroUrl: metro.url,
          signal: abort.signal,
          execute,
          onLifecycle,
        }),
    };
    result = await callback(session, abort.signal);
  } catch (error) {
    failure = error;
  } finally {
    abort.abort(interrupted ?? new Error('simulator session complete'));
    for (const cleanup of cleanups.sort((a, b) => b.priority - a.priority)) {
      try {
        await cleanup.run();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const [signal, handler] of handlers) signals.off(signal, handler);
  }

  if (interrupted) failure = interrupted;
  if (failure !== undefined && cleanupErrors.length)
    throw new AggregateError([failure, ...cleanupErrors], 'simulator run and cleanup failed');
  if (failure !== undefined) throw failure;
  if (cleanupErrors.length)
    throw new AggregateError(cleanupErrors, 'ephemeral simulator cleanup failed');
  return result as T;
}
