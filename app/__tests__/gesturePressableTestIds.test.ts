import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// react-native-gesture-handler 2.32's iOS button moves testID onto an inner
// view and clears it from the wrapper the accessibility tree exposes. Rows
// built on it keep their label but lose their e2e selector (drawer-menu-*),
// which broke every capture scenario on a fresh native build.
const appRoot = path.resolve(__dirname, '..');
const excluded = new Set([
  'node_modules',
  '.git',
  '.expo',
  'android',
  'ios',
  'vendor',
  'e2e',
  '__tests__',
]);

function sourceFiles(folder: string): string[] {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink() || excluded.has(entry.name)) return [];
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}

function importsGesturePressable(source: string, file: string): boolean {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return ast.statements.some((node) => {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return false;
    if (node.moduleSpecifier.text !== 'react-native-gesture-handler') return false;
    const bindings = node.importClause?.namedBindings;
    return (
      !!bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some(
        (element) => (element.propertyName ?? element.name).text === 'Pressable'
      )
    );
  });
}

describe('e2e-visible pressables', () => {
  it('detects a gesture-handler Pressable import', () => {
    expect(
      importsGesturePressable(
        "import { Pressable as P } from 'react-native-gesture-handler';",
        'x.tsx'
      )
    ).toBe(true);
    expect(
      importsGesturePressable(
        "import { GestureHandlerRootView } from 'react-native-gesture-handler';",
        'x.tsx'
      )
    ).toBe(false);
  });

  it('app UI never uses the gesture-handler Pressable', () => {
    const offenders = sourceFiles(appRoot).filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return (
        source.includes('react-native-gesture-handler') && importsGesturePressable(source, file)
      );
    });
    expect(offenders.map((file) => path.relative(appRoot, file))).toEqual([]);
  });
});
