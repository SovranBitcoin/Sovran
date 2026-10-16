/**
 * A private mint for one worker (ADR 0033): `cdk-mintd` with its pretend
 * Lightning backend, on this machine. An invoice it issues is marked paid by
 * itself within a tenth of a second, so a story about money waits on nothing
 * outside the Mac and no worker can disturb another's balance.
 *
 * It holds no real funds. Its seed is fixed and public, which is the point:
 * the same story sees the same keysets on every run.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Not a wallet anyone holds: the BIP39 test vector for all-zero entropy. */
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MNEMONIC_VARIABLE = 'SOVRAN_E2E_MINT_MNEMONIC';

function mintConfig(port: number, instance: string, publicUrl: string): string {
  return `[info]
url = "${publicUrl}/"
listen_host = "127.0.0.1"
listen_port = ${port}
mnemonic = "env:${MNEMONIC_VARIABLE}"

[mint_info]
name = "Sovran end-to-end test mint"
description = "Local, pretend Lightning. Holds nothing. ${instance}"

[database]
engine = "sqlite"

[payment_backend]
backend = "fakewallet"

[fake_wallet]
supported_units = ["sat"]
fee_percent = 0.0
reserve_fee_min = 0
min_delay_time = 0
max_delay_time = 0
`;
}

interface LocalMint {
  url: string;
  stop(): void;
}

const DATABASE = 'cdk-mintd.sqlite';

/**
 * Start a mint that listens on `port` and keeps its database in `dir`.
 * Resolves once the mint answers.
 *
 * `keep`: carry on from the database already in `dir`, when there is one,
 * instead of starting empty. That is how a mint is put back to the moment a
 * wallet's saved state was taken: its folder is copied back, and it is started
 * from it. `publicUrl` is the address the mint tells wallets it has, when that
 * is not the one it listens on.
 */
export async function startLocalMint(
  dir: string,
  port: number,
  options: { keep?: boolean; publicUrl?: string } = {}
): Promise<LocalMint> {
  const url = `http://127.0.0.1:${port}`;
  const env = { ...process.env, [MNEMONIC_VARIABLE]: TEST_MNEMONIC };
  const carryOn = options.keep === true && existsSync(join(dir, DATABASE));
  // Another process may already answer on this port; only this instance's answer counts.
  const instance = randomUUID();
  if (!carryOn) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const config = join(dir, 'mint.toml');
    writeFileSync(config, mintConfig(port, instance, options.publicUrl ?? url));
    const init = spawnSync('cdk-mintd', ['-w', dir, 'config', 'init', '--file', config], {
      env,
      encoding: 'utf8',
    });
    if (init.status !== 0) {
      throw new Error(`The local mint refused its settings: ${init.stderr || init.stdout}`);
    }
  }
  const mint = spawn('cdk-mintd', ['-w', dir], { env, stdio: 'ignore' });
  const stop = () => {
    mint.kill();
  };
  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (mint.exitCode !== null) throw new Error(`The local mint stopped as it started (${url}).`);
    // eslint-disable-next-line no-restricted-globals -- the runner's own mint on loopback, outside the app
    const answered = await fetch(`${url}/v1/info`, { signal: AbortSignal.timeout(500) })
      .then((response) => response.json() as Promise<{ description?: string }>)
      .catch(() => null); // Not listening yet.
    // A mint carried on from a saved folder has the name it was first given.
    if (answered && (carryOn || answered.description?.includes(instance))) return { url, stop };
    if (answered) {
      stop();
      throw new Error(`Something else is already the local mint at ${url}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  stop();
  throw new Error(`The local mint did not answer at ${url} within 10 s.`);
}
