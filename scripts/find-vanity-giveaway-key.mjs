#!/usr/bin/env node
/**
 * Brute-force a VANITY giveaway P2PK keypair whose npub starts with a chosen
 * prefix (default `npub1s0vran`).
 *
 * The output is drop-in for the same slots as gen-giveaway-key.mjs: the SECRET
 * (nsec / hex) goes into GIVEAWAY_P2PK_SECRET, the PUBLIC key/npub is what you
 * lock giveaway tokens to. See gen-giveaway-key.mjs for the security caveats —
 * a vanity key is no more secret than a random one.
 *
 * Why `s0vran` and not `sovran`: an npub is `npub1` + bech32, and the bech32
 * alphabet has no `b`, `i`, `o`, or `1`. The `o` in "sovran" is impossible, so
 * we use the conventional `o -> 0` (zero) substitution.
 *
 * HOW IT'S FAST:
 *   - Spawns one worker per core (minus one). Each worker walks the curve by
 *     repeatedly ADDING the generator G (cheap) instead of doing a full
 *     scalar-multiply per candidate.
 *   - In the hot loop it never runs full bech32+checksum. The first N npub
 *     characters depend only on the first ceil(N*5/8) bytes of the x-only
 *     pubkey, so we compare just those 5-bit groups against the target.
 *
 *   ~28k keys/sec/thread. A 6-char target (`s0vran`) averages ~32^6 ≈ 1.07B
 *   attempts → roughly tens of minutes on a many-core machine. Shorter prefixes
 *   are exponentially faster (each dropped char ≈ 32x less work).
 *
 * Usage:
 *   node scripts/find-vanity-giveaway-key.mjs            # target s0vran
 *   node scripts/find-vanity-giveaway-key.mjs s0vr       # shorter == faster
 *   node scripts/find-vanity-giveaway-key.mjs s0vran --threads 8
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { webcrypto } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';

const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const N = secp256k1.Point.Fn.ORDER; // group order
const G = secp256k1.Point.BASE;

/** Map a vanity prefix string to its bech32 5-bit values (throws if invalid). */
function targetToValues(prefix) {
  return [...prefix].map((ch) => {
    const v = BECH32.indexOf(ch);
    if (v < 0)
      throw new Error(
        `'${ch}' is not a bech32 char — an npub cannot contain b, i, o, or 1 (try o->0)`
      );
    return v;
  });
}

// ---------------------------------------------------------------------------
// Worker: walk the curve, match the npub prefix on the x-only pubkey.
// ---------------------------------------------------------------------------
if (!isMainThread) runWorker();

function runWorker() {
  const target = workerData.target; // array of 5-bit values, length <= 6
  const len = target.length;
  const t0 = target[0],
    t1 = target[1],
    t2 = target[2],
    t3 = target[3],
    t4 = target[4],
    t5 = target[5];

  // Random 32-byte start scalar in [1, n).
  const rnd = new Uint8Array(32);
  webcrypto.getRandomValues(rnd);
  let k = BigInt('0x' + Buffer.from(rnd).toString('hex')) % N;
  if (k === 0n) k = 1n;

  let pt = G.multiply(k);
  let i = 0; // offset from k; priv = (k + i) mod n
  const REPORT = 8192;

  for (;;) {
    // Compressed pubkey: byte 0 is 02/03, bytes 1..32 are the x-only key.
    // The first npub chars come from x-only bytes, i.e. b[1..4] here.
    const b = pt.toBytes(true);
    // Decode just enough 5-bit groups (up to 6) and compare, short-circuiting.
    if ((b[1] >>> 3) === t0) {
      if (len === 1) return found();
      if ((((b[1] & 7) << 2) | (b[2] >>> 6)) === t1) {
        if (len === 2) return found();
        if (((b[2] >>> 1) & 31) === t2) {
          if (len === 3) return found();
          if ((((b[2] & 1) << 4) | (b[3] >>> 4)) === t3) {
            if (len === 4) return found();
            if ((((b[3] & 15) << 1) | (b[4] >>> 7)) === t4) {
              if (len === 5) return found();
              if (((b[4] >>> 2) & 31) === t5) return found();
            }
          }
        }
      }
    }

    pt = pt.add(G);
    i++;
    if ((i & (REPORT - 1)) === 0) parentPort.postMessage({ tried: REPORT });
  }

  function found() {
    const priv = (k + BigInt(i)) % N;
    parentPort.postMessage({ privHex: priv.toString(16).padStart(64, '0') });
    // returning leaves the worker idle until the main thread terminates it
  }
}

