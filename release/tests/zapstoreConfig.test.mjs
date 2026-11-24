import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appConfig = require('../../app/app.config.js');
const appJson = JSON.parse(readFileSync(new URL('../../app/app.json', import.meta.url), 'utf8'));
const easJson = JSON.parse(readFileSync(new URL('../../app/eas.json', import.meta.url), 'utf8'));

function evalProfile(env) {
  const prev = {
    EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE,
    APP_VARIANT: process.env.APP_VARIANT,
    EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
  };
  delete process.env.EAS_BUILD_PROFILE;
  delete process.env.APP_VARIANT;
  delete process.env.EXPO_PUBLIC_ENV;
  Object.assign(process.env, env);
  try {
    return appConfig({ config: structuredClone(appJson.expo) });
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('Play Store and App Store production identifiers remain com.sovranbitcoin', () => {
  const prod = evalProfile({});
  assert.equal(prod.ios.bundleIdentifier, 'com.sovranbitcoin');
  assert.equal(prod.android.package, 'com.sovranbitcoin');
  assert.equal(easJson.submit.production.android.applicationId, 'com.sovranbitcoin');
  assert.equal(easJson.submit.production.ios.ascAppId, '6499554529');
});

test('Zapstore profile resolves to com.sovranbitcoin.zapstore APK without altering iOS or Play', () => {
  const zap = evalProfile({ APP_VARIANT: 'zapstore' });
  assert.equal(zap.android.package, 'com.sovranbitcoin.zapstore');
  assert.equal(zap.ios.bundleIdentifier, 'com.sovranbitcoin');
  assert.equal(easJson.build.zapstore.extends, 'production');
  assert.equal(easJson.build.zapstore.env.APP_VARIANT, 'zapstore');
  assert.equal(easJson.build.zapstore.android.buildType, 'apk');
});

test('development and preview profiles keep com.sovranbitcoin.dev', () => {
  for (const profile of ['development', 'preview']) {
    const cfg = evalProfile({ EAS_BUILD_PROFILE: profile });
    assert.equal(cfg.ios.bundleIdentifier, 'com.sovranbitcoin.dev');
    assert.equal(cfg.android.package, 'com.sovranbitcoin.dev');
  }
});
