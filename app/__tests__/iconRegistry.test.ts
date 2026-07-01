import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import ts from 'typescript';

type IconReference = {
  name: string;
  location: string;
  raw: string;
};

const ROOT = process.cwd();
const SOURCE_ROOTS = ['app', 'features', 'shared', 'navigation', 'config', 'assets'];
// Wallet-package action variants are rendered by app UI through ActionMenuButton,
// but their icon names live in the package source instead of app-owned files.
// The wallet package is an in-repo workspace member at <repo>/wallet (ROOT is
// the app package dir), so read its source directly rather than via node_modules.
const RUNTIME_ICON_SOURCE_FILES = [
  path.join(ROOT, '..', 'wallet', 'src', 'screen-actions', 'availability.ts'),
];
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_PATH_PARTS = new Set(['node_modules', '.monicon', 'ios', 'android']);
const ICON_NAME_PATTERN = /^([a-z0-9][a-z0-9-]*):([a-z0-9][a-z0-9_.-]*)$/i;
const POPUP_ICON_PATTERN = /^icon:([a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9_.-]*)$/i;
const ICON_PROPERTY_NAMES = new Set([
  'actionIcon',
  'cornerIcon',
  'icon',
  'iconName',
  'inactiveIcon',
  'leftIcon',
  'overlayIcon',
  'rightIcon',
  'selectedIcon',
  'suffixIcon',
]);

const packageJson = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>;
};
const iconifyDependencyNames = Object.keys(packageJson.devDependencies ?? {}).filter((dependency) =>
  dependency.startsWith('@iconify-json/')
);
const registrySource = readFileSync(path.join(ROOT, '.monicon', 'icons.js'), 'utf8');
const registryJson = registrySource.match(/module\.exports = ([\s\S]*);\s*$/)?.[1];
if (!registryJson) throw new Error('Could not parse .monicon/icons.js');

const registry = JSON.parse(registryJson) as Record<string, unknown>;
const registryNames = new Set(Object.keys(registry));
const iconPrefixes = new Set<string>(['internal']);

for (const dependency of iconifyDependencyNames) {
  if (dependency.startsWith('@iconify-json/')) {
    iconPrefixes.add(dependency.slice('@iconify-json/'.length));
  }
}

for (const name of registryNames) {
  const [prefix] = name.split(':');
  if (prefix) iconPrefixes.add(prefix);
}

function walk(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const relativeParts = path.relative(ROOT, fullPath).split(path.sep);
    if (relativeParts.some((part) => IGNORED_PATH_PARTS.has(part))) continue;

    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walk(fullPath, files);
    } else if (EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }

  return files;
}

function getLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${path.relative(ROOT, sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`;
}

function findIconsArray(sourceFile: ts.SourceFile): ts.ArrayLiteralExpression {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === 'icons' &&
        declaration.initializer &&
        ts.isArrayLiteralExpression(declaration.initializer)
      ) {
        return declaration.initializer;
      }
    }
  }

  throw new Error('Could not find icons array in assets/icons/index.tsx');
}

function collectRegisteredIconNames(): string[] {
  const sourceFile = ts.createSourceFile(
    path.join(ROOT, 'assets', 'icons', 'index.tsx'),
    readFileSync(path.join(ROOT, 'assets', 'icons', 'index.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );

  return findIconsArray(sourceFile)
    .elements.filter((element) => ts.isStringLiteralLike(element))
    .map((element) => element.text);
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  return null;
}

function isIconJsxAttribute(attribute: ts.JsxAttribute): boolean {
  const attributeName = ts.isIdentifier(attribute.name) ? attribute.name.text : null;
  if (attributeName === 'name') {
    const openingElement = attribute.parent.parent;
    return ts.isIdentifier(openingElement.tagName) && openingElement.tagName.text === 'Icon';
  }

  return attributeName === 'icon';
}

function isIconLiteralContext(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (ts.isJsxAttribute(current)) {
      return isIconJsxAttribute(current);
    }

    if (ts.isPropertyAssignment(current)) {
      const name = propertyNameText(current.name);
      return name !== null && ICON_PROPERTY_NAMES.has(name);
    }

    current = current.parent;
  }

  return false;
}

function isInsideRegisteredIconsArray(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;

  while (current) {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.name.text === 'icons'
    ) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function iconNameFromLiteral(value: string, node: ts.Node): string | null {
  const popupIcon = value.match(POPUP_ICON_PATTERN);
  if (popupIcon) return popupIcon[1] ?? null;

  const iconName = value.match(ICON_NAME_PATTERN);
  if (!iconName) return null;

  const prefix = iconName[1];
  return prefix && (iconPrefixes.has(prefix) || isIconLiteralContext(node)) ? value : null;
}

function collectIconReferences(): IconReference[] {
  const references: IconReference[] = [];
  const sourceFiles = SOURCE_ROOTS.flatMap((sourceRoot) => walk(path.join(ROOT, sourceRoot)));

  for (const file of [...sourceFiles, ...RUNTIME_ICON_SOURCE_FILES]) {
    if (!existsSync(file)) {
      throw new Error(`Icon source file does not exist: ${path.relative(ROOT, file)}`);
    }

    const text = readFileSync(file, 'utf8');
    const kind =
      file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);

    function visit(node: ts.Node): void {
      const literal =
        ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
      if (literal && !isInsideRegisteredIconsArray(node)) {
        const name = iconNameFromLiteral(literal, node);
        if (name) references.push({ name, location: getLocation(sourceFile, node), raw: literal });
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return references;
}

describe('Monicon registry', () => {
  it('contains every icon literal used by app and runtime UI sources', () => {
    const missing = collectIconReferences()
      .filter((reference) => !registryNames.has(reference.name))
      .map((reference) => `${reference.name} from ${reference.location} (${reference.raw})`);

    expect(missing).toEqual([]);
  });

  it('generates every registered Iconify icon and does not keep unused allowlist entries', () => {
    const registeredIconNames = collectRegisteredIconNames();
    const duplicateNames = registeredIconNames.filter(
      (name, index) => registeredIconNames.indexOf(name) !== index
    );
    const usedNames = new Set(collectIconReferences().map((reference) => reference.name));

    const missingGeneratedIcons = registeredIconNames.filter((name) => !registryNames.has(name));
    const unusedRegisteredIcons = registeredIconNames.filter((name) => !usedNames.has(name));
    const unusedGeneratedIcons = [...registryNames].filter((name) => !usedNames.has(name));

    expect(duplicateNames).toEqual([]);
    expect(missingGeneratedIcons).toEqual([]);
    expect(unusedRegisteredIcons).toEqual([]);
    expect(unusedGeneratedIcons).toEqual([]);
  });

  it('keeps installed Iconify collections aligned with registered icon prefixes', () => {
    const registeredIconifyPrefixes = new Set(
      collectRegisteredIconNames()
        .map((name) => name.split(':')[0])
        .filter(Boolean)
    );
    const installedIconifyPrefixes = new Set(
      iconifyDependencyNames.map((dependency) => dependency.slice('@iconify-json/'.length))
    );

    const unusedInstalledCollections = [...installedIconifyPrefixes].filter(
      (prefix) => !registeredIconifyPrefixes.has(prefix)
    );
    const missingInstalledCollections = [...registeredIconifyPrefixes].filter(
      (prefix) => !installedIconifyPrefixes.has(prefix)
    );

    expect(unusedInstalledCollections).toEqual([]);
    expect(missingInstalledCollections).toEqual([]);
  });
});
