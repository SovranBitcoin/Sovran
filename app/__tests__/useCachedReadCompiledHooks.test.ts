/**
 * The React Compiler recognises hooks by NAME. `useCachedRead` once subscribed
 * through `store.use(selector)`, which the compiler treated as a plain call and
 * memoised behind `$[i] === previousKey` — the hook was skipped on re-render
 * and every screen on the read lifecycle crashed with "change in the order of
 * Hooks" (MintReviewsScreen, 2026-09-13). Jest does not run the compiler, so
 * this test compiles the hook the way Metro does and asserts that no hook call
 * ends up inside a conditional (cache) branch.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as babel from '@babel/core';

const FILE = path.resolve(__dirname, '../shared/lib/read/useCachedRead.ts');
const HOOK = /^use[A-Z0-9]/;

function hookName(
  callee: babel.types.Expression | babel.types.V8IntrinsicIdentifier
): string | null {
  if (callee.type === 'Identifier' && HOOK.test(callee.name)) return callee.name;
  if (
    callee.type === 'MemberExpression' &&
    callee.property.type === 'Identifier' &&
    HOOK.test(callee.property.name)
  )
    return callee.property.name;
  return null;
}

it('keeps every hook call unconditional after the React Compiler runs', () => {
  const result = babel.transformSync(readFileSync(FILE, 'utf8'), {
    filename: FILE,
    ast: true,
    code: false,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [
      ['babel-plugin-react-compiler', { panicThreshold: 'none', compilationMode: 'infer' }],
    ],
  });
  expect(result?.ast).toBeTruthy();

  const conditional: string[] = [];
  const seen: string[] = [];
  babel.traverse(result!.ast!, {
    CallExpression(p) {
      const name = hookName(p.node.callee);
      if (!name) return;
      seen.push(name);
      if (
        p.findParent(
          (a) => a.isIfStatement() || a.isConditionalExpression() || a.isLogicalExpression()
        )
      )
        conditional.push(name);
    },
  });
  // The compiler ran (memo cache present) and the subscriptions are still hooks.
  expect(seen).toContain('useStore');
  expect(conditional).toEqual([]);
});
