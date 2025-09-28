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

  // Parse TypeScript/JavaScript file and extract functions
  extractFunctions(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

      const functions = [];

      const visit = (node) => {
        // Function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          functions.push(this.processFunctionNode(node, sourceFile));
        }
        // Arrow functions assigned to variables
        else if (
          ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ) {
          functions.push(this.processVariableFunctionNode(node, sourceFile));
        }
        // Method declarations in classes
        else if (ts.isMethodDeclaration(node)) {
          functions.push(this.processFunctionNode(node, sourceFile));
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
      return { functions, totalLines: content.split('\n').length };
    } catch (error) {
      console.warn(`Warning: Could not parse ${filePath}: ${error.message}`);
      return { functions: [], totalLines: 0 };
    }
  }

  // Process function node and extract metadata
  processFunctionNode(node, sourceFile) {
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
    };
  }

  // Process variable function node (arrow functions, function expressions)
  processVariableFunctionNode(node, sourceFile) {
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

  // Generate tree structure
  buildTree(rootDir = process.cwd()) {
    const files = this.getAllFiles(rootDir);
    const tree = {};

    files.forEach((filePath) => {
      const relativePath = path.relative(rootDir, filePath);
      const result = this.extractFunctions(filePath);

      if (result.functions.length > 0) {
        tree[relativePath] = {
          functions: result.functions,
          totalLines: result.totalLines,
          functionCount: result.functions.length,
        };
      }
    });

    return tree;
  }

  // Render tree in the specified format
  renderTree(tree) {
    const lines = [];
    const files = Object.keys(tree).sort();

    files.forEach((filePath, fileIndex) => {
      const isLastFile = fileIndex === files.length - 1;
      const filePrefix = isLastFile ? '└── ' : '├── ';

      const fileData = tree[filePath];
      const fileInfo = `${filePath} (${fileData.totalLines} lines, ${fileData.functionCount} functions)`;
      lines.push(`${filePrefix}${fileInfo}`);

      const functions = fileData.functions;
      functions.forEach((func, funcIndex) => {
        const isLastFunction = funcIndex === functions.length - 1;
        const funcPrefix = isLastFile ? '    ' : '│   ';
        const funcBullet = isLastFunction ? '└── ' : '├── ';

        // Function name with line range
        const lineRange = `[lines ${func.lineRange.start}-${func.lineRange.end}]`;
        lines.push(`${funcPrefix}${funcBullet}${func.name}() ${lineRange}`);

        // Function details with proper indentation
        const detailPrefix = isLastFile ? '    ' : '│   ';
        const detailIndent = isLastFunction ? '    ' : '│   ';

        // Parameters
        const paramsStr = this.formatParameters(func.params);
        lines.push(`${detailPrefix}${detailIndent}├── params: ${paramsStr}`);

        // Return type
        lines.push(`${detailPrefix}${detailIndent}├── returns: ${func.returnType}`);

        // Description (if available)
        if (func.description) {
          lines.push(`${detailPrefix}${detailIndent}└── desc: "${func.description}"`);
        } else {
          // If no description, make returns the last item
          const prevLine = lines[lines.length - 1];
          lines[lines.length - 1] = prevLine.replace('├── returns:', '└── returns:');
        }
      });
    });

    return lines.join('\n');
  }

  // Main execution method
  generate(rootDir = process.cwd()) {
    console.log('🌳 Generating function tree...\n');

    const tree = this.buildTree(rootDir);

    if (Object.keys(tree).length === 0) {
      console.log('No files with functions found.');
      return;
    }

    const output = this.renderTree(tree);
    console.log(output);

    // Summary
    const totalFiles = Object.keys(tree).length;
    const totalFunctions = Object.values(tree).reduce(
      (sum, fileData) => sum + fileData.functionCount,
      0
    );
    const totalLines = Object.values(tree).reduce((sum, fileData) => sum + fileData.totalLines, 0);
    console.log(
      `\n📊 Summary: ${totalFiles} files, ${totalFunctions} functions, ${totalLines} total lines`
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
