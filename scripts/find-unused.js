#!/usr/bin/env node

/**
 * Script to find unused functions, constants, and variables in a TypeScript/React Native project
 *
 * Usage: node scripts/find-unused.js
 */

const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  // Directories to scan
  scanDirs: ['app', 'components', 'helper', 'hooks', 'hocs', 'assets'],
  // File extensions to analyze
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  // Patterns to ignore
  ignorePatterns: [
    /node_modules/,
    /\.d\.ts$/,
    /\.test\./,
    /\.spec\./,
    /\.stories\./,
    /build/,
    /dist/,
    /__tests__/,
  ],
  // Entry points that should never be considered unused
  entryPoints: [
    '_layout.tsx',
    '+html.tsx',
    '+native-intent.tsx',
    '+not-found.tsx',
    'global.ts',
    'index.tsx',
    'index.ts',
  ],
  // Patterns for exports that might be used externally
  externalUsagePatterns: [/export\s+default/, /export\s*\{[^}]*default/, /module\.exports/],
};

class UnusedCodeFinder {
  constructor() {
    this.allFiles = new Map(); // filepath -> file content
    this.exports = new Map(); // name -> { file, type, line }
    this.imports = new Map(); // name -> [{ file, line }]
    this.declarations = new Map(); // name -> { file, type, line, exported }
    this.usages = new Map(); // name -> [{ file, line }]
  }

  /**
   * Main entry point
   */
  async findUnused() {
    console.log('🔍 Scanning for unused code...\n');

    // Step 1: Collect all files
    await this.collectFiles();

    // Step 2: Parse exports and declarations
    await this.parseExportsAndDeclarations();

    // Step 3: Find usages
    await this.findUsages();

    // Step 4: Generate report
    this.generateReport();
  }