// ---------------------------------------------------------------------------
// Main thread: spawn workers, report rate/ETA, print the found key.
// ---------------------------------------------------------------------------
if (isMainThread) {
  const argv = process.argv.slice(2);
  const tIdx = argv.indexOf('--threads');
  const threads =
    tIdx >= 0 ? Number(argv[tIdx + 1]) : Math.max(1, os.cpus().length - 1);
  const prefix = (argv.find((a) => !a.startsWith('--') && a !== String(threads)) || 's0vran').toLowerCase();

  let target;
  try {
    target = targetToValues(prefix);
  } catch (e) {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  }

  const expected = Math.pow(32, target.length); // avg attempts
  console.error(
    `\n  Searching for npub1${prefix}…  (${threads} threads, ~${expected.toExponential(2)} avg attempts)\n`
  );

  const workers = [];
  let tried = 0;
  const start = process.hrtime.bigint();

  for (let w = 0; w < threads; w++) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { target } });
    worker.on('message', (msg) => {
      if (msg.tried) tried += msg.tried;
      else if (msg.privHex) finish(msg.privHex);
    });
    worker.on('error', (err) => {
      console.error(err);
      process.exit(1);
    });
    workers.push(worker);
  }

  const ticker = setInterval(() => {
    const sec = Number(process.hrtime.bigint() - start) / 1e9;
    const rate = tried / sec;
    const eta = rate > 0 ? (expected - tried) / rate : Infinity;
    process.stderr.write(
      `\r  tried ${(tried / 1e6).toFixed(1)}M  ·  ${(rate / 1000).toFixed(0)}k/s  ·  ETA ~${fmt(eta)}   `
    );
  }, 1000);

  async function finish(privHex) {
    clearInterval(ticker);
    await Promise.all(workers.map((w) => w.terminate()));

    // Re-derive everything with nostr-tools and assert the prefix really matches.
    const { getPublicKey, nip19 } = await import('nostr-tools');
    const sk = Uint8Array.from(Buffer.from(privHex, 'hex'));
    const pkHex = getPublicKey(sk); // x-only (nostr pubkey), 64 hex
    const npub = nip19.npubEncode(pkHex);
    const nsec = nip19.nsecEncode(sk);
    const p2pk = Buffer.from(secp256k1.getPublicKey(sk, true)).toString('hex'); // compressed 02/03

    if (!npub.startsWith(`npub1${prefix}`)) {
      console.error(`\n  BUG: derived ${npub} does not start with npub1${prefix}\n`);
      process.exit(1);
    }

    const elapsed = Number(process.hrtime.bigint() - start) / 1e9;
    process.stdout.write(
      [
        '',
        `\n  Found npub1${prefix} in ${fmt(elapsed)} (~${(tried / 1e6).toFixed(1)}M tries).`,
        '',
        '  SECRET — add to .env (gitignored) and EAS, never commit:',
        '',
        `    nsec:        ${nsec}`,
        `    private key: ${privHex}`,
        '',
        '  PUBLIC — lock giveaway tokens to this (safe to publish):',
        '',
        `    npub:        ${npub}`,
        `    pubkey:      ${pkHex}    # x-only, the GIVEAWAY_P2PK pubkey`,
        `    p2pk pubkey: ${p2pk}  # compressed 02/03 form`,
        '',
        '',
      ].join('\n')
    );
    process.exit(0);
  }
}

function fmt(sec) {
  if (!isFinite(sec)) return '∞';
  if (sec < 90) return `${Math.round(sec)}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
