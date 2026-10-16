/** Fresh Android stories use the shared player and result format, on an owned
 * emulator. Development and bundled lanes make no device-performance claim. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appSourceStamp } from '../../../scripts/lib/app-source.mjs';
import {
  androidFailureText as errorText,
  withAndroidEmulatorSession,
} from '../drivers/android/android-session';
import {
  ANDROID_PACKAGE_ID as PACKAGE,
  escapeInputText,
  Adb,
  adbBin,
  resolveAndroidSdkRoot,
} from '../drivers/android/adb';
import { startOwnedMetro } from '../drivers/simulator-session';
import { startAppLink, type AppHello } from '../link/appLink';
import {
  ensureNativeBuild,
  bundledJavaScriptIsCurrent,
  nativeArtifactHash,
  nativeFingerprint,
  type BuildKind,
} from '../press/native-build';
import {
  createStoryRun,
  registerAttempt,
  finishAttempt,
  finishStoryRun,
  storyReportSchema,
} from '../results/runs';
import { pictureName } from './evidence';
import { playStory } from './play';
import { storySchema, type Story } from './story';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
function fileHash(path: string): string {
  const hash = createHash('sha256');
  const file = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    for (let n = readSync(file, buffer); n > 0; n = readSync(file, buffer))
      hash.update(buffer.subarray(0, n));
    return hash.digest('hex');
  } finally {
    closeSync(file);
  }
}

/** Unsupported setup must fail before starting Metro or allocating a device. */
export function requireFreshAndroidStory(story: Story): void {
  if (
    story.startsFrom !== 'fresh' ||
    story.given ||
    story.allow?.length ||
    story.steps.some((step) => step.handed || step.open)
  )
    throw new Error(
      'Android stories currently require fresh state without given/handed inputs, links or permission overrides'
    );
  for (const step of story.steps) if (step.type) escapeInputText(step.type.text);
}

/** Read back the installed payload and atomically hand the app its session note.
 * The source stamp hashes metadata too; installed APK comparison hashes bytes. */
export async function bindAndroidStoryApp(options: {
  adb: Pick<Adb, 'shell' | 'raw'>;
  writeRunnerNote: (note: { url: string; run: string }, receiptPath: string) => Promise<void>;
  apk: string;
  outDir: string;
  note: { url: string; run: string };
}): Promise<{ built: string; installed: string }> {
  const { adb, apk, outDir, note } = options;
  const installed = (await adb.shell(['pm', 'path', PACKAGE])).trim();
  if (!/^package:\/data\/app\/[^\r\n]+\.apk$/.test(installed))
    throw new Error('Expected one installed base APK');
  const copy = join(outDir, 'installed.apk');
  await adb.raw(['pull', installed.slice('package:'.length), copy], { timeoutMs: 120_000 });
  const payload = { built: fileHash(apk), installed: fileHash(copy) };
  writeFileSync(join(outDir, 'payload.json'), JSON.stringify(payload));
  if (payload.built !== payload.installed)
    throw new Error('Installed APK differs from the selected build');
  rmSync(copy); // The receipt retains the hashes; do not retain a second large APK.
  await options.writeRunnerNote(note, join(outDir, 'runner-provisioning.json'));
  return payload;
}

