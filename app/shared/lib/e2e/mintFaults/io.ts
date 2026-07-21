/**
 * File IO for the mint-fault layer: polls the harness-written rules file
 * (`Documents/e2e/mint-faults.json`) for mid-scenario rule swaps — the env
 * channel is frozen per Metro session, so funded scenarios fund un-faulted
 * and then activate faults through this file — and flushes the intercepted-
 * request ledger (`Documents/e2e/mint-faults.ledger.json`) with the same
 * atomic tmp-write+move discipline as stateMirror. The flushed ledger echoes
 * the active revision, which is the harness's pickup ack.
 */
import { mintFaultEngine } from './engine';
import {
  MINT_FAULT_LEDGER_REL,
  MINT_FAULT_RULES_REL,
  parseMintFaultLedger,
  parseMintFaultRuleSet,
} from './rules';

type ExpoFileSystem = typeof import('expo-file-system');

const POLL_MS = 300;
const LEDGER_DEBOUNCE_MS = 250;

const RULES_REL_PARTS = MINT_FAULT_RULES_REL.split('/');
const LEDGER_REL_PARTS = MINT_FAULT_LEDGER_REL.split('/');

/** Start rule-file polling + ledger flushing. Returns a teardown. Callers
 * gate on isMintFaultInjectionEnabled(). */
export function startMintFaultIo(): () => void {
  let fs: ExpoFileSystem | null = null;
  let stopped = false;
  let lastRaw: string | null = null;
  let ledgerTimer: ReturnType<typeof setTimeout> | null = null;
  let ledgerDirty = false;

  const requireFs = (): ExpoFileSystem | null => {
    if (fs) return fs;
    try {
      fs = require('expo-file-system') as ExpoFileSystem;
    } catch {
      // Native module not ready yet — retried on the next poll tick.
      return null;
    }
    return fs;
  };

  const flushLedger = () => {
    ledgerTimer = null;
    if (stopped) return;
    const system = requireFs();
    if (!system) {
      ledgerDirty = true;
      return;
    }
    try {
      const dirParts = LEDGER_REL_PARTS.slice(0, -1);
      const fileName = LEDGER_REL_PARTS[LEDGER_REL_PARTS.length - 1]!;
      const dir = new system.Directory(system.Paths.document, ...dirParts);
      if (!dir.exists) dir.create({ idempotent: true, intermediates: true });
      const tmp = new system.File(dir, `${fileName}.tmp`);
      if (tmp.exists) tmp.delete();
      tmp.create();
      tmp.write(JSON.stringify(mintFaultEngine.snapshotLedger()));
      const target = new system.File(dir, fileName);
      if (target.exists) target.delete();
      tmp.moveSync(target);
      ledgerDirty = false;
    } catch {
      // Best-effort evidence — never let the ledger break the app under test.
      ledgerDirty = true;
    }
  };

  const scheduleLedgerFlush = () => {
    ledgerDirty = true;
    if (stopped || ledgerTimer !== null) return;
    ledgerTimer = setTimeout(flushLedger, LEDGER_DEBOUNCE_MS);
  };

  mintFaultEngine.setOnLedgerChange(scheduleLedgerFlush);

  // Ledger continuity across relaunches (goHome relaunches the app in e2e):
  // seed the fresh engine with the previous launch's entries so intercepted
  // proofs survive. Deferred until the fs module is available.
  let seeded = false;
  const seedFromPreviousLaunch = (system: ExpoFileSystem) => {
    if (seeded) return;
    seeded = true;
    try {
      const previous = new system.File(system.Paths.document, ...LEDGER_REL_PARTS);
      if (previous.exists) {
        mintFaultEngine.seedLedger(parseMintFaultLedger(previous.textSync()).entries);
      }
    } catch {
      // A torn/absent previous ledger just starts fresh.
    }
  };

  const pollRules = () => {
    if (stopped) return;
    const system = requireFs();
    if (system) {
      seedFromPreviousLaunch(system);
      try {
        const file = new system.File(system.Paths.document, ...RULES_REL_PARTS);
        if (file.exists) {
          const raw = file.textSync();
          if (raw !== lastRaw) {
            // A torn read straddling the harness's atomic rename fails parse
            // and is simply retried on the next tick.
            const set = parseMintFaultRuleSet(raw);
            lastRaw = raw;
            mintFaultEngine.loadRuleSet(set);
            // The revision echo is the harness's ack — flush immediately.
            if (ledgerTimer !== null) clearTimeout(ledgerTimer);
            flushLedger();
          }
        }
      } catch {
        // Unreadable/torn file — retried next tick.
      }
      if (ledgerDirty && ledgerTimer === null) scheduleLedgerFlush();
    }
    if (!stopped) setTimeout(pollRules, POLL_MS);
  };

  // Initial flush publishes the launch revision so the harness can ack even
  // before any rule swap or intercepted request.
  scheduleLedgerFlush();
  pollRules();

  return () => {
    stopped = true;
    if (ledgerTimer !== null) clearTimeout(ledgerTimer);
    ledgerTimer = null;
  };
}
