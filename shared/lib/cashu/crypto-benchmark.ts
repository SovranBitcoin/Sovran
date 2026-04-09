/**
 * Comprehensive benchmark for cashu-ts crypto operations on React Native.
 *
 * Uses the real sovran-app derivation chain:
 *   mnemonic → PBKDF2 → HDKey → cashu mnemonic → PBKDF2 → wallet seed → NUT-13 derivation
 *
 * Reads detailed per-call timing from the `globalThis.__CASHU_PERF` accumulator
 * injected by the cashu-ts patch.
 *
 * Usage in app:
 *   import { runCryptoBenchmark } from '@/shared/lib/cashu/crypto-benchmark';
 *   const report = await runCryptoBenchmark();
 *   console.log(report.report);
 *   // Or dump raw perf log:
 *   console.log(JSON.stringify(report.perfLog, null, 2));
 */

import {
  deriveSecret,
  deriveBlindingFactor,
  OutputData,
} from '@cashu/cashu-ts';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
  deriveCashuMnemonic,
  deriveCashuWalletSeed,
  deriveCashuWalletSeedFromRoot,
  deriveNostrKeys,
} from '@/shared/lib/nostr/keyDerivation';
import { cashuLog } from '@/shared/lib/logger';

// The test mnemonic for benchmarking (not a real wallet!)
const TEST_MNEMONIC =
  'cute clutch where initial orphan arena fashion silk minute endless middle own';

// Keyset IDs for testing both legacy and modern paths
const LEGACY_KEYSET_ID = '009a1f293253e41e';
const MODERN_KEYSET_ID = '01a2b3c4d5e6f708';

// Minimal keyset keys for OutputData.createDeterministicData
const MOCK_KEYSET_KEYS: Record<string, string> = {
  '1': '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  '2': '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  '4': '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
  '8': '02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13',
};

// ─── Perf accumulator access ────────────────────────────────────────────────

declare global {
  var __CASHU_PERF:
    | {
        enabled: boolean;
        log: Array<Record<string, unknown>>;
        enable(): void;
        disable(): void;
        dump(): Array<Record<string, unknown>>;
        summary(): Record<string, { count: number; totalMs: number; min: number; max: number }>;
        report(): string;
      }
    | undefined;
}

function enablePerf() {
  globalThis.__CASHU_PERF?.enable();
}
function disablePerf() {
  globalThis.__CASHU_PERF?.disable();
}
function getPerfLog() {
  return globalThis.__CASHU_PERF?.dump() ?? [];
}
function getPerfSummary() {
  return globalThis.__CASHU_PERF?.summary() ?? {};
}
function getPerfReport() {
  return globalThis.__CASHU_PERF?.report() ?? '(perf not available)';
}

// ─── Benchmark helpers ──────────────────────────────────────────────────────

interface StepResult {
  name: string;
  ms: number;
  detail?: string;
}

function timed(name: string, fn: () => void): StepResult {
  const t0 = performance.now();
  fn();
  return { name, ms: performance.now() - t0 };
}

