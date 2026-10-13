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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalMint } from './localMint';

const TLS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../artifacts/stories-tls');
/** The certificate a simulator is told to trust. */
export const AUTHORITY = join(TLS_DIR, 'ca.pem');

function openssl(...args: string[]): void {
  const made = spawnSync('openssl', args, { cwd: TLS_DIR, encoding: 'utf8' });
  if (made.status !== 0) throw new Error(`openssl ${args[0]} failed: ${made.stderr}`);
}

/** Make the authority and the mint's certificate for `localhost`, once. */
export function ensureCertificates(): void {
  if (existsSync(AUTHORITY) && existsSync(join(TLS_DIR, 'leaf.pem'))) return;
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
 * Start a simulator's mints, each from the database in its folder under `dir`
 * (empty when there is none), with TLS in front. The returned function stops them.
 */
export async function startPrivateMints(udid: string, dir: string): Promise<() => void> {
  ensureCertificates();
  const stops = await Promise.all(
    privateMintAddresses(udid).map(async ({ url, port, tlsPort }, index) => {
      const mint = await startLocalMint(join(dir, MINTS[index]), port, {
        keep: true,
        publicUrl: url,
      });
      const tls = spawn(
        'socat',
        [
          `OPENSSL-LISTEN:${tlsPort},cert=${join(TLS_DIR, 'leaf.pem')},key=${join(TLS_DIR, 'leaf.key')},verify=0,fork,reuseaddr`,
          `TCP:127.0.0.1:${port}`,
        ],
        { stdio: 'ignore' }
      );
      return () => {
        tls.kill();
        mint.stop();
      };
    })
  );
  return () => {
    for (const stop of stops) stop();
  };
}
