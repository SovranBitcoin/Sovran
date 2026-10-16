import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fixture } from './controller.test';
import { contextPaths } from '../src/context';
import { Controller } from '../src/controller';
import { git } from '../src/workspace';

test('a native story task receives both native decisions without unrelated screen-authoring instructions', () => {
  const { root, spec } = fixture();
  writeFileSync(join(root, 'AGENTS.md'), 'Use the native testing decisions');
  const paths = contextPaths(root, { ...spec, scope: ['app'],
    historyPolicy: { version: 1, paths: ['app/e2e/stories/play.ts'] } });
  expect(paths).toContain('app/docs/testing-json-native-adr.md');
  expect(paths).toContain('app/docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md');
  expect(paths).not.toContain('.agents/skills/expo-router/SKILL.md');
  // Context selection must not waive the conservative saved-state obligation.
  expect(paths).toContain('.agents/skills/persistence-release-safety/SKILL.md');
});

test('a TypeScript file outside the wallet packages still receives the language rules', () => {
  const { root, spec } = fixture();
  writeFileSync(join(root, 'AGENTS.md'), 'Use language rules');
  const paths = contextPaths(root, { ...spec, scope: ['site/src/lib/releases.ts'] });
  expect(paths).toContain('.agents/skills/typescript-best-practices/SKILL.md');
  expect(paths).toContain('docs/review/conventions-typescript.md');
  expect(paths).not.toContain('.agents/skills/persistence-release-safety/SKILL.md');
});

test('component tests use the declared RNTL reference and flow changes retain both platform decisions', () => {
  const { root, spec } = fixture();
  writeFileSync(join(root, 'AGENTS.md'), 'Use versioned component testing guidance');
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app/package.json'), JSON.stringify({ devDependencies: { '@testing-library/react-native': '13.3.3' } }));
  const paths = contextPaths(root, { ...spec, scope: ['app'], historyPolicy: { version: 1,
    paths: ['app/app/(send-flow)/index.tsx', 'app/__tests__/send.test.tsx'] } });
  expect(paths).toContain('.agents/skills/react-native-testing/references/api-reference-v13.md');
  expect(paths).toContain('docs/review/conventions-async-tests.md');
  expect(paths).toContain('docs/review/conventions-react-native.md');
  expect(paths).toContain('app/docs/adr/0025-android-flows-are-pushed-screens.md');
  expect(paths).toContain('app/docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md');
  writeFileSync(join(root, 'app/package.json'), JSON.stringify({ dependencies: { '@testing-library/react-native': '^14.0.0' } }));
  expect(contextPaths(root, { ...spec, scope: ['app/__tests__/send.test.tsx'] }))
    .toContain('.agents/skills/react-native-testing/references/api-reference-v14.md');
});

test('new hook tests and legacy test directories cannot omit versioned guidance', () => {
  const { root, spec } = fixture();
  writeFileSync(join(root, 'AGENTS.md'), 'Use component test guidance when the new test body is unknown');
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app/package.json'), JSON.stringify({ devDependencies: { '@testing-library/react-native': '13.3.3' } }));
  for (const scope of ['app/__tests__/newHook.test.ts', 'app/__tests__', 'app/features/send/__tests__', 'app/shared/hooks/__tests__'])
    expect(contextPaths(root, { ...spec, scope: [scope] })).toContain('.agents/skills/react-native-testing/references/api-reference-v13.md');
  expect(contextPaths(root, { ...spec, scope: ['site/src'] })).toContain('docs/review/conventions-typescript.md');
  writeFileSync(join(root, 'app/package.json'), JSON.stringify({ devDependencies: { '@testing-library/react-native': '^13.3.3 || ^14.0.0' } }));
  expect(() => contextPaths(root, { ...spec, scope: ['app/__tests__/newHook.test.ts'] })).toThrow('identifiable supported RNTL version');
});

