const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const cashuKymPatchPath = path.join(root, 'patches', 'cashu-kym+0.4.1.patch');
const patchPackageEntry = path.join(root, 'node_modules', 'patch-package', 'index.js');
const skippedPatches = [];
let exitCode = 0;

function fileContains(filePath, text) {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8').includes(text);
}

function replaceOrThrow(text, search, replacement, filePath) {
  if (text.includes(replacement)) {
    return text;
  }

  if (!text.includes(search)) {
    throw new Error(`Unable to apply cashu-kym patch to ${path.relative(root, filePath)}`);
  }

  return text.replace(search, replacement);
}

function replaceRegexOrThrow(text, search, replacement, filePath) {
  if (!search.test(text)) {
    throw new Error(`Unable to apply cashu-kym patch to ${path.relative(root, filePath)}`);
  }

  return text.replace(search, replacement);
}

function updateFile(filePath, updater) {
  const before = fs.readFileSync(filePath, 'utf8');
  const after = updater(before);

  if (after !== before) {
    fs.writeFileSync(filePath, after);
  }
}

function isCashuKymPatchApplied() {
  const packageRoot = path.join(root, 'node_modules', 'cashu-kym', 'dist', 'main');
  const jsPath = path.join(packageRoot, 'index.js');
  const cjsPath = path.join(packageRoot, 'index.cjs');
  const dtsPath = path.join(packageRoot, 'index.d.ts');
  const types = fs.existsSync(dtsPath) ? fs.readFileSync(dtsPath, 'utf8') : '';

  const jsPatched = fileContains(jsPath, 'pubkey: r') || fileContains(jsPath, 'pubkey:r');
  const cjsPatched = fileContains(cjsPath, 'pubkey: r') || fileContains(cjsPath, 'pubkey:r');
  const typesPatched = /comment: string;\r?\n    pubkey: string;\r?\n\};/.test(types);

  return jsPatched && cjsPatched && typesPatched;
}

function applyCashuKymPatch() {
  const packageRoot = path.join(root, 'node_modules', 'cashu-kym', 'dist', 'main');
  const jsPath = path.join(packageRoot, 'index.js');
  const cjsPath = path.join(packageRoot, 'index.cjs');
  const dtsPath = path.join(packageRoot, 'index.d.ts');

  if (!fs.existsSync(packageRoot) || isCashuKymPatchApplied()) {
    return;
  }

  const desiredJs = `function bl(e, r) {
  const t = e.match(/^\\s*\\[(\\d+)\\/(\\d+)\\]\\s*(.*)$/);
  if (!t) return null;
  const n = parseInt(t[1], 10), o = parseInt(t[2], 10), s = t[3] ?? "";
  return !Number.isFinite(n) || n < 0 || n > 5 || o !== 5 ? null : { score: n, comment: s, pubkey: r };
}
function ml(`;

  const desiredCjs =
    'function bl(e,r){const t=e.match(/^\\s*\\[(\\d+)\\/(\\d+)\\]\\s*(.*)$/);if(!t)return null;const n=parseInt(t[1],10),o=parseInt(t[2],10),s=t[3]??"";return!Number.isFinite(n)||n<0||n>5||o!==5?null:{score:n,comment:s,pubkey:r}}function ml(';

  const desiredTypes = `declare type MintRecommendation = {
    score: number;
    comment: string;
    pubkey: string;
};`;

  updateFile(jsPath, (text) => {
    let next = replaceRegexOrThrow(
      text,
      /function bl\([\s\S]*?\n}\nfunction ml\(/,
      desiredJs,
      jsPath
    );
    next = replaceOrThrow(
      next,
      'const i = bl(o.content);',
      'const i = bl(o.content, o.pubkey);',
      jsPath
    );
    return next;
  });

  updateFile(cjsPath, (text) => {
    let next = replaceRegexOrThrow(
      text,
      /function bl\([\s\S]*?\}function ml\(/,
      desiredCjs,
      cjsPath
    );
    next = replaceOrThrow(
      next,
      'const i=bl(o.content);',
      'const i=bl(o.content,o.pubkey);',
      cjsPath
    );
    return next;
  });

  updateFile(dtsPath, (text) => {
    const partiallyPatched =
      /declare type MintRecommendation = \{\r?\n    score: number;\r?\n    comment: string;\r?\n\};\r?\n\s*pubkey: string;/;

    if (partiallyPatched.test(text)) {
      return text.replace(partiallyPatched, desiredTypes);
    }

    return replaceRegexOrThrow(
      text,
      /declare type MintRecommendation = \{\r?\n    score: number;\r?\n    comment: string;\r?\n\};/,
      desiredTypes,
      dtsPath
    );
  });

  if (!isCashuKymPatchApplied()) {
    throw new Error('cashu-kym patch did not apply cleanly');
  }

  console.log('Applied cashu-kym patch with targeted script');
}

function skipPatch(patchPath, suffix, message) {
  const skippedPath = `${patchPath}.${suffix}`;
  if (!fs.existsSync(patchPath)) return;

  fs.renameSync(patchPath, skippedPath);
  skippedPatches.push([skippedPath, patchPath]);
  console.log(message);
}

try {
  applyCashuKymPatch();
  skipPatch(cashuKymPatchPath, 'skip-scripted', 'Skipping cashu-kym patch-package file');

  const result = fs.existsSync(patchPackageEntry)
    ? spawnSync(
        process.execPath,
        ['--preserve-symlinks', '--preserve-symlinks-main', patchPackageEntry, '--error-on-fail'],
        {
          cwd: root,
          env: process.env,
          stdio: 'inherit',
        }
      )
    : spawnSync('patch-package', ['--error-on-fail'], {
        cwd: root,
        env: process.env,
        stdio: 'inherit',
      });

  if (result.status !== 0) {
    exitCode = result.status ?? 1;
  }
} finally {
  for (const [skippedPath, patchPath] of skippedPatches.reverse()) {
    if (fs.existsSync(skippedPath)) {
      fs.renameSync(skippedPath, patchPath);
    }
  }
}

if (exitCode !== 0) {
  process.exit(exitCode);
}