export async function runAndroidStory(
  storyPath: string,
  kind: BuildKind = 'dev'
): Promise<{ ok: boolean; runDir: string }> {
  const storyText = readFileSync(storyPath, 'utf8');
  const story = storySchema.parse(JSON.parse(storyText));
  requireFreshAndroidStory(story);
  const run = randomUUID();
  const runDir = createStoryRun(
    join(ROOT, 'app/e2e/artifacts'),
    `android-${kind === 'bundled' ? 'bundled' : 'development'}-story`,
    [story.id]
  );
  const outDir = registerAttempt(runDir, `android-${run}`, story.id);
  const save = (name: string, value: unknown) =>
    writeFileSync(join(outDir, name), JSON.stringify(value, null, 2));
  const expected = { run, platform: 'android' } satisfies Pick<AppHello, 'run' | 'platform'>;
  let link: ReturnType<typeof startAppLink> | undefined;
  let report: ReturnType<typeof storyReportSchema.parse> = {
    id: story.id,
    purpose: story.purpose,
    startsFrom: story.startsFrom,
    ok: false,
    steps: [],
  };
  const failures: string[] = [];
  let avdRoot: string | undefined;
  try {
    writeFileSync(join(outDir, 'story.json'), storyText);
    const build = await ensureNativeBuild('android', 'never', kind);
    if (build.bundleId !== PACKAGE || (build.kind ?? 'dev') !== kind)
      throw new Error('Android build does not match the selected story mode');
    const source = appSourceStamp(ROOT);
    if (!source) throw new Error('Cannot identify the app source');
    const session = {
      kind: `android-${kind === 'bundled' ? 'bundled' : 'development'}-functional`,
      expected,
      story: { id: story.id, sha256: createHash('sha256').update(storyText).digest('hex') },
      build,
      source,
      limitations: [
        ...(kind === 'dev'
          ? [
              'owned Metro, not bundled JavaScript',
              'extended dev-mode toast and triple-tap timing',
              'state mirror enabled',
              'location pregranted by the Android session',
            ]
          : [
              'owned AOSP emulator; root used only to provision runner connection',
              'normal animation scales; display kept awake and system status normalized',
            ]),
        'no video or pixel-motion measurement',
        'no device performance certification',
      ],
    };
    save('session.json', session);
    const appLink = startAppLink(expected);
    link = appLink;
    await withAndroidEmulatorSession(
      {
        runId: run,
        runDir,
        application: kind === 'bundled' ? { kind, apk: build.artifact } : { kind },
      },
      async (device, signal) => {
        avdRoot = device.avdRoot;
        const ownership = {
          serial: device.serial,
          avd: device.avd,
          avdRoot,
          runtime: device.runtime,
          systemImage: device.systemImage,
        };
        save('session.json', { ...session, ownership });
        try {
          await device.install('erase', async () => {
            if (kind === 'bundled' && !bundledJavaScriptIsCurrent(build))
              throw new Error('Bundled JavaScript no longer matches the source');
            await bindAndroidStoryApp({
              adb: device.adb,
              writeRunnerNote: device.writeRunnerNote,
              apk: build.artifact,
              outDir,
              note: { url: appLink.url, run },
            });
          });
          const hello = await appLink.connected(90_000);
          signal.throwIfAborted();
          save('session.json', { ...session, ownership, hello });
          const result = await playStory(
            story,
            appLink,
            {
              tap: (x, y) => device.adb.tap(x, y),
              swipe: (from, to) =>
                device.adb.swipe({ x: from[0], y: from[1] }, { x: to[0], y: to[1] }),
              type: async (text) => {
                const enter = text.endsWith('\n');
                await device.adb.typeText(enter ? text.slice(0, -1) : text);
                if (enter) await device.adb.keyevent('KEYCODE_ENTER');
              },
            },
            undefined,
            async (index, step) => {
              report.steps[index] = { ...step };
              signal.throwIfAborted();
              const file = `${pictureName(index, step.name)}.png`;
              writeFileSync(join(outDir, file), await device.adb.screencapPng());
              report.steps[index].picture = file;
              save(`${pictureName(index, step.name)}.screen.json`, await appLink.screen());
            }
          );
          signal.throwIfAborted();
          report.ok = result.ok;
          const failed = report.steps.find((step) => !step.ok);
          if (failed) report.failure = `${failed.name}: ${failed.failure ?? 'expectations failed'}`;
        } finally {
          // A failed connection has no app-link logs. Keep device evidence before
          // the owned emulator is destroyed, and attempt each capture separately.
          // Like session cleanup, bounded reads must survive the run's abort.
          const captureAdb = new Adb({
            serial: device.serial,
            bin: adbBin(resolveAndroidSdkRoot()),
          });
          for (const capture of [
            async () =>
              writeFileSync(
                join(outDir, 'device-log.txt'),
                await captureAdb.raw(['logcat', '-d', '-t', '1000']),
                { mode: 0o600 }
              ),
            async () =>
              writeFileSync(join(outDir, 'screen-final.png'), await captureAdb.screencapPng()),
          ]) {
            try {
              await capture();
            } catch (error) {
              failures.push(errorText(error));
            }
          }
        }
      },
      {
        findApk: () => build.artifact,
        startMetro: (dir, signal, options) =>
          startOwnedMetro(dir, signal, {
            ...options,
            extraEnv: { ...options?.extraEnv, EXPO_PUBLIC_E2E_LOGS: '1' },
          }),
      }
    );
    const sourceAfter = appSourceStamp(ROOT);
    save('source-after.json', sourceAfter);
    if (
      (kind === 'bundled' && !bundledJavaScriptIsCurrent(build)) ||
      !sourceAfter ||
      sourceAfter.fingerprint !== source.fingerprint ||
      (await nativeFingerprint('android', kind)) !== build.fingerprint ||
      nativeArtifactHash(build.artifact) !== build.artifactSha256
    )
      throw new Error('App source or native build changed during the story');
  } catch (error) {
    failures.push(errorText(error));
  } finally {
    // Do not let passing UI assertions outrun cleanup or lost evidence.
    for (const operation of [
      () => link?.close(),
      () => save('app-log.json', link?.entries ?? []),
      () => {
        const absent = avdRoot ? !existsSync(avdRoot) : null;
        save('cleanup.json', { avdRoot, avdRootAbsent: absent });
        if (absent === false) throw new Error('Owned Android AVD remains after cleanup');
      },
    ]) {
      try {
        operation();
      } catch (error) {
        failures.push(errorText(error));
      }
    }
  }
  if (failures.length) report = { ...report, ok: false, failure: failures.join('; ') };
  try {
    storyReportSchema.parse(report);
    save('report.json', report);
  } catch (error) {
    report = { ...report, ok: false, failure: errorText(error) };
  }
  finishAttempt(outDir, story.id, report.ok ? 0 : 1, report.failure);
  finishStoryRun(runDir);
  return { ok: report.ok, runDir };
}
