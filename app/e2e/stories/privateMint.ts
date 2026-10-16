/**
 * A mint of the run's own, for one simulator (ADR 0033): the local mint, behind
 * TLS, because the app accepts a mint only at an `https` address.
 *
 * The certificate is the run's own too. A small certificate authority is made
 * once and kept with the build artifacts; each simulator is told to trust it
 * (`simctl keychain add-root-cert`), which is all that makes the mint's address
 * acceptable to iOS. Nothing outside the simulators trusts it.
 *
 * With its own mint a wallet can be put back to any saved moment and spent
 * from again, because the mint is put back with it. Against a public mint it
 * cannot: the mint has already signed the wallet's later secrets (F146).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalMint } from './localMint';

const TLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../artifacts/cache/stories-tls');
/** The certificate a simulator is told to trust. */
export const AUTHORITY = join(TLS_DIR, 'ca.pem');

function openssl(...args: string[]): void {
  const made = spawnSync('openssl', args, { cwd: TLS_DIR, encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`openssl ${args[0]} failed: ${made.stderr}`);
}

/** Whether a certificate and its key are both there, with at least a month left. */
function stillGood(name: string): boolean {
  if (!existsSync(join(TLS_DIR, `${name}.pem`)) || !existsSync(join(TLS_DIR, `${name}.key`)))
    return false;
  const month = String(30 * 24 * 3600);
  return (
    spawnSync('openssl', ['x509', '-checkend', month, '-noout', '-in', `${name}.pem`], {
      cwd: TLS_DIR,
    }).status === 0
  );
}

/**
 * Make the authority and the mint's certificate for `localhost`, once, and
 * again when either is missing or within a month of running out.
 */
export function ensureCertificates(): void {
  if (existsSync(join(TLS_DIR, '../../stories-tls')))
    throw new Error('Run bun e2e/results/migrate.ts to preserve existing test certificates.');
  if (stillGood('ca') && stillGood('leaf')) return;
  mkdirSync(TLS_DIR, { recursive: true });
  openssl(
    ...['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem'],
    ...['-days', '825', '-subj', '/CN=Sovran end-to-end test authority'],
    ...['-addext', 'basicConstraints=critical,CA:TRUE'],
    ...['-addext', 'keyUsage=critical,keyCertSign,cRLSign']
  );
  openssl(
    ...['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr'],
    ...['-subj', '/CN=localhost']
  );
  writeFileSync(
    join(TLS_DIR, 'leaf.cnf'),
    'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\n'
  );
  // iOS refuses a server certificate valid for longer than 398 days.
  openssl(
    ...['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial'],
    ...['-out', 'leaf.pem', '-days', '397', '-extfile', 'leaf.cnf']
  );
}

/** A simulator has two mints of its own, so money can be moved between mints the run controls. */
const MINTS = ['a', 'b'] as const;

/** The addresses of a simulator's mints: its own ports, the same every time. */
export function privateMintAddresses(
  udid: string
): { url: string; port: number; tlsPort: number }[] {
  // Above the ports an invoice's mint is given (given.ts), below the ones macOS hands out.
  const slot = createHash('sha256').update(udid).digest().readUInt16BE(0) % 2000;
  return MINTS.map((_, index) => {
    const port = 40_000 + slot * 4 + index * 2;
    return { url: `https://localhost:${port + 1}`, port, tlsPort: port + 1 };
  });
}

/** Whether a wallet's state put back into `dir` came with mints to carry on from. */
export function holdsPrivateMints(dir: string): boolean {
  return MINTS.some((name) => existsSync(join(dir, name, 'cdk-mintd.sqlite')));
}

/**
 * End whatever still listens on a simulator's mint ports: a mint or its TLS
 * front left by a play that was killed before it could stop them. Left alone,
 * it would answer in place of the mint just put back, from a later moment.
 */
function endLeftOverMints(ports: number[]): void {
  for (const port of ports) {
    const listening = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
    });
    for (const pid of listening.stdout.split('\n').filter(Boolean)) {
      const name = spawnSync('ps', ['-o', 'comm=', '-p', pid], { encoding: 'utf8' }).stdout;
      if (/cdk-mintd|socat/.test(name)) spawnSync('kill', ['-9', pid]);
    }
  }
}

/** Resolves once something accepts a connection on `port`; rejects if `gone()` first, or after 5 s. */
async function listening(port: number, gone: () => string | undefined): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const why = gone();
    if (why) throw new Error(why);
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (open) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Nothing answered with TLS on port ${port} within 5 s.`);
}

async function startOne(
  dir: string,
  { url, port, tlsPort }: { url: string; port: number; tlsPort: number }
): Promise<() => void> {
  const mint = await startLocalMint(dir, port, { keep: true, publicUrl: url });
  const tls = spawn(
    'socat',
    [
      `OPENSSL-LISTEN:${tlsPort},bind=127.0.0.1,cert=${join(TLS_DIR, 'leaf.pem')},key=${join(TLS_DIR, 'leaf.key')},verify=0,fork,reuseaddr`,
      `TCP:127.0.0.1:${port}`,
    ],
    { stdio: 'ignore' }
  );
  let failed: string | undefined;
  tls.once('error', (error) => (failed = `socat could not be started: ${error.message}`));
  const stop = () => {
    tls.kill();
    mint.stop();
  };
  try {
    await listening(tlsPort, () =>
      tls.exitCode === null ? failed : `socat stopped as it started (port ${tlsPort}).`
    );
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/**
 * Start a simulator's mints, each from the database in its folder under `dir`
 * (empty when there is none), with TLS in front. The returned function stops
 * them. If either cannot start, neither is left running.
 */
export async function startPrivateMints(udid: string, dir: string): Promise<() => void> {
  ensureCertificates();
  const addresses = privateMintAddresses(udid);
  endLeftOverMints(addresses.flatMap(({ port, tlsPort }) => [port, tlsPort]));
  const started = await Promise.allSettled(
    addresses.map((address, index) => startOne(join(dir, MINTS[index]), address))
  );
  const stop = () => {
    for (const one of started) if (one.status === 'fulfilled') one.value();
  };
  const refused = started.find((one) => one.status === 'rejected');
  if (refused) {
    stop();
    throw refused.reason;
  }
  return stop;
}
