/**
 * @jest-environment node
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', '.expo', '.next', 'android', 'coverage', 'ios', 'node_modules']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const REQUIRED_LIST_PROPS = [
  'onItemSizeChanged',
  'onLoad',
  'onMetricsChange',
  'onStickyHeaderChange',
  'onViewableItemsChanged',
  'viewabilityConfig',
] as const;

type SourceFile = {
  path: string;
  source: string;
};

type LegendListCallSite = SourceFile & {
  line: number;
  tagText: string;
};

type ActivityIndicatorCallSite = SourceFile & {
  line: number;
  wrappedByVisualLayoutProbe: boolean;
};

type FlatListCallSite = SourceFile & {
  line: number;
  tagText: string;
};

function walkSourceFiles(dir: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkSourceFiles(path.join(dir, entry.name), files);
      }
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function isLegendListElementName(tagName: ts.JsxTagNameExpression): boolean {
  return (
    ts.isIdentifier(tagName) &&
    (tagName.text === 'LegendList' || tagName.text === 'AnimatedLegendList')
  );
}

function jsxElementName(tagName: ts.JsxTagNameExpression): string | null {
  if (ts.isIdentifier(tagName)) return tagName.text;
  if (ts.isPropertyAccessExpression(tagName)) return tagName.name.text;
  return null;
}

function collectLegendListCallSites(filePath: string): LegendListCallSite[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const callSites: LegendListCallSite[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      isLegendListElementName(node.tagName)
    ) {
      callSites.push({
        path: filePath,
        source,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        tagText: source.slice(node.getStart(sourceFile), node.end),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return callSites;
}

function collectActivityIndicatorCallSites(filePath: string): ActivityIndicatorCallSite[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const callSites: ActivityIndicatorCallSite[] = [];
  const elementStack: string[] = [];

  function pushCallSite(node: ts.JsxSelfClosingElement | ts.JsxOpeningElement): void {
    callSites.push({
      path: filePath,
      source,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      wrappedByVisualLayoutProbe: elementStack.includes('VisualLayoutProbe'),
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node)) {
      const name = jsxElementName(node.openingElement.tagName);
      if (name === 'ActivityIndicator') {
        pushCallSite(node.openingElement);
      }
      if (name) elementStack.push(name);
      for (const child of node.children) {
        visit(child);
      }
      if (name) elementStack.pop();
      return;
    }

    if (ts.isJsxSelfClosingElement(node) && jsxElementName(node.tagName) === 'ActivityIndicator') {
      pushCallSite(node);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return callSites;
}

function collectFlatListCallSites(filePath: string): FlatListCallSite[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const callSites: FlatListCallSite[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      jsxElementName(node.tagName) === 'FlatList'
    ) {
      callSites.push({
        path: filePath,
        source,
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        tagText: source.slice(node.getStart(sourceFile), node.end),
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return callSites;
}

function legendListCallSites(): LegendListCallSite[] {
  return walkSourceFiles(ROOT).flatMap(collectLegendListCallSites);
}

function activityIndicatorCallSites(): ActivityIndicatorCallSite[] {
  return walkSourceFiles(ROOT).flatMap(collectActivityIndicatorCallSites);
}

function flatListCallSites(): FlatListCallSite[] {
  return walkSourceFiles(ROOT).flatMap(collectFlatListCallSites);
}

function relative(filePath: string): string {
  return path.relative(ROOT, filePath);
}

function siteLabel(site: { path: string; line: number }): string {
  return `${relative(site.path)}:${site.line}`;
}

function hasJsxProp(tagText: string, prop: string): boolean {
  return new RegExp(`\\b${prop}\\s*=`).test(tagText);
}

describe('visual layout telemetry coverage', () => {
  it('keeps each direct LegendList element wired into visual list telemetry', () => {
    const missing = legendListCallSites()
      .map((site) => ({
        site,
        missingProps: REQUIRED_LIST_PROPS.filter((prop) => !hasJsxProp(site.tagText, prop)),
      }))
      .filter(({ missingProps }) => missingProps.length > 0);

    expect(
      missing.map(
        ({ site, missingProps }) => `${siteLabel(site)} missing ${missingProps.join(', ')}`
      )
    ).toEqual([]);
  });

  it('keeps direct LegendList row files measurable by visual layout probes', () => {
    const missing = legendListCallSites().filter((site) => {
      return !site.source.includes('VisualLayoutProbe');
    });

    expect(missing.map(siteLabel)).toEqual([]);
  });

  it('keeps direct LegendList files wired to virtual position state snapshots', () => {
    const missing = legendListCallSites().filter((site) => {
      return !site.source.includes('getListState');
    });

    expect(missing.map(siteLabel)).toEqual([]);
  });

  it('keeps direct native activity indicators wrapped by visual layout probes', () => {
    const missing = activityIndicatorCallSites().filter((site) => !site.wrappedByVisualLayoutProbe);

    expect(missing.map(siteLabel)).toEqual([]);
  });

  it('keeps feed FlatLists wired into visual viewability telemetry', () => {
    const missing = flatListCallSites()
      .filter((site) => relative(site.path).startsWith('features/feed/'))
      .map((site) => ({
        site,
        missingProps: ['viewabilityConfig', 'onViewableItemsChanged'].filter(
          (prop) => !hasJsxProp(site.tagText, prop)
        ),
      }))
      .filter(({ missingProps }) => missingProps.length > 0);

    expect(
      missing.map(
        ({ site, missingProps }) => `${siteLabel(site)} missing ${missingProps.join(', ')}`
      )
    ).toEqual([]);
  });

  it('keeps feed FlatLists backed by visual list loggers', () => {
    const missing = flatListCallSites().filter((site) => {
      return (
        relative(site.path).startsWith('features/feed/') &&
        !site.source.includes('useVisualListLogger')
      );
    });

    expect(missing.map(siteLabel)).toEqual([]);
  });

  it('keeps shared status indicators measurable without double-logging Spinner internals', () => {
    const loadingIndicator = fs.readFileSync(
      path.join(ROOT, 'shared/blocks/status/LoadingIndicator.tsx'),
      'utf8'
    );
    const spinner = fs.readFileSync(path.join(ROOT, 'shared/ui/primitives/Spinner.tsx'), 'utf8');

    expect(loadingIndicator).toContain('useVisualLayoutLogger');
    expect(loadingIndicator).toContain("itemType: 'status-indicator'");
    expect(spinner).toContain('visualDisabled');
  });

  it('keeps shared loading placeholders measurable', () => {
    const text = fs.readFileSync(path.join(ROOT, 'shared/ui/primitives/Text.tsx'), 'utf8');
    const avatar = fs.readFileSync(path.join(ROOT, 'shared/ui/primitives/Avatar.tsx'), 'utf8');

    expect(text).toContain('useVisualLayoutLogger');
    expect(text).toContain("itemType: 'text-loading'");
    expect(text).toContain('collapsable={false}');
    expect(avatar).toContain('useVisualLayoutLogger');
    expect(avatar).toContain("itemType: 'avatar-loading'");
    expect(avatar).toContain('collapsable={false}');
  });

  it('keeps composer ScrollViews wired into visual scroll metrics', () => {
    const composer = fs.readFileSync(
      path.join(ROOT, 'features/composer/ui/PostComposer.tsx'),
      'utf8'
    );

    expect(composer).toContain('useVisualScrollMetricsLogger');
    expect(composer).toContain("component: 'PostComposerScrollView'");
    expect(composer).toContain("component: 'PostComposerMediaTrayScrollView'");
    expect(composer).toContain('onContentSizeChange={composerScrollMetrics.onContentSizeChange}');
    expect(composer).toContain('onScroll={composerScrollMetrics.onScroll}');
    expect(composer).toContain('onContentSizeChange={mediaTrayScrollMetrics.onContentSizeChange}');
    expect(composer).toContain('onScroll={mediaTrayScrollMetrics.onScroll}');
  });

  it('keeps horizontal visual rails wired into scroll metrics', () => {
    const recentPeople = fs.readFileSync(
      path.join(ROOT, 'features/feed/components/RecentPeopleSearchStrip.tsx'),
      'utf8'
    );
    const sectionAnchorList = fs.readFileSync(
      path.join(ROOT, 'shared/ui/composed/SectionAnchorList.tsx'),
      'utf8'
    );

    expect(recentPeople).toContain('useVisualScrollMetricsLogger');
    expect(recentPeople).toContain("component: 'RecentPeopleSearchStripScrollView'");
    expect(recentPeople).toContain('onLayout={handleStripLayout}');
    expect(recentPeople).toContain('onContentSizeChange={handleStripContentSizeChange}');
    expect(recentPeople).toContain('reportStripScroll(event)');
    expect(sectionAnchorList).toContain('useVisualScrollMetricsLogger');
    expect(sectionAnchorList).toContain("component: 'SectionAnchorListAnchorScrollView'");
    expect(sectionAnchorList).toContain('onLayout={anchorScrollMetrics.onLayout}');
    expect(sectionAnchorList).toContain(
      'onContentSizeChange={anchorScrollMetrics.onContentSizeChange}'
    );
    expect(sectionAnchorList).toContain('onScroll={anchorScrollMetrics.onScroll}');
  });

  it('keeps profile surfaces wired into visual state-change snapshots', () => {
    const userFeed = fs.readFileSync(
      path.join(ROOT, 'features/feed/components/UserFeed.tsx'),
      'utf8'
    );
    const profileScreen = fs.readFileSync(
      path.join(ROOT, 'features/user/screens/UserProfileScreen.tsx'),
      'utf8'
    );

    expect(userFeed).toContain('useVisualStateLogger');
    expect(userFeed).toContain("stateKey: 'user-feed-state'");
    expect(userFeed).toContain("reason: 'user-feed-state'");
    expect(profileScreen).toContain('useVisualStateLogger');
    expect(profileScreen).toContain("stateKey: 'profile-state'");
    expect(profileScreen).toContain("reason: 'profile-state'");
  });

  it('keeps visual probes reporting style stack context', () => {
    const probe = fs.readFileSync(
      path.join(ROOT, 'shared/ui/composed/VisualLayoutProbe.tsx'),
      'utf8'
    );
    const contentShiftLog = fs.readFileSync(
      path.join(ROOT, 'shared/lib/contentShiftLog.ts'),
      'utf8'
    );

    expect(probe).toContain('StyleSheet.flatten');
    expect(probe).toContain('stylePosition');
    expect(probe).toContain('styleZIndex');
    expect(probe).toContain('styleElevation');
    expect(probe).toContain('pointerEvents');
    expect(contentShiftLog).toContain('mountOrder');
    expect(contentShiftLog).toContain('outsideContainer');
    expect(contentShiftLog).toContain('containerViolationCount');
    expect(contentShiftLog).toContain('visual.layout.virtual_positions');
  });
});
