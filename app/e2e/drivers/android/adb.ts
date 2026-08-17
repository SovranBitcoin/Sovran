/** Serial-scoped adb primitives for the Android emulator driver. Mirrors
 * simctl.ts: resource ownership (emulator boot/dispose, Metro, reverse) lives
 * in android-session.ts; this module exposes per-device command helpers only.
 * Everything rides one adb serial so parallel emulators can never cross. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_ID, run, sleep, type RunOptions } from '../simctl';

/** Same applicationId as iOS's dev-variant bundle id (app.config.js). */
export const ANDROID_PACKAGE_ID = BUNDLE_ID;

/** ANDROID_HOME / ANDROID_SDK_ROOT, else the macOS default install path.
 * Resolved lazily at the emulator effect boundary (offline commands must not
 * require the SDK just to validate JSON). */
export function resolveAndroidSdkRoot(
  env: Record<string, string | undefined> = process.env
): string {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library', 'Android', 'sdk'),
  ];
  for (const root of candidates) {
    if (root && existsSync(join(root, 'platform-tools', 'adb'))) return root;
  }
  throw new Error(
    'Android SDK not found — set ANDROID_HOME or install to ~/Library/Android/sdk (needs platform-tools/adb)'
  );
}

export const adbBin = (sdkRoot: string): string => join(sdkRoot, 'platform-tools', 'adb');
export const emulatorBin = (sdkRoot: string): string => join(sdkRoot, 'emulator', 'emulator');

/** `input text` charset. Anything outside this set fails loudly (mirrors the
 * HID keystroke contract): silently dropped characters corrupt typed URIs and
 * are far worse than an authored-scenario error. Space is sent as `%s`. */
