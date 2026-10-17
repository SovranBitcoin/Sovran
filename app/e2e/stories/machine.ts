/* eslint-disable no-console -- CLI boundary */
/**
 * What every checkout on this Mac shares: its disk, its memory and its
 * simulators. Several agents work in their own worktrees at once, and five
 * native runs started together once filled the disk and 27 GB of swap.
 *
 *   bun app/e2e/stories/machine.ts status            who holds the native lease, free disk, swap, devices
 *   bun app/e2e/stories/machine.ts reclaim [--yes]   list (or delete) what test runs left behind
 *
 * Native work (a build, a run of several stories, a bound run) takes one
 * lease for the whole Mac and waits its turn. It first checks the disk, so a
 * run fails at once with what to do instead of filling it halfway through.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statfsSync,
  writeSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { simctl } from './simctl';
import { STAMP_FILE } from './workers';

const LEASE =
  process.env.SOVRAN_NATIVE_LEASE ?? join(homedir(), '.local/state/sovran-native/lease.json');
/** Children of the holder run under its lease instead of waiting for it. */
const HELD = 'SOVRAN_NATIVE_LEASE_HELD';
/** A bundled iOS and Android build together want about this much room while they run. */
const NATIVE_MIN_FREE_GB = Number(process.env.SOVRAN_NATIVE_MIN_FREE_GB ?? 20);
const WAIT_MS = 5_000;

