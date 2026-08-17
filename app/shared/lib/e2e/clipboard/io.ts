/**
 * Android e2e clipboard bridge IO. Mirrors the mint-fault file channel
 * (expo-file-system polling under Documents/e2e, atomic tmp-write+move,
 * revision ack):
 *
 *  - SET: poll `clipboard-set.json` ({revision, text}); on a new revision push
 *    the text into the real system clipboard and echo `clipboard-ack.json`
 *    ({revision}) so the harness knows it landed.
 *  - GET: mirror the current system clipboard to `clipboard-get.json`
 *    ({text}) every tick so the harness can read what the app copied.
 *
 * Foreground-only: Android restricts background clipboard reads, but the app
 * under test is always foregrounded during e2e.
 */
import {
  CLIPBOARD_ACK_REL,
  CLIPBOARD_GET_REL,
  CLIPBOARD_SET_REL,
  CLIPBOARD_STATUS_REL,
} from './enabled';

type ExpoFileSystem = typeof import('expo-file-system');
type ExpoClipboard = typeof import('expo-clipboard');

const POLL_MS = 300;
const CLIPBOARD_OP_TIMEOUT_MS = 2000;
const SET_PARTS = CLIPBOARD_SET_REL.split('/');
const ACK_PARTS = CLIPBOARD_ACK_REL.split('/');
const GET_PARTS = CLIPBOARD_GET_REL.split('/');
const STATUS_PARTS = CLIPBOARD_STATUS_REL.split('/');
const STATUS_EVERY_TICKS = 10; // ~3s heartbeat at POLL_MS=300

/** Android's clipboard get/set can hang indefinitely when the app briefly
 * lacks input focus (Android 10+ restriction). One hung call under the io
 * loop's busy flag would wedge the whole bridge — including SET acks — so
 * every clipboard op races a timeout and a stall just retries next tick. */
function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('clipboard op timed out')), CLIPBOARD_OP_TIMEOUT_MS)
    ),
  ]);
}

/** Start the clipboard bridge poll loop. Returns a teardown. Callers gate on
 * isE2EClipboardBridgeEnabled(). */
export function startE2EClipboardIo(): () => void {
  let fs: ExpoFileSystem | null = null;
  let clip: ExpoClipboard | null = null;
  let stopped = false;
  // Revision-keyed, not string-keyed: only advances once BOTH the clipboard
  // write and the ack write for that revision have succeeded, so a transient
  // failure (or an io loop that restarted with this reset to -1 while the set
  // file's revision is unchanged) simply re-acks next tick. That self-healing
  // is what makes the host's per-revision retries land even when the app
  // relaunches mid-setup.
  let lastAckedRevision = -1;
  let lastMirrored: string | null = null;
  let busy = false;
  let tickCount = 0;
  let lastError = '';
  let diagSetExists = false;

  const requireModules = (): { fs: ExpoFileSystem; clip: ExpoClipboard } | null => {
    if (!fs) {
      try {
        fs = require('expo-file-system') as ExpoFileSystem;
      } catch {
        return null;
      }
    }
    if (!clip) {
      try {
        clip = require('expo-clipboard') as ExpoClipboard;
      } catch {
        return null;
      }
    }
    return { fs, clip };
  };

  const writeAtomic = (system: ExpoFileSystem, parts: string[], body: string) => {
    const dirParts = parts.slice(0, -1);
    const fileName = parts[parts.length - 1]!;
    const dir = new system.Directory(system.Paths.document, ...dirParts);
    if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
    const tmp = new system.File(dir, `${fileName}.tmp`);
    if (tmp.exists) tmp.delete();
    tmp.create();
    tmp.write(body);
    const target = new system.File(dir, fileName);
    if (target.exists) target.delete();
    tmp.moveSync(target);
  };

  const tick = async () => {
    if (stopped || busy) {
      if (!stopped) setTimeout(tick, POLL_MS);
      return;
    }
    busy = true;
    const modules = requireModules();
    if (modules) {
      const { fs: system, clip: clipboard } = modules;
      // SET: the harness wrote a new clipboard value. Keyed on the revision so
      // this is idempotent and self-healing — it keeps re-acking the current
      // revision every tick until BOTH writes below succeed.
      try {
        const setFile = new system.File(system.Paths.document, ...SET_PARTS);
        diagSetExists = setFile.exists;
        if (setFile.exists) {
          const raw = setFile.textSync();
          // A torn read straddling the harness's atomic rename fails parse and
          // is retried next tick.
          const parsed = JSON.parse(raw) as { revision: number; text: string };
          if (
            typeof parsed.revision === 'number' &&
            typeof parsed.text === 'string' &&
            parsed.revision !== lastAckedRevision
          ) {
            await withTimeout(clipboard.setStringAsync(parsed.text));
            // Do NOT touch lastMirrored here: the GET branch below must still
            // observe the clipboard changed and publish it to the mirror file,
            // otherwise a host that immediately reads back its own SET sees the
            // stale pre-SET mirror value.
            writeAtomic(system, ACK_PARTS, JSON.stringify({ revision: parsed.revision }));
            // Advance ONLY after both writes land, so any throw above leaves
            // the revision un-acked and the next tick retries it.
            lastAckedRevision = parsed.revision;
          }
        }
      } catch (error) {
        // Unreadable/torn file or clipboard error — retried next tick.
        lastError = String(error).slice(0, 120);
      }
      // Liveness heartbeat so a host-side set() timeout is self-diagnosing:
      // `tick` advancing proves the loop is alive; `setExists` distinguishes a
      // set file the app never sees (host wrote it into an isolated mount
      // namespace after a relaunch) from one it saw but failed to ack.
      if (tickCount % STATUS_EVERY_TICKS === 0) {
        try {
          writeAtomic(
            system,
            STATUS_PARTS,
            JSON.stringify({
              tick: tickCount,
              lastAckedRevision,
              lastError,
              setExists: diagSetExists,
            })
          );
        } catch {
          // Best-effort; never let the heartbeat break the loop.
        }
      }
      tickCount += 1;
      // GET: mirror the live system clipboard so the harness can read copies.
      try {
        const current = await withTimeout(clipboard.getStringAsync());
        if (current !== lastMirrored) {
          lastMirrored = current;
          writeAtomic(system, GET_PARTS, JSON.stringify({ text: current }));
        }
      } catch {
        // Clipboard read can transiently fail — retried next tick.
      }
    }
    busy = false;
    if (!stopped) setTimeout(tick, POLL_MS);
  };

  // Fire-and-forget: `tick` re-schedules itself and swallows its own errors, so
  // there is no result to await and nothing for a caller to catch.
  void tick();

  return () => {
    stopped = true;
  };
}