test('app-side evidence producers receive the execution decision as well as native custody rules', () => {
  const { root, spec } = fixture();
  writeFileSync(join(root, 'AGENTS.md'), 'The runner and app share the native protocol');
  for (const path of ['app/shared/lib/loggerRunnerLink.ts', 'app/shared/lib/e2e/elementMap.ts']) {
    const paths = contextPaths(root, { ...spec, scope: [path] });
    expect(paths).toContain('app/docs/testing-json-native-adr.md');
    expect(paths).toContain('app/docs/adr/0033-an-end-to-end-test-is-one-user-story-run-fast.md');
  }
});

test('explicit risks survive focused routing and selected contents survive restart without live substitution', () => {
  const { root, spec, state, controller: c } = fixture();
  writeFileSync(join(root, 'AGENTS.md'), 'Keep the sealed original rules');
  const contract = { ...spec, risks: ['ui', 'persistence'] satisfies typeof spec.risks };
  const selected = contextPaths(root, contract);
  expect(selected).toContain('.agents/skills/persistence-release-safety/SKILL.md');
  expect(selected).toContain('.agents/skills/expo-router/SKILL.md');
  for (const path of selected.filter(p => !['source.txt', 'AGENTS.md'].includes(p))) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), `Original rule from ${path}`);
  }
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'Fixture context']);
  const t = c.next(c.create(root, contract).id);
  const before = c.brief(t.id).packet.context;
  writeFileSync(join(root, 'AGENTS.md'), 'Changed rules must not replace sealed instructions');
  const resumed = new Controller(state);
  try {
    expect(resumed.brief(t.id).packet.context).toEqual(before);
    expect(before.filter(p => p.delivery === 'inline').find(p => p.path === 'AGENTS.md')?.content).toBe('Keep the sealed original rules');
    expect(before.filter(p => p.delivery === 'inline').find(p => p.path.includes('0033-'))?.content).toContain('Original rule');
  } finally { resumed.close(); }
});


test('large references stay readable from their sealed snapshot without flooding each brief', () => {
  const { root, spec, state, controller: c } = fixture();
  const path = 'docs/reference.md';
  const original = 'Historical protection that must survive.\n'.repeat(2400);
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, path), original);
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'Large reference']);
  const t = c.next(c.create(root, { ...spec, contextFiles: ['source.txt', path] }).id);
  const before = c.brief(t.id).packet.context;
  expect(Buffer.byteLength(JSON.stringify(before))).toBeLessThan(Buffer.byteLength(original));
  const reference = before.find(item => item.path === path);
  expect(reference?.delivery).toBe('snapshot');
  if (reference?.delivery !== 'snapshot') throw new Error('Expected a sealed reference');
  const index = Number(reference.snapshot.pointer.split('/')[1]);
  expect(JSON.parse(readFileSync(reference.snapshot.file, 'utf8'))[index].content).toBe(original);
  writeFileSync(join(root, path), 'Later edits must not replace the reference');
  const resumed = new Controller(relative(process.cwd(), state));
  try { expect(resumed.brief(t.id).packet.context).toEqual(before); }
  finally { resumed.close(); }
  const saved = JSON.parse(readFileSync(reference.snapshot.file, 'utf8'));
  saved[index].content = 'Corrupted snapshot';
  writeFileSync(reference.snapshot.file, JSON.stringify(saved));
  expect(() => c.brief(t.id)).toThrow('Sealed context snapshot is missing or changed');
});


test('authority and skill procedures remain inline even when large', () => {
  const { root, spec, controller: c } = fixture();
  const paths = ['docs/AGENTS.md', '.agents/skills/task/SKILL.md'];
  const content = 'Preserve this required procedure. '.repeat(3000);
  for (const path of paths) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, ['add', '.']); git(root, ['commit', '-qm', 'Required procedures']);
  const t = c.next(c.create(root, { ...spec, contextFiles: paths }).id);
  const context = c.brief(t.id).packet.context;
  for (const path of paths) {
    const item = context.find(item => item.path === path);
    expect(item?.delivery === 'inline' && item.content).toBe(content);
  }
});
