import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const appRoot = path.resolve(__dirname, '..');
const excluded = new Set(['node_modules', '.git', '.expo', 'android', 'ios', 'vendor', 'e2e']);

function sourceFiles(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || excluded.has(entry.name)) return [];
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}

function marketingImports(source: string, file: string): string[] {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const check = (node: ts.Node | undefined) => {
    if (!node) return;
    const value = ts.isStringLiteralLike(node) ? node.text : node.getText(ast);
    if (/(^|[/\\])marketing([/\\]|$)/.test(value)) found.push(value);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) check(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      check(node.moduleReference.expression);
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(ast);
      if (['import', 'require', 'require.resolve', 'require.context'].includes(callee)) {
        check(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

test('marketing source and generated artwork never enter the app import graph', () => {
  const violations = sourceFiles(appRoot).flatMap((file) =>
    marketingImports(fs.readFileSync(file, 'utf8'), file).map(
      (specifier) => `${path.relative(appRoot, file)}: ${specifier}`
    )
  );
  expect(violations).toEqual([]);
});

test('the guard recognizes static, dynamic, CommonJS and re-export paths', () => {
  const source = [
    "import art from '../../marketing/artwork/generated/wallet/wide.png';",
    "export { art } from '../marketing/art';",
    "const art = require('../../marketing/art.png');",
    "void import('../../marketing/art');",
  ].join('\n');
  expect(marketingImports(source, 'fixture.ts')).toHaveLength(4);
  expect(marketingImports('// import "../marketing/ignored";', 'fixture.ts')).toEqual([]);
});
