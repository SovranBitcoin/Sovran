import { appendFileSync } from 'node:fs';
import { config, check, diagnostic, GitHub, Ledger, required, ReleaseError, HttpError } from './core.mjs';
import { prepare } from './prepare.mjs';
import { build } from './build.mjs';
import { appleRelease } from './apple.mjs';
import { androidRelease } from './android.mjs';
import { hostApple } from './hosting.mjs';
import { freedomRelease } from './freedom.mjs';
import { githubRelease, zapstoreRelease } from './publish.mjs';
import { websiteRelease } from './site.mjs';

const stages = { build, apple: appleRelease, android: androidRelease, assets: hostApple, freedom: freedomRelease, github: githubRelease, zapstore: zapstoreRelease, website: websiteRelease };
const stage = process.argv[2];
try {
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === config.repository && process.env.GITHUB_REF === 'refs/heads/main', 'Release commands only run in the owned main-branch GitHub workflow');
  const gh = new GitHub(required('GH_TOKEN'));
  if (stage === 'prepare') await prepare(gh);
  else {
    check(process.env.RELEASE_ENABLED === 'true' && Object.hasOwn(stages, stage), 'Release execution disabled or invalid stage');
    const ledger = new Ledger(gh); await ledger.load();
    check(ledger.state && ledger.state.sourceSha === required('RELEASE_SHA'), 'Release state/checkout mismatch');
    await stages[stage](ledger);
    if (process.env.GITHUB_STEP_SUMMARY) {
      const lines = [`### Sovran ${ledger.state.version}: ${stage}`, '', '| Channel | Confirmed version |', '| --- | --- |'];
      for (const name of ['appStore', 'freedomStore', 'googlePlay', 'githubApk', 'zapstore']) lines.push(`| ${name} | ${ledger.state.channels[name]?.version ?? 'Not yet confirmed'} |`);
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
    }
  }
} catch (error) {
  // Only our fixed diagnostics; native/provider exceptions can disclose secrets.
  const message = String(error?.message ?? '');
  const safe = (error instanceof ReleaseError || error instanceof HttpError) && /^[A-Za-z0-9 .:;()/_-]{1,180}$/.test(message);
  console.error(safe ? message : 'Release stage failed; inspect provider status without exposing credentials.');
  // Class names and error codes only: never messages, bodies or URLs.
  if (!safe) console.error(`Diagnostic: ${diagnostic(error)}`);
  process.exitCode = 1;
}
