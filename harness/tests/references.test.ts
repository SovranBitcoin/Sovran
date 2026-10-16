import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareReference } from '../src/references';
import { git } from '../src/workspace';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const cache = mkdtempSync(join(tmpdir(), 'harness-references-')); roots.push(cache);
  const seed = join(cache, 'seed'); mkdirSync(seed);
  git(seed, ['init', '-q']); git(seed, ['config', 'user.email', 'fixture@example.invalid']); git(seed, ['config', 'user.name', 'Fixture']);
  writeFileSync(join(seed, 'README.md'), 'Pinned peer source');
  git(seed, ['add', '.']); git(seed, ['commit', '-qm', 'fixture']);
  const commit = git(seed, ['rev-parse', 'HEAD']);
  function cached(project: string) {
    const directory = join(cache, project, commit);
    mkdirSync(directory, { recursive: true });
    git(directory, ['clone', '-q', seed, '.']);
    git(directory, ['remote', 'set-url', 'origin', `https://github.com/${project}.git`]);
    return directory;
  }
  return { cache, commit, cached };
}

test('peer references use their verified owner and keep same-name caches separate', () => {
  const { cache, commit, cached } = fixture();
  for (const [repository, project] of [['macadamia', 'zeugmaster/macadamia'], ['minibits_wallet', 'minibits-cash/minibits_wallet']] satisfies [string, string][]) {
    const wrongDirectory = cached(`cashubtc/${repository}`);
    const directory = cached(project);
    const snapshot = prepareReference(cache, { repository, commit, paths: ['README.md'] });
    expect(snapshot.directory).toBe(directory);
    expect(snapshot.url).toBe(`https://github.com/${project}.git`);
    expect(snapshot.files[0]?.content).toBe('Pinned peer source');
    expect(git(wrongDirectory, ['remote', 'get-url', 'origin'])).toBe(`https://github.com/cashubtc/${repository}.git`);
  }
});

test('reference caches refuse changed origins, revisions, dirty files and partial checkouts', () => {
  const { cache, commit, cached } = fixture();
  const directory = cached('cashubtc/nuts');
  const input = { repository: 'nuts', commit, paths: ['README.md'] };
  expect(prepareReference(cache, input).commit).toBe(commit);
  git(directory, ['remote', 'set-url', 'origin', 'https://github.com/example/nuts.git']);
  expect(() => prepareReference(cache, input)).toThrow('wrong origin');
  git(directory, ['remote', 'set-url', 'origin', 'https://github.com/cashubtc/nuts.git']);
  writeFileSync(join(directory, 'README.md'), 'Local edits');
  expect(() => prepareReference(cache, input)).toThrow('changed');
  expect(readFileSync(join(directory, 'README.md'), 'utf8')).toBe('Local edits');
  git(directory, ['config', 'user.email', 'fixture@example.invalid']); git(directory, ['config', 'user.name', 'Fixture']);
  git(directory, ['add', '.']); git(directory, ['commit', '-qm', 'changed revision']);
  expect(() => prepareReference(cache, input)).toThrow('changed');
  const partialCommit = 'a'.repeat(40);
  mkdirSync(join(cache, 'cashubtc/nuts', partialCommit), { recursive: true });
  expect(() => prepareReference(cache, { ...input, commit: partialCommit })).toThrow();
});
