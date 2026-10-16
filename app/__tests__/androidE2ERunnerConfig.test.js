/* global __dirname, it, expect */
/** Exercise Expo's real file generation; the Gradle/installed-app matrix is native evidence. */
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

it('generates an isolated loopback policy idempotently and preserves existing app manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'sovran-e2e-plugin-'));
  const app = join(root, 'android/app');
  mkdirSync(join(app, 'src/main'), { recursive: true });
  mkdirSync(join(app, 'src/release'), { recursive: true });
  writeFileSync(join(app, 'build.gradle'), 'android { }\n');
  const manifest = '<manifest><application existing="preserve-me" /></manifest>\n';
  for (const mode of ['main', 'release'])
    writeFileSync(join(app, `src/${mode}/AndroidManifest.xml`), manifest);
  try {
    const output = execFileSync(
      'node',
      [
        '-e',
        `
      const { compileModsAsync, XML } = require('expo/config-plugins');
      const { readFileSync } = require('node:fs');
      const { join } = require('node:path');
      const plugin = require(process.argv[2]);
      (async () => {
        const projectRoot = process.argv[1];
        const generate = () => compileModsAsync(plugin({ name: 'test', slug: 'test' }), { projectRoot, platforms: ['android'] });
        await generate();
        const gradle = readFileSync(join(projectRoot, 'android/app/build.gradle'), 'utf8');
        await generate();
        const generated = join(projectRoot, 'android/app/src/sovranBundledE2e');
        process.stdout.write(JSON.stringify({
          stable: gradle === readFileSync(join(projectRoot, 'android/app/build.gradle'), 'utf8'),
          manifest: await XML.readXMLAsync({ path: join(generated, 'AndroidManifest.xml') }),
          policy: await XML.readXMLAsync({ path: join(generated, 'res/xml/sovran_e2e_network_security.xml') }),
        }));
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `,
        root,
        resolve(__dirname, '../plugins/withAndroidE2ERunner.js'),
      ],
      { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000 }
    );
    const result = JSON.parse(output);
    expect(result.stable).toBe(true);
    expect(result.manifest.manifest.application[0].$).toEqual({
      'android:networkSecurityConfig': '@xml/sovran_e2e_network_security',
    });
    expect(result.policy['network-security-config']).toEqual({
      'base-config': [{ $: { cleartextTrafficPermitted: 'false' } }],
      'domain-config': [
        {
          $: { cleartextTrafficPermitted: 'true' },
          domain: [{ _: '127.0.0.1', $: { includeSubdomains: 'false' } }],
        },
      ],
    });
    for (const mode of ['main', 'release'])
      expect(readFileSync(join(app, `src/${mode}/AndroidManifest.xml`), 'utf8')).toBe(manifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
