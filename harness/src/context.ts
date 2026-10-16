import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Contract } from './workflow';
import { risksForPaths } from './policy';
import { within } from './workspace';

/** Routing points to the existing rules; it does not copy their rules into another owner. */
export function contextPaths(root: string, contract: Contract) {
  const paths = new Set(contract.contextFiles);
  if (!existsSync(join(root, 'AGENTS.md'))) return [...paths];
  // Planned files have executable history coverage; a wider authorized directory
  // is not evidence that every feature in that directory is being changed.
  const planned = contract.historyPolicy?.paths ?? contract.scope;
  const touches = (pattern: RegExp) => planned.some(p => pattern.test(p));
  const risks = risksForPaths(planned, contract.risks);
  for (const path of ['AGENTS.md', 'docs/review/contributor-conventions.md', 'docs/follow-ups/README.md']) paths.add(path);
  if (touches(/\.[cm]?tsx?$|^(app|wallet|nostr|harness|site)(\/[^.]+)?$/)) {
    for (const name of ['typescript-best-practices', 'principle-model-the-domain', 'principle-type-system-discipline']) paths.add(`.agents/skills/${name}/SKILL.md`);
    paths.add('docs/review/conventions-typescript.md');
  }
  if (risks.includes('persistence') || touches(/^(app|wallet)$/))
    for (const path of ['.agents/skills/persistence-release-safety/SKILL.md', 'docs/architecture/account-lifecycle.md', 'docs/review/conventions-state.md',
      'docs/architecture/persistence/persistence-map.md', 'docs/architecture/persistence/evidence-ledger.md']) paths.add(path);
  const ui = risks.includes('ui') || touches(/^app(?:\/shared)?$|^app\/(app|features|shared\/(components|ui|hooks))$|^app\/(?!e2e\/).*\.tsx$/);
  if (ui)
    for (const path of ['.agents/skills/expo-router/SKILL.md', '.agents/skills/react-native-best-practices/SKILL.md', 'docs/protocols/navigation-and-routes.md', 'docs/review/building-screens.md', 'docs/review/conventions-react-native.md', 'app/docs/adr/0025-android-flows-are-pushed-screens.md']) paths.add(path);
  if (ui || touches(/^app\/e2e($|\/)|^app\/shared\/lib\/(e2e($|\/)|logger(RunnerLink|Core)\.ts$)/))
    for (const path of ['app/docs/testing-json-native-adr.md', 'app/docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md']) paths.add(path);
  if (touches(/(^|\/)(__tests__|tests|e2e)($|\/)|\.(test|spec)\.[cm]?[jt]sx?$/))
    paths.add('docs/review/conventions-async-tests.md');
  const componentTest = planned.some(p => p.startsWith('app/') && !p.startsWith('app/e2e/') &&
    (/^app\/__tests__(\/[^.]+)?$/.test(p) || /\.(test|spec)\.tsx$/.test(p) ||
      (/\.(test|spec)\.ts$/.test(p) && (!existsSync(join(root, p)) || ui ||
        readFileSync(within(root, p), 'utf8').includes('@testing-library/react-native')))));
  if (componentTest) {
    paths.add('.agents/skills/react-native-testing/SKILL.md');
    paths.add('app/package.json');
    const manifest = z.object({ devDependencies: z.record(z.string(), z.string()).optional(), dependencies: z.record(z.string(), z.string()).optional() })
      .parse(JSON.parse(readFileSync(within(root, 'app/package.json'), 'utf8')));
    const version = manifest.devDependencies?.['@testing-library/react-native'] ?? manifest.dependencies?.['@testing-library/react-native'];
    const major = /^[~^]?(13|14)\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.exec(version ?? '')?.[1];
    if (!major) throw new Error('Component tests need an identifiable supported RNTL version in app/package.json');
    paths.add(`.agents/skills/react-native-testing/references/api-reference-v${major}.md`);
  }
  if (touches(/^wallet($|\/)/) || risks.includes('payments'))
    for (const path of ['docs/architecture/overview.md', 'docs/review/contracts.md', 'docs/review/entropy.md']) paths.add(path);
  return [...paths];
}
