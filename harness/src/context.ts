import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Contract } from './workflow';

/** Routing points to the existing rules; it does not copy their rules into another owner. */
export function contextPaths(root: string, contract: Contract) {
  const paths = new Set(contract.contextFiles);
  if (!existsSync(join(root, 'AGENTS.md'))) return [...paths];
  for (const path of ['AGENTS.md', 'docs/review/contributor-conventions.md', 'docs/follow-ups/README.md']) paths.add(path);
  if (contract.scope.some(p => /^(app|wallet|nostr|harness)($|\/)/.test(p)))
    for (const name of ['typescript-best-practices', 'principle-model-the-domain', 'principle-type-system-discipline']) paths.add(`.agents/skills/${name}/SKILL.md`);
  if (contract.scope.some(p => /^(app|wallet)($|\/)/.test(p)) || contract.risks.includes('persistence'))
    for (const path of ['.agents/skills/persistence-release-safety/SKILL.md', 'docs/architecture/account-lifecycle.md', 'docs/review/conventions-state.md',
      'docs/architecture/persistence/persistence-map.md', 'docs/architecture/persistence/evidence-ledger.md']) paths.add(path);
  if (contract.scope.some(p => /^app($|\/)/.test(p)) || contract.risks.includes('ui'))
    for (const path of ['.agents/skills/expo-router/SKILL.md', '.agents/skills/react-native-best-practices/SKILL.md', 'docs/protocols/navigation-and-routes.md', 'docs/review/building-screens.md', 'app/docs/testing-json-native-adr.md']) paths.add(path);
  if (contract.scope.some(p => /^wallet($|\/)/.test(p)) || contract.risks.includes('payments'))
    for (const path of ['docs/architecture/overview.md', 'docs/review/contracts.md', 'docs/review/entropy.md']) paths.add(path);
  return [...paths];
}