function timedN(name: string, n: number, fn: () => void): StepResult {
  // warmup
  for (let i = 0; i < Math.min(2, n); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn();
  const total = performance.now() - t0;
  return { name, ms: total, detail: `${n} iterations, ${(total / n).toFixed(2)} ms/op` };
}

// ─── Main benchmark ─────────────────────────────────────────────────────────

export interface BenchmarkReport {
  steps: StepResult[];
  perfLog: Array<Record<string, unknown>>;
  perfSummary: Record<string, { count: number; totalMs: number; min: number; max: number }>;
  report: string;
}

export function runCryptoBenchmark(iterations = 50): BenchmarkReport {
  const span = cashuLog.startSpan('crypto_benchmark', { iterations, mnemonic: 'test' });
  const steps: StepResult[] = [];

  // ── Phase 1: Derivation chain (mnemonic → seed) ──────────────────────────

  cashuLog.info('crypto_benchmark.phase1_derivation_chain');

  // Step 1: Nostr key derivation
  steps.push(
    timed('deriveNostrKeys (NIP-06)', () => {
      deriveNostrKeys(TEST_MNEMONIC, 0);
    }),
  );

  // Step 2: Cashu mnemonic derivation
  let cashuMnemonic = '';
  steps.push(
    timed('deriveCashuMnemonic (HDKey)', () => {
      cashuMnemonic = deriveCashuMnemonic(TEST_MNEMONIC, 0);
    }),
  );

  // Step 3: Cashu wallet seed (PBKDF2)
  let walletSeed: Uint8Array = new Uint8Array(0);
  steps.push(
    timed('deriveCashuWalletSeed (PBKDF2)', () => {
      walletSeed = deriveCashuWalletSeed(cashuMnemonic);
    }),
  );

  // Step 4: Full chain
  steps.push(
    timed('deriveCashuWalletSeedFromRoot (full chain)', () => {
      deriveCashuWalletSeedFromRoot(TEST_MNEMONIC, 0);
    }),
  );

  cashuLog.info('crypto_benchmark.phase1_complete', {
    cashuMnemonic: cashuMnemonic.split(' ').slice(0, 3).join(' ') + '...',
    seedHex: bytesToHex(walletSeed).slice(0, 16) + '...',
  });

  // ── Phase 2: NUT-13 individual operations ────────────────────────────────

  cashuLog.info('crypto_benchmark.phase2_nut13_ops');
  enablePerf();

  steps.push(
    timedN('deriveSecret (legacy 00)', iterations, () => {
      deriveSecret(walletSeed, LEGACY_KEYSET_ID, 0);
    }),
  );

  steps.push(
    timedN('deriveBlindingFactor (legacy 00)', iterations, () => {
      deriveBlindingFactor(walletSeed, LEGACY_KEYSET_ID, 0);
    }),
  );

  steps.push(
    timedN('deriveSecret (modern 01)', iterations, () => {
      deriveSecret(walletSeed, MODERN_KEYSET_ID, 0);
    }),
  );

  steps.push(
    timedN('deriveBlindingFactor (modern 01)', iterations, () => {
      deriveBlindingFactor(walletSeed, MODERN_KEYSET_ID, 0);
    }),
  );

  // ── Phase 3: Full output generation ──────────────────────────────────────

  cashuLog.info('crypto_benchmark.phase3_output_gen');

  // Single output
  steps.push(
    timedN('createSingleDeterministicData (legacy)', iterations, () => {
      OutputData.createSingleDeterministicData(1, walletSeed, 0, LEGACY_KEYSET_ID);
    }),
  );

  steps.push(
    timedN('createSingleDeterministicData (modern)', iterations, () => {
      OutputData.createSingleDeterministicData(1, walletSeed, 0, MODERN_KEYSET_ID);
    }),
  );

  // Batch of 10 (simulating restore)
  const batchN = Math.max(1, Math.floor(iterations / 10));
  steps.push(
    timedN('createDeterministicData x10 (legacy)', batchN, () => {
      const keyset = { id: LEGACY_KEYSET_ID, keys: MOCK_KEYSET_KEYS };
      OutputData.createDeterministicData(0, walletSeed, 0, keyset, Array(10).fill(0));
    }),
  );

  steps.push(
    timedN('createDeterministicData x10 (modern)', batchN, () => {
      const keyset = { id: MODERN_KEYSET_ID, keys: MOCK_KEYSET_KEYS };
      OutputData.createDeterministicData(0, walletSeed, 0, keyset, Array(10).fill(0));
    }),
  );

  // Batch of 50 (realistic restore chunk)
  steps.push(
    timed('createDeterministicData x50 (legacy)', () => {
      const keyset = { id: LEGACY_KEYSET_ID, keys: MOCK_KEYSET_KEYS };
      OutputData.createDeterministicData(0, walletSeed, 0, keyset, Array(50).fill(0));
    }),
  );

  // Incrementing counters (tests cache behavior)
  let ctr = 0;
  steps.push(
    timedN('deriveSecret (legacy, incr counter)', iterations, () => {
      deriveSecret(walletSeed, LEGACY_KEYSET_ID, ctr++);
    }),
  );

  disablePerf();

  // ── Build report ──────────────────────────────────────────────────────────

  const perfLog = getPerfLog();
  const perfSummary = getPerfSummary();
  const perfReport = getPerfReport();

  const lines = [
    '╔══════════════════════════════════════════════════════════════════╗',
    '║           Cashu-TS Crypto Benchmark Report                     ║',
    '╚══════════════════════════════════════════════════════════════════╝',
    '',
    `Mnemonic: ${TEST_MNEMONIC.split(' ').slice(0, 4).join(' ')}...`,
    `Seed: ${bytesToHex(walletSeed).slice(0, 24)}...`,
    `Platform: React Native / Hermes`,
    `Date: ${new Date().toISOString()}`,
    '',
    '── Step Timings ──────────────────────────────────────────────────',
    '',
    padRow('Operation', 'Time (ms)', 'Detail'),
    '─'.repeat(80),
  ];

  for (const step of steps) {
    lines.push(padRow(step.name, step.ms.toFixed(1), step.detail ?? ''));
  }

  // Legacy vs Modern comparison
  const legDerive = steps.find((s) => s.name.includes('deriveSecret (legacy 00)'));
  const modDerive = steps.find((s) => s.name.includes('deriveSecret (modern 01)'));
  if (legDerive && modDerive && modDerive.ms > 0) {
    lines.push('');
    lines.push(`Legacy/Modern derive ratio: ${(legDerive.ms / modDerive.ms).toFixed(1)}x`);
  }

  // Recovery estimates
  const legBatch50 = steps.find((s) => s.name.includes('x50 (legacy)'));
  if (legBatch50) {
    const perOutput = legBatch50.ms / 50;
    lines.push('');
    lines.push('── Recovery Time Estimates (legacy keyset) ────────────────────');
    lines.push(`  Per output:         ~${perOutput.toFixed(1)} ms`);
    lines.push(`  100 outputs:        ~${((perOutput * 100) / 1000).toFixed(1)} s`);
    lines.push(`  300 outputs (batch): ~${((perOutput * 300) / 1000).toFixed(1)} s`);
    lines.push(`  600 outputs:        ~${((perOutput * 600) / 1000).toFixed(1)} s`);
  }

  // Per-function breakdown from __CASHU_PERF
  lines.push('');
  lines.push('── Per-Function Breakdown (from __CASHU_PERF) ──────────────────');
  lines.push('');
  lines.push(perfReport);

  // Detailed log sample (first 20 entries)
  lines.push('');
  lines.push('── Sample Perf Log (first 20 entries) ─────────────────────────');
  const sample = perfLog.slice(0, 20);
  for (const entry of sample) {
    const { op, ms, _seq, _t, ...rest } = entry as Record<string, any>;
    const extras = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
    lines.push(`  [${_seq}] ${op}: ${typeof ms === 'number' ? ms.toFixed(2) : '?'}ms${extras}`);
  }
  if (perfLog.length > 20) {
    lines.push(`  ... and ${perfLog.length - 20} more entries`);
  }

  const report = lines.join('\n');

  cashuLog.info('crypto_benchmark.complete', {
    totalSteps: steps.length,
    perfLogEntries: perfLog.length,
  });
  span.end({ totalSteps: steps.length });

  return { steps, perfLog, perfSummary, report };
}

function padRow(col1: string, col2: string, col3: string): string {
  return `  ${col1.padEnd(42)} ${col2.padStart(10)} ${col3}`;
}
