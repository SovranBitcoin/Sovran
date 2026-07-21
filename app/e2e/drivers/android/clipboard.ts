/**
 * Host side of the Android e2e clipboard bridge. The emulator's
 * `cmd clipboard` shell command is unimplemented, so clipboard content is
 * exchanged with the app through files under its private `files/e2e/`
 * directory (reachable on the debuggable dev build via `run-as`), which the
 * in-app bridge (shared/lib/e2e/clipboard) reflects into the real system
 * clipboard and mirrors back.
 *
 *  - SET: write `clipboard-set.json` ({revision, text}) and poll
 *    `clipboard-ack.json` until the app echoes the revision.
 *  - GET: read `clipboard-get.json` ({text}), the app's live-clipboard mirror.
 */
import type { Adb } from './adb';
import { ANDROID_PACKAGE_ID } from './adb';
import { sleep } from '../simctl';

const SET_REL = 'files/e2e/clipboard-set.json';
const ACK_REL = 'files/e2e/clipboard-ack.json';
const GET_REL = 'files/e2e/clipboard-get.json';
const STATUS_REL = 'files/e2e/clipboard-io-status.json';

export class AndroidClipboardChannel {
  #adb: Adb;
  #revision = 0;

  constructor(adb: Adb) {
    this.#adb = adb;
  }

  /** Base64 through the device shell so arbitrary payloads (tokens, invoices,
   * newlines) survive intact; run-as cwd is the app's private data dir.
   *
   * The decode pipe lives ENTIRELY inside the run-as `-c` script rather than
   * being piped through run-as's stdin. `run-as` does not reliably forward the
   * caller's stdin into the sandboxed shell, so the old
   * `echo … | base64 -d | run-as … 'cat > file'` form intermittently wrote
   * nothing — the app's io loop then never saw a set file (heartbeat showed it
   * alive but stuck at lastAckedRevision -1). Keeping echo|base64 inside `-c`
   * needs no stdin forwarding. Each write is verified by reading it back, and
   * retried, so a silent write failure fails fast and loud instead of being
   * waited out as a phantom missing ack. */
  async #runAsWrite(rel: string, body: string): Promise<void> {
    const encoded = Buffer.from(body, 'utf8').toString('base64');
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    // Write BOTH to run-as's relative cwd (/data/data/<pkg>/…) AND to the app's
    // exact document path (/data/user/0/<pkg>/…). run-as reads alias fine — the
    // host sees the app's writes — but run-as WRITES to /data/data don't surface
    // in the running app's mount-namespace view of /data/user/0 (diagnosed via
    // the io heartbeat: setExists:false, e2eList missing the host-written file
    // even though run-as could read it back). Writing the absolute /data/user/0
    // path lands the file where the app's Paths.document actually reads.
    const absDir = `/data/user/0/${ANDROID_PACKAGE_ID}/${dir}`;
    const absRel = `/data/user/0/${ANDROID_PACKAGE_ID}/${rel}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      await this.#adb.shell([
        `run-as ${ANDROID_PACKAGE_ID} sh -c 'mkdir -p ${dir} ${absDir}; ` +
          `echo ${encoded} | base64 -d > ${rel}; echo ${encoded} | base64 -d > ${absRel}'`,
      ]);
      const back = await this.#runAsRead(rel);
      if (back !== null && back.trim() === body.trim()) return;
      await sleep(200);
    }
    const back = await this.#runAsRead(rel).catch(() => null);
    throw new Error(
      `android clipboard write to ${rel} could not be verified after 4 attempts; readback=${JSON.stringify(back)?.slice(0, 100)}`
    );
  }

  async #runAsRead(rel: string): Promise<string | null> {
    const out = await this.#adb.shell([
      `run-as ${ANDROID_PACKAGE_ID} sh -c 'cat ${rel} 2>/dev/null || true'`,
    ]);
    return out.trim() ? out : null;
  }

  /** Write the set file ONCE under a single stable revision, then poll for that
   * revision's ack for the whole budget. The app relaunches during
   * onboarding/funding (the process that runs onboarding is killed and a fresh
   * one boots ~10-15s later, observed pids 2417→6366), and only the
   * post-relaunch process acks. A single stable revision is what makes that
   * tolerable: the set file persists across the relaunch and the in-app loop is
   * revision-idempotent, so whichever process is alive re-acks the SAME
   * revision — no per-round revision bump (which would race the app acking rev
   * N while the host waits on rev N+1). 120s comfortably outlasts one relaunch
   * cycle. */
  async set(text: string, timeoutMs = 120000): Promise<void> {
    const revision = ++this.#revision;
    await this.#runAsWrite(SET_REL, JSON.stringify({ revision, text }));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const raw = await this.#runAsRead(ACK_REL);
      if (raw) {
        try {
          if ((JSON.parse(raw) as { revision?: number }).revision === revision) return;
        } catch {
          // torn read straddling the app's atomic write — retry
        }
      }
      await sleep(250);
    }
    // Surface the in-app io loop's heartbeat so the failure says whether the
    // loop was alive (tick advancing), what it last acked, and its last error —
    // rather than an opaque "not acked".
    const status = (await this.#runAsRead(STATUS_REL).catch(() => null)) ?? '<no heartbeat file>';
    throw new Error(
      `android clipboard set was not acked within ${timeoutMs}ms; io heartbeat: ${status.trim()}`
    );
  }

  async get(timeoutMs = 5000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const raw = await this.#runAsRead(GET_REL);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { text?: string };
          if (typeof parsed.text === 'string') return parsed.text;
        } catch {
          // torn read — retry
        }
      }
      await sleep(250);
    }
    throw new Error(`android clipboard mirror was unreadable within ${timeoutMs}ms`);
  }
}
