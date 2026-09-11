import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { androidRelease } from '../android.mjs';
import { config } from '../core.mjs';

function preparedRelease(ownsTrack) {
  return {
    version: '0.1.1', sourceSha: 'b'.repeat(40),
    builds: { android: { id: 'unused', number: '30', ready: true } },
    aabSha256: 'a'.repeat(64), playEdit: 'saved-edit',
    intents: ownsTrack ? { 'play-track': '2026-09-10T00:00:00Z' } : {},
    steps: {}, channels: {},
  };
}

for (const ownsTrack of [true, false]) {
  test(ownsTrack ? 'interrupted Play track update resumes without a second upload or track replacement' : 'an unowned existing Play track cannot be adopted', async () => {
    const oldToken = process.env.GOOGLE_ACCESS_TOKEN;
    process.env.GOOGLE_ACCESS_TOKEN = 'fake-canary';
    const state = preparedRelease(ownsTrack);
    const saved = [];
    const ledger = {
      state,
      async save() { saved.push(structuredClone(state)); },
      async intent(name) { state.intents[name] = '2026-09-10T01:00:00Z'; await this.save(); },
    };
    const calls = [];
    let summaryReads = 0;
    const handle = mock.method(globalThis, 'fetch', async (url, options) => {
      const route = new URL(url).pathname.split(`/applications/${config.bundleId}/`)[1];
      calls.push(`${options.method} ${route}`);
      if (options.method === 'GET' && route === 'tracks/production/releases') return Response.json({ releases: ++summaryReads === 1 ? [] : [{ releaseLifecycleState: 'RELEASE_LIFECYCLE_STATE_IN_REVIEW', activeArtifacts: [{ versionCode: '30' }] }] });
      if (options.method === 'GET' && route === 'edits/saved-edit') return Response.json({ id: 'saved-edit' });
      if (options.method === 'GET' && route === 'edits/saved-edit/bundles') return Response.json({ bundles: [{ versionCode: 30, sha256: state.aabSha256 }] });
      if (options.method === 'GET' && route === 'edits/saved-edit/tracks/production') return Response.json({ releases: [{ name: '0.1.1', status: 'completed', versionCodes: ['30'] }] });
      if (options.method === 'POST' && route === 'edits/saved-edit:validate') return Response.json({});
      if (options.method === 'POST' && route === 'edits/saved-edit:commit') {
        assert.ok(saved.at(-1).intents['play-commit'], 'intent must be durable before commit');
        assert.equal(new URL(url).search, '?changesNotSentForReview=false');
        return Response.json({ id: 'saved-edit' });
      }
      if (options.method === 'GET' && route === 'generatedApks/30') return new Response(null, { status: 404 });
      throw new Error('Unexpected provider operation');
    });
    try {
      if (ownsTrack) {
        await androidRelease(ledger);
        assert.equal(state.steps.playSubmitted, true);
        assert.equal(state.playEdit, undefined);
        assert.equal(state.channels.googlePlay, undefined, 'in-review is not public availability');
        assert.equal(state.apk, undefined, 'pending APK is not synthesized');
        assert.deepEqual(calls.filter((call) => call.startsWith('POST ')), ['POST edits/saved-edit:validate', 'POST edits/saved-edit:commit']);
      } else {
        await assert.rejects(androidRelease(ledger), /differs from the prepared track/);
        assert.equal(calls.some((call) => call.startsWith('POST ')), false);
      }
      assert.equal(calls.some((call) => call.startsWith('PUT ')), false);
    } finally {
      handle.mock.restore();
      if (oldToken === undefined) delete process.env.GOOGLE_ACCESS_TOKEN; else process.env.GOOGLE_ACCESS_TOKEN = oldToken;
    }
  });
}
