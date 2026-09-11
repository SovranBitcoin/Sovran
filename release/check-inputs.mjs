import { readFileSync } from 'node:fs';
import { check, command, config } from './core.mjs';

command('node', ['scripts/legal.mjs', '--publication-check']);

// Does not evaluate Expo config, load environments or start builds.
const files = command('git', ['ls-files', '-z']).split('\0').filter(Boolean);
const privatePath = /(^|\/)(credentials(\/|\.json$)|\.env(?:\.|$))|\.(jks|keystore|p8|p12|pem|key|mobileprovision)$/i;
for (const file of files) check(!privatePath.test(file) || file.endsWith('.env.example'), 'Tracked credential-shaped file blocks release');
for (const file of ['.easignore', 'app/.easignore']) {
  const patterns = readFileSync(file, 'utf8').split('\n');
  for (const pattern of ['credentials/', 'credentials.json', '*.jks', '*.keystore', '*.p8', '*.p12', '*.pem', '.env.*']) check(patterns.includes(pattern), 'EAS archive credential exclusion missing');
}
const productVersion = JSON.parse(readFileSync('app/app.json')).expo.version;
for (const file of ['package.json', 'app/package.json']) check(JSON.parse(readFileSync(file)).version === productVersion, 'Product package versions must match app.json');
const eas = JSON.parse(readFileSync('app/eas.json'));
check(eas.cli.appVersionSource === 'remote' && eas.build.production.autoIncrement === true && eas.build.production.android.credentialsSource === 'remote' && eas.build.production.ios.credentialsSource === 'remote', 'Release signing/version profile changed');
check(eas.submit.production.ios.ascAppId === config.appleAppId, 'EAS submission targets another app');
check(!command('git', ['diff', '--name-only', '--', 'bun.lock', 'app/app.json', 'app/eas.json', 'app/assets/brand']).trim(), 'Release inputs changed during installation');
console.log('Release input policy passed. EAS archive and account checks still require operator validation.');
