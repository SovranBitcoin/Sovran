#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

class FunctionTreeGenerator {
  constructor(options = {}) {
    this.options = {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
      ignorePatterns: ['node_modules', '.git', 'dist', 'build', '.next'],
      maxDepth: 10,
      ...options,
    };
  }

  // Check if file should be processed
  shouldProcessFile(filePath) {
    const ext = path.extname(filePath);
    if (!this.options.extensions.includes(ext)) return false;

    const relativePath = path.relative(process.cwd(), filePath);
    return !this.options.ignorePatterns.some((pattern) => relativePath.includes(pattern));
  }

  // Get all files recursively
  getAllFiles(dirPath, depth = 0) {
    if (depth > this.options.maxDepth) return [];

    const files = [];
    try {
      const items = fs.readdirSync(dirPath);

      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (!this.options.ignorePatterns.some((pattern) => item.includes(pattern))) {
            files.push(...this.getAllFiles(fullPath, depth + 1));
          }
        } else if (this.shouldProcessFile(fullPath)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }

    return files;
  }

  // Extract import statements from a file
  extractImports(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      const imports = [];

      const visit = (node) => {
        if (ts.isImportDeclaration(node)) {
          const importInfo = this.processImportNode(node, sourceFile);
          if (importInfo) {
            imports.push(importInfo);
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
      return imports;
    } catch (error) {
      console.warn(`Warning: Could not parse imports from ${filePath}: ${error.message}`);
      return [];
    }
  }

  // Process import node and extract metadata
  processImportNode(node, sourceFile) {
    const moduleSpecifier = node.moduleSpecifier.text;
    const lineRange = this.getLineRange(node, sourceFile);

    // Handle different import types
    if (node.importClause) {
      const namedImports = [];
      const defaultImport = node.importClause.name ? node.importClause.name.text : null;

      // Handle named imports
      if (node.importClause.namedBindings) {
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          node.importClause.namedBindings.elements.forEach((element) => {
            namedImports.push({
              name: element.name.text,
              alias: element.propertyName ? element.propertyName.text : null,
            });
          });
        } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          namedImports.push({
            name: '*',
            alias: node.importClause.namedBindings.name.text,
          });
        }
      }

      return {
        moduleSpecifier,
        defaultImport,
        namedImports,
        lineRange,
        type: 'import',
      };
    }

    return {
      moduleSpecifier,
      defaultImport: null,
      namedImports: [],
      lineRange,
      type: 'import',
    };
  }

  // Parse TypeScript/JavaScript file and extract functions
  extractFunctions(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      const functions = [];

      const visit = (node, parentFunction = null) => {
        let currentFunction = null;

        // Function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          currentFunction = this.processFunctionNode(node, sourceFile, parentFunction);
          functions.push(currentFunction);
        }
        // Arrow functions assigned to variables
        else if (
          ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
          currentFunction = this.processVariableFunctionNode(node, sourceFile, parentFunction);
          functions.push(currentFunction);
        }
        // Method declarations in classes
        else if (ts.isMethodDeclaration(node)) {
          currentFunction = this.processFunctionNode(node, sourceFile, parentFunction);
          functions.push(currentFunction);
        }

        // Continue visiting children, passing the current function as parent if it exists
        const nextParent = currentFunction || parentFunction;
        ts.forEachChild(node, (child) => visit(child, nextParent));
      };