interface Holder {
  pid: number;
  what: string;
  checkout: string;
  since: string;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function holder(): Holder | undefined {
  try {
    const held = JSON.parse(readFileSync(LEASE, 'utf8')) as Holder;
    return alive(held.pid) ? held : undefined;
  } catch {
    return undefined;
  }
}

const freeGb = (path = tmpdir()) => {
  const stats = statfsSync(path);
  return (stats.bavail * stats.bsize) / 1024 ** 3;
};

/**
 * Take the Mac's native lease for `what`, waiting while another checkout holds
 * it, and give it back when this process ends. Fails at once when the disk is
 * too full to finish, naming what can be reclaimed.
 */
export async function holdNativeLease(what: string): Promise<void> {
  const inherited = Number(process.env[HELD]);
  if (inherited && holder()?.pid === inherited) return;
  const free = freeGb();
  if (free < NATIVE_MIN_FREE_GB)
    throw new Error(
      `${what} needs ${NATIVE_MIN_FREE_GB} GB free and this Mac has ${free.toFixed(1)} GB. ` +
        'See what test runs left behind with `bun app/e2e/stories/machine.ts reclaim`.'
    );
  mkdirSync(dirname(LEASE), { recursive: true });
  let told = false;
  for (;;) {
    const current = holder();
    if (!current) rmSync(LEASE, { force: true });
    try {
      const fd = openSync(LEASE, 'wx');
      const mine: Holder = {
        pid: process.pid,
        what,
        checkout: process.cwd(),
        since: new Date().toISOString(),
      };
      writeSync(fd, JSON.stringify(mine));
      closeSync(fd);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!told && current) {
      console.log(
        `waiting for the native lease: ${current.what} in ${current.checkout} (process ${current.pid}, since ${current.since})`
      );
      told = true;
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  }
  process.env[HELD] = String(process.pid);
  const release = () => {
    if (holder()?.pid === process.pid) rmSync(LEASE, { force: true });
  };
  // A process killed outright leaves the file, and the next taker sees its holder has gone.
  process.on('exit', release);
}

interface Device {
  name: string;
  udid: string;
  state: string;
  dataPath: string;
  isAvailable?: boolean;
}

const devices = (): Device[] =>
  Object.values(
    (JSON.parse(simctl('list', 'devices', '-j')) as { devices: Record<string, Device[]> }).devices
  ).flat();

/** A checkout's own simulator whose checkout has been removed. */
function orphaned(device: Device): boolean {
  if (!device.name.startsWith('sovran-e2e-')) return false;
  try {
    const { checkout } = JSON.parse(
      readFileSync(join(device.dataPath, '..', STAMP_FILE), 'utf8')
    ) as { checkout?: string };
    return Boolean(checkout) && !existsSync(checkout as string);
  } catch {
    return false;
  }
}

const sizeGb = (path: string) => {
  const out = spawnSync('du', ['-sk', path], { encoding: 'utf8' }).stdout.split('\t')[0];
  return Number(out) / 1024 ** 2;
};

/** What test runs leave behind that nothing uses: never a person's own simulator, build or history. */
function leftovers(): { label: string; gb: number; remove: () => void }[] {
  const found: { label: string; gb: number; remove: () => void }[] = [];
  for (const device of devices()) {
    // Ephemeral run simulators are deleted as their run ends; one still here outlived it.
    const ephemeral = device.name.startsWith('Sovran E2E ');
    const worker = /^sovran-e2e-.*worker-\d+$/.test(device.name);
    // Before each checkout had its own, every checkout shared this one.
    const shared = device.name === 'sovran-e2e-base';
    if ((ephemeral || worker || shared || orphaned(device)) && device.state === 'Shutdown')
      found.push({
        label: `simulator ${device.name}`,
        gb: sizeGb(join(device.dataPath, '..')),
        remove: () => simctl('delete', device.udid),
      });
  }
  if (devices().some((device) => device.isAvailable === false))
    found.push({
      label: 'simulators whose iOS is no longer installed',
      gb: 0,
      remove: () => simctl('delete', 'unavailable'),
    });
  const derived = join(homedir(), 'Library/Developer/Xcode/DerivedData');
  for (const name of existsSync(derived) ? readdirSync(derived) : []) {
    if (!name.startsWith('Sovran-')) continue;
    const info = join(derived, name, 'info.plist');
    let workspace = '';
    try {
      workspace = execFileSync('plutil', ['-extract', 'WorkspacePath', 'raw', info], {
        encoding: 'utf8',
      }).trim();
    } catch {
      // No record of its workspace.
    }
    if (workspace && existsSync(workspace)) continue;
    found.push({
      label: `Xcode build cache of a removed checkout (${workspace || name})`,
      gb: sizeGb(join(derived, name)),
      remove: () => rmSync(join(derived, name), { recursive: true, force: true }),
    });
  }
  // Android runs keep their emulator in a temporary folder of this name and remove it as they end.
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('sovran-e2e-android-avd-')) continue;
    const path = join(tmpdir(), name);
    found.push({
      label: `Android emulator left by a run (${name})`,
      gb: sizeGb(path),
      remove: () => rmSync(path, { recursive: true, force: true }),
    });
  }
  return found;
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'status') {
    const current = holder();
    console.log(
      current
        ? `native lease: ${current.what} in ${current.checkout} (process ${current.pid}, since ${current.since})`
        : 'native lease: free'
    );
    console.log(`free disk: ${freeGb().toFixed(1)} GB (native work needs ${NATIVE_MIN_FREE_GB})`);
    console.log(execFileSync('sysctl', ['-n', 'vm.swapusage'], { encoding: 'utf8' }).trim());
    for (const device of devices().filter((candidate) => candidate.state === 'Booted'))
      console.log(`booted: ${device.name} (${device.udid})`);
  } else if (command === 'reclaim') {
    if (holder()) {
      console.error('A native run holds the lease; reclaim once it has finished.');
      process.exit(1);
    }
    const found = leftovers();
    for (const item of found) console.log(`${item.gb.toFixed(1).padStart(6)} GB  ${item.label}`);
    const total = found.reduce((sum, item) => sum + item.gb, 0);
    if (!rest.includes('--yes')) {
      console.log(`${total.toFixed(1)} GB reclaimable; rerun with --yes to delete it`);
    } else {
      for (const item of found) item.remove();
      console.log(`deleted; ${freeGb().toFixed(1)} GB free`);
    }
  } else {
    console.error('Usage: bun app/e2e/stories/machine.ts status | reclaim [--yes]');
    process.exit(2);
  }
}
