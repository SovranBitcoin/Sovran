import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { digest, git, within } from './workspace';
import type { Contract } from './workflow';

const dependencies = z.record(z.string(), z.string());
const manifest = z.object({ dependencies: dependencies.optional(), devDependencies: dependencies.optional(),
  peerDependencies: dependencies.optional(), optionalDependencies: dependencies.optional() });

function versions(contents: string) {
  const data = manifest.parse(JSON.parse(contents));
  return new Map(Object.entries(data).flatMap(([section, values]) =>
    Object.entries(values ?? {}).map(([name, version]) => [`${section}:${name}`, { name, version }] as const)));
}

export function inspectChange(root: string, base: string, spec: Contract) {
  const changed = [...new Set([
    ...git(root, ['diff', '--name-only', '-z', '--no-renames', base, '--']).split('\0'),
    ...git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0'),
  ].filter(Boolean))];
  const problems: string[] = [];
  for (const path of spec.scope) if (isAbsolute(path) || path.split('/').some(p => p === '..' || p === '.') || path.includes('\\'))
    problems.push(`Scope must use explicit repository paths: ${path}`);
  for (const path of changed) {
    if (!spec.scope.some(allowed => path === allowed || path.startsWith(`${allowed.replace(/\/$/, '')}/`)))
      problems.push(`Outside sealed scope: ${path}`);
    if (existsSync(join(root, path))) within(root, path);
    if (path === 'package.json' || path.endsWith('/package.json')) {
      let before = new Map<string, { name: string; version: string }>();
      // A missing base manifest is a new package. Other git failures are not ignored.
      if (git(root, ['ls-tree', '--name-only', base, '--', path]) === path) before = versions(git(root, ['show', `${base}:${path}`]));
      const after = existsSync(join(root, path)) ? versions(readFileSync(within(root, path), 'utf8')) : new Map();
      for (const [key, value] of after) if (before.get(key)?.version !== value.version && !spec.allowedDependencies.includes(`${value.name}@${value.version}`))
        problems.push(`Dependency needs intake authorization: ${path}: ${value.name}@${value.version}`);
      const previous = git(root, ['ls-tree', '--name-only', base, '--', path]) === path
        ? z.record(z.string(), z.unknown()).parse(JSON.parse(git(root, ['show', `${base}:${path}`]))) : {};
      const current = existsSync(join(root, path)) ? z.record(z.string(), z.unknown()).parse(JSON.parse(readFileSync(within(root, path), 'utf8'))) : {};
      for (const section of ['overrides', 'resolutions', 'catalog', 'catalogs', 'patchedDependencies', 'trustedDependencies', 'workspaces', 'packageManager']) {
        const value = JSON.stringify(current[section] ?? null);
        if (JSON.stringify(previous[section] ?? null) !== value && !spec.allowedDependencies.includes(`manifest:${path}#${section}=${value}`))
          problems.push(`Dependency policy needs intake authorization: manifest:${path}#${section}=${value}`);
      }
      if (path === 'app/package.json') {
        const scripts = z.object({ 'test:upgrade': z.string().optional() }).optional();
        if (scripts.parse(previous.scripts)?.['test:upgrade'] !== scripts.parse(current.scripts)?.['test:upgrade'])
          problems.push('The historical upgrade command cannot change inside the task it certifies');
      }
    }
    if (/^(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)) {
      const hash = existsSync(join(root, path)) ? digest(readFileSync(within(root, path))) : 'deleted';
      if (!spec.allowedDependencies.includes(`lockfile:${path}@${hash}`))
        problems.push(`Lockfile needs intake authorization: lockfile:${path}@${hash}`);
    }
    if (/^app\/(jest[^/]*\.|__tests__\/(releaseFixtures|cocoDatabase|persistenceSurface|releasedPersistedSurface))/.test(path) &&
      git(root, ['ls-tree', '--name-only', base, '--', path]) === path)
      problems.push(`Historical check input must be settled before sealing: ${path}`);
  }
  const risks = new Set(spec.risks);
  // Conservative routing. A missed storage dependency is worse than an extra upgrade run.
  if (changed.some(p => /^(wallet\/|app\/)|(^|\/)(package\.json|bun\.lock)$/.test(p))) risks.add('persistence');
  if (changed.some(p => /^wallet\//.test(p) || /^app\/shared\/lib\/(cashu|nostr)\//.test(p))) risks.add('payments');
  if (changed.some(p => /^app\/(app|features|shared\/components)\//.test(p))) risks.add('ui');
  return { changed, problems, risks: [...risks] };
}
