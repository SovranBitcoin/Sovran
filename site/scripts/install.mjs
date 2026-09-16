import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Bun discovers parent workspaces even from an excluded child. Install outside
// the checkout, then bring back only this package's generated dependency tree.
const site = fileURLToPath(new URL('../', import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), 'sovran-site-install-'));
try {
  await cp(join(site, 'package.json'), join(scratch, 'package.json'));
  const update = process.argv.includes('--update-lock');
  try { await cp(join(site, 'bun.lock'), join(scratch, 'bun.lock')); }
  catch (error) { if (!update || error.code !== 'ENOENT') throw error; }
  const installed = spawnSync('bun', ['install', '--ignore-scripts', ...(update ? [] : ['--frozen-lockfile'])], { cwd: scratch, stdio: 'inherit', env: { ...process.env, BUN_CONFIG_NO_CLEAR_TERMINAL: '1' } });
  if (installed.status !== 0) throw new Error('Isolated install failed');
  if (update) await cp(join(scratch, 'bun.lock'), join(site, 'bun.lock'));
  else if (!(await readFile(join(site, 'bun.lock'))).equals(await readFile(join(scratch, 'bun.lock')))) throw new Error('Frozen lock changed');
  await rm(join(site, 'node_modules'), { recursive: true, force: true });
  // cp works when the system temporary directory is on another volume.
  await cp(join(scratch, 'node_modules'), join(site, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  console.log('Installed site dependencies in isolation; no root install performed.');
} finally { await rm(scratch, { recursive: true, force: true }); }