const INPUT_TEXT_SAFE = /^[A-Za-z0-9 .,:/@_+\-=?#%&]*$/;

/** Pure `input text` argument builder (exported for offline tests). adb joins
 * shell args with spaces; %s is input text's own space escape. Metacharacters
 * in the safe set (&, ?, #, %) still need device-shell quoting, so the
 * argument is single-quoted (safe: ' itself is excluded from the charset). */
export function escapeInputText(value: string): string {
  if (!INPUT_TEXT_SAFE.test(value)) {
    const bad = [...value].find((ch) => !INPUT_TEXT_SAFE.test(ch));
    throw new Error(`android input text cannot type ${JSON.stringify(bad)} — unsupported charset`);
  }
  if (!value) return '';
  return `'${value.replaceAll(' ', '%s')}'`;
}

interface AndroidScreenSize {
  width: number;
  height: number;
}

/** Extract the uiautomator document without ever echoing malformed AX text
 * into an exception, event, reporter, or persisted run log. */
export function extractUiautomatorXml(out: string): string {
  const start = out.indexOf('<?xml');
  const end = out.lastIndexOf('>');
  if (start === -1 || end <= start) {
    throw new Error(`dump produced no XML (${Buffer.byteLength(out, 'utf8')} bytes)`);
  }
  return out.slice(start, end + 1);
}

export class Adb {
  readonly serial: string;
  #bin: string;
  #signal: AbortSignal | undefined;
  #screen: AndroidScreenSize | undefined;

  constructor(options: { serial: string; bin: string; signal?: AbortSignal }) {
    this.serial = options.serial;
    this.#bin = options.bin;
    this.#signal = options.signal;
  }

  #opts(extra: RunOptions = {}): RunOptions {
    return { signal: this.#signal, ...extra };
  }

  async raw(args: string[], opts: RunOptions = {}): Promise<string> {
    return run([this.#bin, '-s', this.serial, ...args], this.#opts(opts));
  }

  async shell(args: string[], opts: RunOptions = {}): Promise<string> {
    return this.raw(['shell', ...args], opts);
  }

  /** Binary-safe exec-out (screenshots, file pulls to stdout). */
  async execOutBytes(args: string[]): Promise<Uint8Array> {
    if (this.#signal?.aborted) throw new Error('operation aborted');
    const proc = Bun.spawn([this.#bin, '-s', this.serial, 'exec-out', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const onAbort = () => proc.kill('SIGTERM');
    this.#signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const [bytes, err, code] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (code !== 0) throw new Error(`adb exec-out failed (${code}): ${args.join(' ')}\n${err}`);
      return new Uint8Array(bytes);
    } finally {
      this.#signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Physical display size (cached; `wm size` is stable for a booted AVD). */
  async screenSize(): Promise<AndroidScreenSize> {
    if (this.#screen) return this.#screen;
    const out = await this.shell(['wm', 'size']);
    // "Physical size: 1080x2400" (an Override line, when present, wins)
    const override = out.match(/Override size:\s*(\d+)x(\d+)/);
    const physical = out.match(/Physical size:\s*(\d+)x(\d+)/);
    const m = override ?? physical;
    if (!m) throw new Error(`could not parse wm size output: ${out}`);
    this.#screen = { width: Number(m[1]), height: Number(m[2]) };
    return this.#screen;
  }

  /** Tap at normalized (0–1) coordinates. */
  async tap(nx: number, ny: number): Promise<void> {
    const { width, height } = await this.screenSize();
    await this.shell([
      'input',
      'tap',
      String(Math.round(nx * width)),
      String(Math.round(ny * height)),
    ]);
  }

  async swipe(
    from: { x: number; y: number },
    to: { x: number; y: number },
    durationMs = 250
  ): Promise<void> {
    const { width, height } = await this.screenSize();
    await this.shell([
      'input',
      'swipe',
      String(Math.round(from.x * width)),
      String(Math.round(from.y * height)),
      String(Math.round(to.x * width)),
      String(Math.round(to.y * height)),
      String(durationMs),
    ]);
  }

  /** Type into the focused field. Loud-fails on characters `input text`
   * cannot deliver faithfully — never silently drops or mangles. */
  async typeText(value: string): Promise<void> {
    const escaped = escapeInputText(value);
    if (!escaped) return;
    await this.shell(['input', 'text', escaped]);
  }

  async keyevent(code: number | string): Promise<void> {
    await this.shell(['input', 'keyevent', String(code)]);
  }

  async screencapPng(): Promise<Uint8Array> {
    const bytes = await this.execOutBytes(['screencap', '-p']);
    if (bytes.length < 8) throw new Error('screencap returned no image data');
    return bytes;
  }

  /** One uiautomator dump. Retries the transient "could not get idle state"
   * (animations mid-flight); XML is extracted between the first `<?xml`/`<`
   * and the last `>` so the status trailer never leaks into the parser. */
  async uiautomatorDumpXml(attempts = 3): Promise<string> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(350);
      try {
        const out = new TextDecoder().decode(
          await this.execOutBytes(['uiautomator', 'dump', '/dev/tty'])
        );
        return extractUiautomatorXml(out);
      } catch (error) {
        lastError = error as Error;
        if (!/idle state|null root node/i.test(lastError.message)) throw lastError;
      }
    }
    throw lastError ?? new Error('uiautomator dump failed');
  }

  /** Real airplane mode. Resolves only after the device-side settings state
   * confirms the change — the orchestrator's finally backstop depends on
   * set() meaning "done", not "requested". */
  async setAirplaneMode(enabled: boolean): Promise<void> {
    await this.shell(['cmd', 'connectivity', 'airplane-mode', enabled ? 'enable' : 'disable']);
    const want = enabled ? '1' : '0';
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = (await this.shell(['settings', 'get', 'global', 'airplane_mode_on'])).trim();
      if (state === want) return;
      await sleep(250);
    }
    throw new Error(`airplane mode did not reach state ${want} within 5s`);
  }

  async pmGrant(permission: string): Promise<void> {
    await this.shell(['pm', 'grant', ANDROID_PACKAGE_ID, permission]);
  }

  async pmRevoke(permission: string): Promise<void> {
    await this.shell(['pm', 'revoke', ANDROID_PACKAGE_ID, permission]);
  }

  async pmClear(): Promise<void> {
    await this.shell(['pm', 'clear', ANDROID_PACKAGE_ID]);
  }

  async forceStop(): Promise<void> {
    await this.shell(['am', 'force-stop', ANDROID_PACKAGE_ID]);
  }

  async install(apkPath: string): Promise<void> {
    await this.raw(['install', '-r', apkPath]);
  }

  async uninstall(): Promise<void> {
    await this.raw(['uninstall', ANDROID_PACKAGE_ID], { allowFail: true });
  }

  /** Launch the app's main activity (monkey resolves the launcher intent
   * without hardcoding the activity class CNG generates). */
  async launchApp(): Promise<void> {
    await this.shell([
      'monkey',
      '-p',
      ANDROID_PACKAGE_ID,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]);
  }

  /** OS-level deep link (the `openUrl` step + dev-client bundle URL). The URL
   * is single-quoted for the device shell (URLs never contain `'` after the
   * schema's allowlist validation). */
  async openUrl(url: string): Promise<void> {
    if (url.includes("'")) throw new Error('refusing to open a URL containing a single quote');
    await this.shell([
      'am',
      'start',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      `'${url}'`,
      ANDROID_PACKAGE_ID,
    ]);
  }

  async getprop(name: string): Promise<string> {
    return (await this.shell(['getprop', name])).trim();
  }

  async bootCompleted(): Promise<boolean> {
    try {
      return (await this.getprop('sys.boot_completed')) === '1';
    } catch {
      return false;
    }
  }

  async reverse(port: number): Promise<void> {
    await this.raw(['reverse', `tcp:${port}`, `tcp:${port}`]);
  }

  async reverseRemoveAll(): Promise<void> {
    await this.raw(['reverse', '--remove-all'], { allowFail: true });
  }
}
