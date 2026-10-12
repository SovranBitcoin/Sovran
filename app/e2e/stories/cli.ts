/* eslint-disable no-console -- CLI boundary */
/**
 * Play one story on a simulator:
 *   bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app>
 */
import { readFileSync } from 'node:fs';
import { startAppLink } from '../link/appLink';
import { playStory } from './play';
import { storySimulator } from './simulator';
import { storySchema } from './story';

const [storyPath, ...flags] = process.argv.slice(2);
const flag = (name: string) => {
  const at = flags.indexOf(`--${name}`);
  return at === -1 ? undefined : flags[at + 1];
};
const udid = flag('udid');
const appPath = flag('app');
if (!storyPath || !udid || !appPath) {
  console.error('Usage: bun e2e/stories/cli.ts <story.json> --udid <simulator> --app <Sovran.app>');
  process.exit(2);
}

const story = storySchema.parse(JSON.parse(readFileSync(storyPath, 'utf8')));
const simulator = storySimulator(udid);
const link = startAppLink();
const started = performance.now();
try {
  simulator.installFresh(appPath);
  const installed = performance.now();
  simulator.launch({ url: link.url, run: story.id });
  await link.connected(20_000);
  const result = await playStory(story, link, simulator);
  const done = performance.now();

  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${story.id}: ${story.purpose}`);
  for (const [index, step] of result.steps.entries()) {
    const shown = step.entries
      .filter((entry) => /^(screen\.mount|nav\.transition\.end)$/.test(entry.event))
      .map(
        (entry) =>
          `${entry.params?.screen}${entry.event === 'screen.mount' ? ' mounted' : ` slid ${entry.params?.duration_ms} ms`}`
      );
    console.log(
      `  ${step.ok ? 'ok  ' : 'FAIL'} ${index + 1}. ${step.name}  ${step.wallMs} ms${shown.length ? `  (${shown.join(', ')})` : ''}`
    );
    if (step.failure) console.log(`       ${step.failure}`);
  }
  console.log(
    `install ${Math.round(installed - started)} ms, launch and story ${Math.round(done - installed)} ms, steps ${result.steps.reduce((sum, step) => sum + step.wallMs, 0)} ms`
  );
  process.exitCode = result.ok ? 0 : 1;
} finally {
  simulator.terminate();
  link.close();
}