  /**
   * Recursively collect all relevant files
   */
  async collectFiles() {
    const collectFromDir = (dir) => {
      if (!fs.existsSync(dir)) return;

      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip ignored directories
          if (config.ignorePatterns.some((pattern) => pattern.test(fullPath))) {
            continue;
          }
          collectFromDir(fullPath);
        } else if (stat.isFile()) {
          // Check if file should be analyzed
          const ext = path.extname(fullPath);
          if (
            config.extensions.includes(ext) &&
            !config.ignorePatterns.some((pattern) => pattern.test(fullPath))
          ) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              this.allFiles.set(fullPath, content);
            } catch (error) {
              console.warn(`Warning: Could not read ${fullPath}: ${error.message}`);
            }
          }
        }
      }
    };

    // Collect from each scan directory
    for (const scanDir of config.scanDirs) {
      collectFromDir(scanDir);
    }

    console.log(`📁 Found ${this.allFiles.size} files to analyze`);
  }

  /**
   * Parse exports and function/const/variable declarations
   */
  async parseExportsAndDeclarations() {
    for (const [filePath, content] of this.allFiles) {
      this.parseFile(filePath, content);
    }

    console.log(`📤 Found ${this.exports.size} exports`);
    console.log(`📋 Found ${this.declarations.size} declarations`);
  }

  /**
   * Parse a single file for exports and declarations
   */
  parseFile(filePath, content) {
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // Skip comments and empty lines
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || !trimmedLine) {
        return;
      }

      // Parse exports
      this.parseExports(filePath, line, lineNum);

      // Parse declarations
      this.parseDeclarations(filePath, line, lineNum);
    });
  }

  /**
   * Parse export statements
   */
  parseExports(filePath, line, lineNum) {
    const exportPatterns = [
      // export function name() {}
      /export\s+(async\s+)?function\s+(\w+)/,
      // export const name =
      /export\s+const\s+(\w+)/,
      // export let name =
      /export\s+let\s+(\w+)/,
      // export var name =
      /export\s+var\s+(\w+)/,
      // export class Name
      /export\s+class\s+(\w+)/,
      // export interface Name
      /export\s+interface\s+(\w+)/,
      // export type Name
      /export\s+type\s+(\w+)/,
      // export enum Name
      /export\s+enum\s+(\w+)/,
      // export { name }
      /export\s*\{\s*([^}]+)\s*\}/,
    ];

    for (const pattern of exportPatterns) {
      const match = line.match(pattern);
      if (match) {
        if (pattern.source.includes('{')) {
          // Handle export { a, b, c }
          const names = match[1].split(',').map((n) => n.trim().split(' as ')[0]);
          names.forEach((name) => {
            this.exports.set(name, { file: filePath, type: 'export', line: lineNum });
          });
        } else {
          const name = match[2] || match[1];
          this.exports.set(name, { file: filePath, type: 'export', line: lineNum });
        }
      }
    }

    // export default
    if (line.includes('export default')) {
      const defaultMatch = line.match(/export\s+default\s+(?:(?:async\s+)?function\s+)?(\w+)/);
      if (defaultMatch) {
        this.exports.set(defaultMatch[1], { file: filePath, type: 'default', line: lineNum });
      }
    }
  }

  /**
   * Parse function, const, let, var declarations
   */
  parseDeclarations(filePath, line, lineNum) {
    const declarationPatterns = [
      // function name() {}
      { pattern: /(?:^|\s)(async\s+)?function\s+(\w+)/, type: 'function' },
      // const name =
      { pattern: /(?:^|\s)const\s+(\w+)/, type: 'const' },
      // let name =
      { pattern: /(?:^|\s)let\s+(\w+)/, type: 'let' },
      // var name =
      { pattern: /(?:^|\s)var\s+(\w+)/, type: 'var' },
      // class Name
      { pattern: /(?:^|\s)class\s+(\w+)/, type: 'class' },
      // interface Name
      { pattern: /(?:^|\s)interface\s+(\w+)/, type: 'interface' },
      // type Name
      { pattern: /(?:^|\s)type\s+(\w+)/, type: 'type' },
      // enum Name
      { pattern: /(?:^|\s)enum\s+(\w+)/, type: 'enum' },
    ];

    for (const { pattern, type } of declarationPatterns) {
      const match = line.match(pattern);
      if (match) {
        const name = match[2] || match[1];
        const isExported = line.includes('export');

        this.declarations.set(name, {
          file: filePath,
          type,
          line: lineNum,
          exported: isExported,
        });
      }
    }
  }

  /**
   * Find all usages of declared names
   */
  async findUsages() {
    const allNames = new Set([...this.exports.keys(), ...this.declarations.keys()]);

    for (const [filePath, content] of this.allFiles) {
      for (const name of allNames) {
        const usages = this.findNameUsages(content, name, filePath);

        if (usages.length > 0) {
          if (!this.usages.has(name)) {
            this.usages.set(name, []);
          }
          this.usages.get(name).push(...usages);
        }
      }
    }

    console.log(`🔗 Found ${this.usages.size} names with usages`);
  }

  /**
   * Find usages of a specific name in content
   */
  findNameUsages(content, name, filePath) {
    const usages = [];
    const lines = content.split('\n');

    // Create regex to find the name (but not in comments or strings)
    const nameRegex = new RegExp(`\\b${name}\\b`, 'g');

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // Skip comments
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
        return;
      }

      // Skip the declaration line itself
      const declaration = this.declarations.get(name);
      if (declaration && declaration.file === filePath && declaration.line === lineNum) {
        return;
      }

      // Skip export lines
      const exportInfo = this.exports.get(name);
      if (exportInfo && exportInfo.file === filePath && exportInfo.line === lineNum) {
        return;
      }

      // Check for usage
      if (nameRegex.test(line)) {
        usages.push({ file: filePath, line: lineNum });
      }

      // Reset regex
      nameRegex.lastIndex = 0;
    });

    return usages;
  }

  /**
   * Generate and display the report
   */
  generateReport() {
    console.log('\n📊 UNUSED CODE REPORT');
    console.log('='.repeat(50));

    const unused = {
      exports: [],
      functions: [],
      constants: [],
      variables: [],
      types: [],
    };

    // Check exports
    for (const [name, info] of this.exports) {
      const usages = this.usages.get(name) || [];
      const isEntryPoint = config.entryPoints.some((entry) => info.file.includes(entry));

      if (usages.length === 0 && !isEntryPoint) {
        unused.exports.push({ name, ...info });
      }
    }

    // Check declarations
    for (const [name, info] of this.declarations) {
      const usages = this.usages.get(name) || [];

      // Skip if it's exported (handled above)
      if (info.exported) continue;

      if (usages.length === 0) {
        switch (info.type) {
          case 'function':
            unused.functions.push({ name, ...info });
            break;
          case 'const':
            unused.constants.push({ name, ...info });
            break;
          case 'let':
          case 'var':
            unused.variables.push({ name, ...info });
            break;
          case 'class':
          case 'interface':
          case 'type':
          case 'enum':
            unused.types.push({ name, ...info });
            break;
        }
      }
    }

    // Display results
    this.displayUnusedCategory('Unused Exports', unused.exports);
    this.displayUnusedCategory('Unused Functions', unused.functions);
    this.displayUnusedCategory('Unused Constants', unused.constants);
    this.displayUnusedCategory('Unused Variables', unused.variables);
    this.displayUnusedCategory('Unused Types/Interfaces', unused.types);

    // Summary
    const total =
      unused.exports.length +
      unused.functions.length +
      unused.constants.length +
      unused.variables.length +
      unused.types.length;

    console.log('\n📈 SUMMARY');
    console.log('-'.repeat(30));
    console.log(`Total unused items found: ${total}`);
    console.log(`Files analyzed: ${this.allFiles.size}`);

    if (total > 0) {
      console.log('\n💡 Consider removing these unused items to clean up your codebase.');
      console.log('⚠️  Please review each item carefully before deletion.');
    } else {
      console.log('\n✅ No unused code found! Your codebase is clean.');
    }
  }

  /**
   * Display unused items in a category
   */
  displayUnusedCategory(title, items) {
    if (items.length === 0) return;

    console.log(`\n${title} (${items.length}):`);
    console.log('-'.repeat(title.length + 5));

    items.forEach((item) => {
      const relativePath = path.relative(process.cwd(), item.file);
      console.log(`  • ${item.name} (${relativePath}:${item.line})`);
    });
  }
}

// Run the script
if (require.main === module) {
  const finder = new UnusedCodeFinder();
  finder.findUnused().catch(console.error);
}

module.exports = UnusedCodeFinder;