      visit(sourceFile);
      return { functions, totalLines: content.split('\n').length };
    } catch (error) {
      console.warn(`Warning: Could not parse ${filePath}: ${error.message}`);
      return { functions: [], totalLines: 0 };
    }
  }

  // Process function node and extract metadata
  processFunctionNode(node, sourceFile, parentFunction = null) {
    const name = node.name ? node.name.text : 'anonymous';
    const params = this.extractParameters(node);
    const returnType = this.extractReturnType(node);
    const description = this.extractJSDocDescription(node);
    const lineRange = this.getLineRange(node, sourceFile);

    return {
      name,
      params,
      returnType,
      description,
      lineRange,
      parentFunction: parentFunction ? parentFunction.name : null,
      depth: parentFunction ? (parentFunction.depth || 0) + 1 : 0,
    };
  }

  // Process variable function node (arrow functions, function expressions)
  processVariableFunctionNode(node, sourceFile, parentFunction = null) {
    const name = node.name ? node.name.text : 'anonymous';
    const funcNode = node.initializer;
    const params = this.extractParameters(funcNode);
    const returnType = this.extractReturnType(funcNode);
    const description = this.extractJSDocDescription(node);
    const lineRange = this.getLineRange(node, sourceFile);

    return {
      name,
      params,
      returnType,
      description,
      lineRange,
      parentFunction: parentFunction ? parentFunction.name : null,
      depth: parentFunction ? (parentFunction.depth || 0) + 1 : 0,
    };
  }

  // Extract function parameters
  extractParameters(node) {
    if (!node.parameters) return [];

    return node.parameters.map((param) => {
      const name = param.name.text || param.name.escapedText;
      const type = param.type ? this.getTypeText(param.type) : 'any';
      const optional = !!param.questionToken;
      const defaultValue = param.initializer ? '...' : null;

      return {
        name,
        type,
        optional,
        defaultValue,
      };
    });
  }

  // Extract return type
  extractReturnType(node) {
    if (node.type) {
      return this.getTypeText(node.type);
    }

    // Try to infer from JSDoc
    const jsDocTags = ts.getJSDocTags(node);
    const returnTag = jsDocTags.find(
      (tag) => tag.tagName.text === 'returns' || tag.tagName.text === 'return'
    );
    if (returnTag && returnTag.comment) {
      return returnTag.comment;
    }

    return 'void';
  }

  // Get type text from TypeScript type node
  getTypeText(typeNode) {
    switch (typeNode.kind) {
      case ts.SyntaxKind.StringKeyword:
        return 'string';
      case ts.SyntaxKind.NumberKeyword:
        return 'number';
      case ts.SyntaxKind.BooleanKeyword:
        return 'boolean';
      case ts.SyntaxKind.VoidKeyword:
        return 'void';
      case ts.SyntaxKind.AnyKeyword:
        return 'any';
      case ts.SyntaxKind.TypeReference:
        return typeNode.typeName.text || typeNode.typeName.right?.text || 'unknown';
      case ts.SyntaxKind.ArrayType:
        return `${this.getTypeText(typeNode.elementType)}[]`;
      case ts.SyntaxKind.UnionType:
        return typeNode.types.map((t) => this.getTypeText(t)).join(' | ');
      default:
        return 'unknown';
    }
  }

  // Extract JSDoc description
  extractJSDocDescription(node) {
    const jsDocComments = ts.getJSDocCommentsAndTags(node);
    for (const comment of jsDocComments) {
      if (ts.isJSDoc(comment) && comment.comment) {
        return typeof comment.comment === 'string'
          ? comment.comment
          : comment.comment.map((part) => part.text || part).join('');
      }
    }
    return null;
  }

  // Get line range for a function
  getLineRange(node, sourceFile) {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    return {
      start: start.line + 1, // TypeScript uses 0-based line numbers
      end: end.line + 1,
    };
  }

  // Format parameters for display
  formatParameters(params) {
    if (params.length === 0) return '()';

    const formatted = params
      .map((param) => {
        let result = param.name;
        if (param.optional) result += '?';
        result += `: ${param.type}`;
        if (param.defaultValue) result += ` = ${param.defaultValue}`;
        return result;
      })
      .join(', ');

    return `(${formatted})`;
  }

  // Format import for display
  formatImport(importInfo) {
    const parts = [];

    if (importInfo.defaultImport) {
      parts.push(importInfo.defaultImport);
    }

    if (importInfo.namedImports.length > 0) {
      const namedParts = importInfo.namedImports.map((named) => {
        if (named.name === '*') {
          return `* as ${named.alias}`;
        }
        return named.alias ? `${named.name} as ${named.alias}` : named.name;
      });
      parts.push(`{ ${namedParts.join(', ')} }`);
    }

    const importStr = parts.length > 0 ? parts.join(', ') : 'default';
    return `${importStr} (${importInfo.moduleSpecifier})`;
  }

  // Get installed packages from package.json
  getInstalledPackages(rootDir = process.cwd()) {
    try {
      const packageJsonPath = path.join(rootDir, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

      const allDeps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
        ...(packageJson.peerDependencies || {}),
        ...(packageJson.optionalDependencies || {}),
      };

      return Object.keys(allDeps);
    } catch (error) {
      console.warn(`Warning: Could not read package.json: ${error.message}`);
      return [];
    }
  }

  // Extract icons from metro config
  getConfiguredIcons(rootDir = process.cwd()) {
    try {
      // Always look for metro.config.js in the project root, not the analyzed directory
      const projectRoot = process.cwd();
      const metroConfigPath = path.join(projectRoot, 'metro.config.js');
      const metroConfig = fs.readFileSync(metroConfigPath, 'utf8');

      // Extract icons array from metro config using regex
      const iconsMatch = metroConfig.match(/icons:\s*\[([\s\S]*?)\]/);
      if (!iconsMatch) {
        console.warn('Warning: Could not find icons array in metro.config.js');
        return [];
      }

      const iconsContent = iconsMatch[1];
      const iconMatches = iconsContent.match(/'([^']+)'/g);

      if (!iconMatches) {
        return [];
      }

      return iconMatches.map((match) => match.slice(1, -1)); // Remove quotes
    } catch (error) {
      console.warn(`Warning: Could not read metro.config.js: ${error.message}`);
      return [];
    }
  }

  // Search for icon usage in file content
  findIconUsage(content) {
    const iconUsages = [];

    // Pattern 1: name="icon-name" (quoted strings)
    const quotedPattern = /name=["']([^"']+)["']/g;
    let match;
    while ((match = quotedPattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'quoted',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2: name={icon} (variable references)
    const variablePattern = /name=\{([^}]+)\}/g;
    while ((match = variablePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'variable',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2b: name={...} with multi-line content (handles cases where icon names are on separate lines)
    const multilineNamePattern = /name=\{[\s\S]*?['"]([^'"]+)['"][\s\S]*?\}/g;
    while ((match = multilineNamePattern.exec(content)) !== null) {
      // Only match if it contains an icon-like string (with colon)
      if (match[1].includes(':')) {
        iconUsages.push({
          icon: match[1],
          type: 'multiline-name',
          line: content.substring(0, match.index).split('\n').length,
        });
      }
    }

    // Pattern 2c: icon: 'icon-name' in ternary expressions (handles cases like icon: condition ? 'icon1' : 'icon2')
    const ternaryIconPattern = /icon:\s*[^?]+\?[^'"]+['"]([^'"]+)['"][^'"]+['"]([^'"]+)['"]/g;
    while ((match = ternaryIconPattern.exec(content)) !== null) {
      // Add both icons from the ternary
      iconUsages.push({
        icon: match[1],
        type: 'ternary',
        line: content.substring(0, match.index).split('\n').length,
      });
      iconUsages.push({
        icon: match[2],
        type: 'ternary',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c2: icon: 'icon-name' in ternary expressions (catches any icon in ternary, including same on both sides)
    const anyTernaryIconPattern = /icon:\s*[^?]*\?[^:]*['"]([^'"]+)['"]/g;
    while ((match = anyTernaryIconPattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'ternary-any',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c3: name={...} with ternary expressions (catches any icon in ternary within name={})
    const anyTernaryNamePattern = /name=\{[^}]*\?[^}]*['"]([^'"]+)['"]/gs;
    while ((match = anyTernaryNamePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'ternary-name-any',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c4: name={...} with ternary expressions (catches the first icon in ternary within name={})
    const firstTernaryNamePattern = /name=\{[^}]*\?[^:]*['"]([^'"]+)['"]/gs;
    while ((match = firstTernaryNamePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'ternary-name-first',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c5: name={...} with ternary expressions (catches the second icon in ternary within name={})
    const secondTernaryNamePattern = /name=\{[^}]*\?[^:]*['"][^'"]*['"][^:]*['"]([^'"]+)['"]/gs;
    while ((match = secondTernaryNamePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'ternary-name-second',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c6: icon: ... with ternary expressions (catches the second icon in ternary within icon:)
    const secondTernaryIconPattern = /icon:\s*[^?]*\?[^:]*['"][^'"]*['"][^:]*['"]([^'"]+)['"]/g;
    while ((match = secondTernaryIconPattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'ternary-icon-second',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c7: Comprehensive ternary pattern for any icon in ternary expressions (catches both sides)
    const comprehensiveTernaryPattern =
      /(?:icon|name):\s*[^?]+\?[^'"]+['"]([^'"]+)['"][^'"]+['"]([^'"]+)['"]/g;
    while ((match = comprehensiveTernaryPattern.exec(content)) !== null) {
      // Add both icons from the ternary
      iconUsages.push({
        icon: match[1],
        type: 'ternary-comprehensive',
        line: content.substring(0, match.index).split('\n').length,
      });
      iconUsages.push({
        icon: match[2],
        type: 'ternary-comprehensive',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c8: Simple ternary pattern for icon: (catches both sides)
    const simpleTernaryPattern = /icon:\s*[^?]+\?[^'"]+['"]([^'"]+)['"][^'"]+['"]([^'"]+)['"]/g;
    while ((match = simpleTernaryPattern.exec(content)) !== null) {
      // Add both icons from the ternary
      iconUsages.push({
        icon: match[1],
        type: 'ternary-simple',
        line: content.substring(0, match.index).split('\n').length,
      });
      iconUsages.push({
        icon: match[2],
        type: 'ternary-simple',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2c9: Simple ternary pattern for name={} (catches both sides)
    const simpleTernaryNamePattern =
      /name=\{[^}]+\?[^'"]+['"]([^'"]+)['"][^'"]+['"]([^'"]+)['"]\}/g;
    while ((match = simpleTernaryNamePattern.exec(content)) !== null) {
      // Add both icons from the ternary
      iconUsages.push({
        icon: match[1],
        type: 'ternary-name-simple',
        line: content.substring(0, match.index).split('\n').length,
      });
      iconUsages.push({
        icon: match[2],
        type: 'ternary-name-simple',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2d: name={...} with ternary expressions (handles cases like name={condition ? 'icon1' : 'icon2'})
    const ternaryNamePattern = /name=\{[^}]*\?[^}]*['"]([^'"]+)['"][^}]*['"]([^'"]+)['"][^}]*\}/gs;
    while ((match = ternaryNamePattern.exec(content)) !== null) {
      // Add both icons from the ternary
      iconUsages.push({
        icon: match[1],
        type: 'ternary-name',
        line: content.substring(0, match.index).split('\n').length,
      });
      iconUsages.push({
        icon: match[2],
        type: 'ternary-name',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 2d2: name={...} with ternary expressions where both sides are the same (handles cases like name={condition ? 'icon' : 'icon'})
    const sameTernaryNamePattern = /name=\{[^}]*\?[^}]*['"]([^'"]+)['"][^}]*['"]\1['"][^}]*\}/gs;
    while ((match = sameTernaryNamePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'ternary-name-same',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 3: icon="icon-name" (JSX props)
    const jsxIconPattern = /icon=["']([^"']+)["']/g;
    while ((match = jsxIconPattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'jsx-prop',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 4: icon: "icon-name" (in data structures)
    const dataStructurePattern = /icon:\s*["']([^"']+)["']/g;
    while ((match = dataStructurePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'data-structure',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 5: icon: 'icon-name' (single quotes in data structures)
    const dataStructureSinglePattern = /icon:\s*'([^']+)'/g;
    while ((match = dataStructureSinglePattern.exec(content)) !== null) {
      iconUsages.push({
        icon: match[1],
        type: 'data-structure',
        line: content.substring(0, match.index).split('\n').length,
      });
    }

    // Pattern 6: Variable assignment with ternary expression (catches icons in variable assignments)
    const variableAssignmentPattern = /=\s*[^?]+\?[^'"]+['"]([^'"]+)['"][^'"]+['"]([^'"]+)['"]/g;
    while ((match = variableAssignmentPattern.exec(content)) !== null) {
      // Only match if it contains an icon-like string (with colon)
      if (match[1].includes(':')) {
        iconUsages.push({
          icon: match[1],
          type: 'variable-assignment',
          line: content.substring(0, match.index).split('\n').length,
        });
      }
      if (match[2].includes(':')) {
        iconUsages.push({
          icon: match[2],
          type: 'variable-assignment',
          line: content.substring(0, match.index).split('\n').length,
        });
      }
    }

    return iconUsages;
  }

  // Analyze icon usage across all files
  analyzeIconUsage(rootDir = process.cwd()) {
    const files = this.getAllFiles(rootDir);
    const configuredIcons = this.getConfiguredIcons(rootDir);
    const iconUsage = {};
    const iconFiles = {};

    // Initialize all configured icons with 0 usage
    configuredIcons.forEach((icon) => {
      iconUsage[icon] = 0;
      iconFiles[icon] = [];
    });

    files.forEach((filePath) => {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const usages = this.findIconUsage(content);

        usages.forEach((usage) => {
          // Check if this is a configured icon
          if (configuredIcons.includes(usage.icon)) {
            iconUsage[usage.icon]++;
            iconFiles[usage.icon].push({
              file: path.relative(rootDir, filePath),
              line: usage.line,
              type: usage.type,
            });
          }
        });
      } catch (error) {
        // Skip files we can't read
      }
    });

    return { iconUsage, iconFiles, configuredIcons };
  }

  // Generate tree structure
  buildTree(rootDir = process.cwd()) {
    const files = this.getAllFiles(rootDir);
    const tree = {};
    const packageUsage = {};
    const installedPackages = this.getInstalledPackages(rootDir);

    files.forEach((filePath) => {
      const relativePath = path.relative(rootDir, filePath);
      const functionResult = this.extractFunctions(filePath);
      const imports = this.extractImports(filePath);

      // Track package usage
      imports.forEach((importInfo) => {
        const moduleSpecifier = importInfo.moduleSpecifier;

        // Only track node modules (not relative imports)
        if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/')) {
          // Extract package name (handle scoped packages like @types/react)
          const packageName = moduleSpecifier.split('/')[0];
          if (packageName.startsWith('@')) {
            // For scoped packages, include the scope
            const scopedPackage = moduleSpecifier.split('/').slice(0, 2).join('/');
            packageUsage[scopedPackage] = (packageUsage[scopedPackage] || 0) + 1;
          } else {
            packageUsage[packageName] = (packageUsage[packageName] || 0) + 1;
          }
        }
      });

      if (functionResult.functions.length > 0 || imports.length > 0) {
        tree[relativePath] = {
          functions: functionResult.functions,
          imports: imports,
          totalLines: functionResult.totalLines,
          functionCount: functionResult.functions.length,
          rootFunctionCount: functionResult.functions.filter((f) => f.depth === 0).length,
          importCount: imports.length,
        };
      }
    });

    // Find packages with 0 imports
    const unusedPackages = installedPackages.filter((pkg) => !packageUsage[pkg]);

    return { tree, packageUsage, unusedPackages };
  }

  // Render package usage summary
  renderPackageSummary(packageUsage) {
    const lines = [];
    const packages = Object.entries(packageUsage).sort(([, a], [, b]) => b - a); // Sort by usage count descending

    if (packages.length === 0) {
      return lines;
    }

    lines.push('\n📦 Package Usage Summary:');
    lines.push('='.repeat(50));

    packages.forEach(([packageName, count]) => {
      const bar = '█'.repeat(Math.min(Math.floor(count / 2), 20)); // Scale bar to max 20 chars
      lines.push(`${packageName.padEnd(30)} ${count.toString().padStart(3)} ${bar}`);
    });

    return lines;
  }

  // Render unused packages summary
  renderUnusedPackages(unusedPackages) {
    const lines = [];

    if (unusedPackages.length === 0) {
      return lines;
    }

    lines.push('\n🚫 Unused Packages (0 imports):');
    lines.push('='.repeat(50));

    // Sort alphabetically for better readability
    const sortedUnused = unusedPackages.sort();

    sortedUnused.forEach((packageName) => {
      lines.push(`❌ ${packageName}`);
    });

    return lines;
  }

  // Render icon usage summary
  renderIconUsage(iconUsage, iconFiles) {
    const lines = [];
    const icons = Object.entries(iconUsage).sort(([, a], [, b]) => b - a); // Sort by usage count descending

    if (icons.length === 0) {
      return lines;
    }

    lines.push('\n🎨 Icon Usage Summary:');
    lines.push('='.repeat(50));

    icons.forEach(([iconName, count]) => {
      const bar = '█'.repeat(Math.min(Math.floor(count / 2), 20)); // Scale bar to max 20 chars
      lines.push(`${iconName.padEnd(40)} ${count.toString().padStart(3)} ${bar}`);
    });

    return lines;
  }

  // Render unused icons summary
  renderUnusedIcons(iconUsage, iconFiles) {
    const lines = [];
    const unusedIcons = Object.entries(iconUsage)
      .filter(([, count]) => count === 0)
      .map(([iconName]) => iconName)
      .sort();

    if (unusedIcons.length === 0) {
      return lines;
    }

    lines.push('\n🚫 Unused Icons (0 usage):');
    lines.push('='.repeat(50));

    unusedIcons.forEach((iconName) => {
      lines.push(`❌ ${iconName}`);
    });

    return lines;
  }

  // Render icon file locations
  renderIconFileLocations(iconFiles) {
    const lines = [];
    const usedIcons = Object.entries(iconFiles)
      .filter(([, files]) => files.length > 0)
      .sort(([, a], [, b]) => b.length - a.length); // Sort by file count descending

    if (usedIcons.length === 0) {
      return lines;
    }

    lines.push('\n📍 Icon File Locations:');
    lines.push('='.repeat(50));

    usedIcons.forEach(([iconName, files]) => {
      lines.push(`\n${iconName}:`);
      files.forEach((fileInfo) => {
        const typeIndicator =
          fileInfo.type === 'variable'
            ? ' (var)'
            : fileInfo.type === 'data-structure'
              ? ' (data)'
              : fileInfo.type === 'jsx-prop'
                ? ' (jsx)'
                : fileInfo.type === 'multiline-name'
                  ? ' (multiline)'
                  : fileInfo.type === 'ternary'
                    ? ' (ternary)'
                    : fileInfo.type === 'ternary-name'
                      ? ' (ternary-name)'
                      : fileInfo.type === 'ternary-same'
                        ? ' (ternary-same)'
                        : fileInfo.type === 'ternary-name-same'
                          ? ' (ternary-name-same)'
                          : fileInfo.type === 'ternary-any'
                            ? ' (ternary-any)'
                            : fileInfo.type === 'ternary-name-any'
                              ? ' (ternary-name-any)'
                              : fileInfo.type === 'ternary-name-first'
                                ? ' (ternary-name-first)'
                                : fileInfo.type === 'ternary-name-second'
                                  ? ' (ternary-name-second)'
                                  : fileInfo.type === 'ternary-icon-second'
                                    ? ' (ternary-icon-second)'
                                    : fileInfo.type === 'ternary-comprehensive'
                                      ? ' (ternary-comprehensive)'
                                      : fileInfo.type === 'ternary-simple'
                                        ? ' (ternary-simple)'
                                        : fileInfo.type === 'ternary-name-simple'
                                          ? ' (ternary-name-simple)'
                                          : fileInfo.type === 'variable-assignment'
                                            ? ' (var-assign)'
                                            : '';
        lines.push(`  📄 ${fileInfo.file}:${fileInfo.line}${typeIndicator}`);
      });
    });

    return lines;
  }

  // Render tree in the specified format
  renderTree(tree) {
    const lines = [];
    const files = Object.keys(tree).sort();

    files.forEach((filePath, fileIndex) => {
      const isLastFile = fileIndex === files.length - 1;
      const filePrefix = isLastFile ? '└── ' : '├── ';

      const fileData = tree[filePath];
      const importCount = fileData.importCount || 0;
      const fileInfo = `${filePath} (${fileData.totalLines} lines, ${importCount} imports, ${fileData.rootFunctionCount} root functions, ${fileData.functionCount} total functions)`;
      lines.push(`${filePrefix}${fileInfo}`);

      // Render imports first
      if (fileData.imports && fileData.imports.length > 0) {
        const importPrefix = isLastFile ? '    ' : '│   ';
        lines.push(`${importPrefix}├── imports:`);

        fileData.imports.forEach((importInfo, importIndex) => {
          const isLastImport = importIndex === fileData.imports.length - 1;
          const importBullet = isLastImport ? '└── ' : '├── ';
          const importStr = this.formatImport(importInfo);
          const lineRange = `[line ${importInfo.lineRange.start}]`;
          lines.push(`${importPrefix}│   ${importBullet}${importStr} ${lineRange}`);
        });
      }

      // Group functions by depth and parent for hierarchical display
      const functions = fileData.functions;
      const rootFunctions = functions.filter((f) => f.depth === 0);

      if (rootFunctions.length > 0) {
        const functionPrefix = isLastFile ? '    ' : '│   ';
        const hasImports = fileData.imports && fileData.imports.length > 0;
        const functionBullet = hasImports ? '├── ' : '└── ';
        lines.push(`${functionPrefix}${functionBullet}functions:`);

        rootFunctions.forEach((func, funcIndex) => {
          const isLastFunction = funcIndex === rootFunctions.length - 1;
          this.renderFunctionWithNested(
            func,
            functions,
            lines,
            isLastFile,
            isLastFunction,
            0,
            hasImports
          );
        });
      }
    });

    return lines.join('\n');
  }

  // Render a function and its nested functions recursively
  renderFunctionWithNested(
    func,
    allFunctions,
    lines,
    isLastFile,
    isLastFunction,
    indentLevel,
    hasImports = false
  ) {
    // Base prefix for the file tree structure
    const filePrefix = isLastFile ? '    ' : '│   ';

    // Additional indentation for nested functions
    const nestedIndent = '    '.repeat(indentLevel);

    // Bullet for this function
    const funcBullet = isLastFunction ? '└── ' : '├── ';

    // Function name with line range and parent info
    const lineRange = `[lines ${func.lineRange.start}-${func.lineRange.end}]`;
    const parentInfo = func.parentFunction ? ` (inside ${func.parentFunction})` : '';

    // For nested functions (those with a parent), add extra indentation to show they're under "functions:"
    const functionIndent = func.parentFunction ? `${nestedIndent}    ` : `${nestedIndent}`;

    // Special case: Functions inside "Section" use "|" instead of "│"
    const functionPrefix =
      func.parentFunction === 'Section' && indentLevel === 1
        ? `${filePrefix}│   |       ${funcBullet}`
        : `${filePrefix}│   ${functionIndent}${funcBullet}`;

    lines.push(`${functionPrefix}${func.name}() ${lineRange}${parentInfo}`);

    // Function details with proper indentation
    const detailPrefix = filePrefix;
    const detailContinuation = isLastFunction ? '    ' : '│   ';
    // For nested functions, details should also have extra indentation
    const detailNestedIndent = func.parentFunction ? `${nestedIndent}    ` : nestedIndent;

    // Special case: Function details inside "Section" use "|" pattern
    const detailPrefixChar =
      func.parentFunction === 'Section' && indentLevel === 1
        ? isLastFunction
          ? `${filePrefix}│   |           `
          : `${filePrefix}│   |       │   `
        : `${detailPrefix}│   ${detailNestedIndent}${detailContinuation}`;

    // Determine if we have nested functions
    const nestedFunctions = allFunctions.filter((f) => f.parentFunction === func.name);
    const hasNested = nestedFunctions.length > 0;

    // Count details to show (always params and returns, optionally description)
    const hasDescription = func.description && func.description.trim().length > 0;
    const detailCount = hasDescription ? 3 : 2; // desc, params, returns OR just params, returns
    let detailIndex = 0;

    // Description first (if available)
    if (hasDescription) {
      detailIndex++;
      const isLastDetail = detailIndex === detailCount && !hasNested;
      const detailBullet = isLastDetail ? '└── ' : '├── ';
      lines.push(`${detailPrefixChar}${detailBullet}desc: "${func.description}"`);
    }

    // Parameters
    detailIndex++;
    const paramsStr = this.formatParameters(func.params);
    const isLastDetail = detailIndex === detailCount && !hasNested;
    const paramsBullet = isLastDetail ? '└── ' : '├── ';
    lines.push(`${detailPrefixChar}${paramsBullet}params: ${paramsStr}`);

    // Return type
    detailIndex++;
    const isLastReturn = detailIndex === detailCount && !hasNested;
    const returnsBullet = isLastReturn ? '└── ' : '├── ';
    lines.push(`${detailPrefixChar}${returnsBullet}returns: ${func.returnType}`);

    // Render nested functions with proper grouping
    if (hasNested) {
      // Add "functions:" header for nested functions
      lines.push(`${detailPrefix}│   ${detailNestedIndent}${detailContinuation}└── functions:`);

      // Render each nested function
      nestedFunctions.forEach((nestedFunc, nestedIndex) => {
        const isLastNested = nestedIndex === nestedFunctions.length - 1;
        this.renderFunctionWithNested(
          nestedFunc,
          allFunctions,
          lines,
          isLastFile,
          isLastNested,
          indentLevel + 1,
          hasImports
        );
      });
    }
  }

  // Main execution method
  generate(rootDir = process.cwd()) {
    console.log('🌳 Generating function tree...\n');

    const { tree, packageUsage, unusedPackages } = this.buildTree(rootDir);

    if (Object.keys(tree).length === 0) {
      console.log('No files with functions found.');
      return;
    }

    const output = this.renderTree(tree);
    console.log(output);

    // Package usage summary
    const packageSummary = this.renderPackageSummary(packageUsage);
    console.log(packageSummary.join('\n'));

    // Unused packages summary
    const unusedSummary = this.renderUnusedPackages(unusedPackages);
    console.log(unusedSummary.join('\n'));

    // Icon analysis
    console.log('\n🔍 Analyzing icon usage...');
    const { iconUsage, iconFiles, configuredIcons } = this.analyzeIconUsage(rootDir);

    // Icon usage summary
    const iconSummary = this.renderIconUsage(iconUsage, iconFiles);
    console.log(iconSummary.join('\n'));

    // Unused icons summary
    const unusedIconsSummary = this.renderUnusedIcons(iconUsage, iconFiles);
    console.log(unusedIconsSummary.join('\n'));

    // Icon file locations (optional - can be verbose)
    const iconLocations = this.renderIconFileLocations(iconFiles);
    console.log(iconLocations.join('\n'));

    // Summary
    const totalFiles = Object.keys(tree).length;
    const totalFunctions = Object.values(tree).reduce(
      (sum, fileData) => sum + fileData.functionCount,
      0
    );
    const totalImports = Object.values(tree).reduce(
      (sum, fileData) => sum + (fileData.importCount || 0),
      0
    );
    const totalLines = Object.values(tree).reduce((sum, fileData) => sum + fileData.totalLines, 0);
    const uniquePackages = Object.keys(packageUsage).length;
    const usedIcons = Object.values(iconUsage).filter((count) => count > 0).length;
    const unusedIcons = Object.values(iconUsage).filter((count) => count === 0).length;
    console.log(
      `\n📊 Summary: ${totalFiles} files, ${totalImports} imports, ${totalFunctions} functions, ${totalLines} total lines, ${uniquePackages} used packages, ${unusedPackages.length} unused packages, ${usedIcons} used icons, ${unusedIcons} unused icons`
    );
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const helpFlag = args.includes('--help') || args.includes('-h');

  if (helpFlag) {
    console.log(`
Function Tree Generator

Usage: node function-tree.js [options] [directory]

Options:
  -h, --help    Show this help message
  
Features:
  - Function analysis with hierarchical display
  - Import/export tracking
  - Package usage analysis
  - Icon usage analysis (from metro.config.js)
  - Unused package detection
  - Unused icon detection
  
Examples:
  node function-tree.js           # Analyze current directory
  node function-tree.js src/      # Analyze src directory
`);
    process.exit(0);
  }

  const targetDir = args[0] || process.cwd();
  const generator = new FunctionTreeGenerator();
  generator.generate(targetDir);
}

module.exports = FunctionTreeGenerator;
