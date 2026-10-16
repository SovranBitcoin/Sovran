import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureSourceFingerprint, fingerprintSourceFiles } from '../../app/e2e/core/git';

export function digest(value: string | Buffer) { return createHash('sha256').update(value).digest('hex'); }

export function within(root: string, path: string) {
  const absolute = realpathSync(resolve(root, path));
  const rel = relative(realpathSync(root), absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes workspace: ${path}`);
  return absolute;
}

export function git(root: string, args: string[]) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

export function fingerprint(root: string) {
  const result = captureSourceFingerprint(root);
  if (!result) throw new Error('Source fingerprint unavailable');
  return result;
}

export function fileEvidence(root: string, path: string) {
  return { path, sha256: digest(readFileSync(within(root, path))) };
}

/** Executed test inputs must remain covered by the candidate's source identity. */
export function testInputEvidence(root: string, files: string[]) {
  root = realpathSync(root);
  const listed = new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0'));
  return files.map(path => {
    const absolute = resolve(root, path);
    if (!listed.has(path) || within(root, path) !== absolute || !lstatSync(absolute).isFile() ||
      fingerprintSourceFiles(root, [path]) !== fingerprintSourceFiles(root, [path], { excludeArtifacts: false }))
      throw new Error(`Test input is not a regular file covered by the source fingerprint: ${path}`);
    return { ...fileEvidence(root, path), executable: Boolean(lstatSync(absolute).mode & 0o111) };
  });
}
