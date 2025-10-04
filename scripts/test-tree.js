#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class TreeTester {
  constructor(options = {}) {
    this.options = {
      headLimit: 190,
      referenceFile: './scripts/example.md',
      maxIterations: 10,
      ...options,
    };
    this.currentIteration = 0;
  }

  // Run the tree command and capture output
  runTreeCommand() {
    try {
      console.log('🌳 Running tree generator...');
      const command = 'node ./scripts/tree.js';
      const output = execSync(command, {
        encoding: 'utf8',
        cwd: process.cwd(),
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      // Split output into lines and take only the head limit
      const lines = output.split('\n');
      const limitedOutput = lines.slice(0, this.options.headLimit).join('\n');

      return limitedOutput;
    } catch (error) {
      console.error('❌ Error running tree command:', error.message);
      return null;
    }
  }

  // Read reference file
  readReference() {
    try {
      const referencePath = path.resolve(this.options.referenceFile);
      const content = fs.readFileSync(referencePath, 'utf8');

      // Take the same head limit from reference
      const lines = content.split('\n');
      const limitedReference = lines.slice(0, this.options.headLimit).join('\n');

      return limitedReference;
    } catch (error) {
      console.error('❌ Error reading reference file:', error.message);
      return null;
    }
  }

  // Compare outputs line by line
  compareOutputs(generated, reference) {
    const generatedLines = generated.split('\n');
    const referenceLines = reference.split('\n');

    const maxLines = Math.max(generatedLines.length, referenceLines.length);
    const differences = [];
    let matchingLines = 0;

    console.log('\n📊 Line-by-line comparison:');
    console.log('='.repeat(80));

    for (let i = 0; i < maxLines; i++) {
      const genLine = generatedLines[i] || '';
      const refLine = referenceLines[i] || '';

      if (genLine === refLine) {
        matchingLines++;
        console.log(`✅ ${(i + 1).toString().padStart(3)}: Lines match`);
      } else {
        differences.push({
          lineNumber: i + 1,
          generated: genLine,
          reference: refLine,
        });

        console.log(`❌ ${(i + 1).toString().padStart(3)}: DIFFERENCE`);
        console.log(`    REF: "${refLine}"`);
        console.log(`    GEN: "${genLine}"`);
      }
    }

    const matchPercentage = ((matchingLines / maxLines) * 100).toFixed(1);

    return {
      differences,
      matchingLines,
      totalLines: maxLines,
      matchPercentage: parseFloat(matchPercentage),
      isMatch: differences.length === 0,
    };
  }

  // Analyze differences and suggest fixes
  analyzeDifferences(comparison) {
    console.log('\n🔍 Difference Analysis:');
    console.log('='.repeat(50));

    if (comparison.isMatch) {
      console.log('🎉 Perfect match! No differences found.');
      return [];
    }

    const suggestions = [];
    const { differences } = comparison;

    // Group similar types of differences
    const diffTypes = {
      importFormat: 0,
      functionFormat: 0,
      lineNumbers: 0,
      indentation: 0,
      structure: 0,
    };

    differences.forEach((diff) => {
      const { reference: ref, generated: gen } = diff;

      // Analyze type of difference
      if (ref.includes('imports:') || gen.includes('imports:')) {
        diffTypes.importFormat++;
      } else if (ref.includes('functions:') || gen.includes('functions:')) {
        diffTypes.functionFormat++;
      } else if (ref.includes('[line') || gen.includes('[line')) {
        diffTypes.lineNumbers++;
      } else if (ref.trim() === gen.trim() && ref !== gen) {
        diffTypes.indentation++;
      } else {
        diffTypes.structure++;
      }
    });

    // Generate suggestions based on difference patterns
    Object.entries(diffTypes).forEach(([type, count]) => {
      if (count > 0) {
        let suggestion = '';
        switch (type) {
          case 'importFormat':
            suggestion = `Fix import formatting (${count} issues) - check formatImport() method`;
            break;
          case 'functionFormat':
            suggestion = `Fix function formatting (${count} issues) - check function rendering logic`;
            break;
          case 'lineNumbers':
            suggestion = `Fix line number references (${count} issues) - check getLineRange() method`;
            break;
          case 'indentation':
            suggestion = `Fix indentation (${count} issues) - check tree rendering logic`;
            break;
          case 'structure':
            suggestion = `Fix structural differences (${count} issues) - check overall tree structure`;
            break;
        }
        suggestions.push({ type, count, suggestion });
      }
    });

    return suggestions;
  }

  // Save current output for debugging
  saveDebugOutput(generated, iteration) {
    const debugDir = './scripts/debug';
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    const filename = `tree-output-iteration-${iteration}.txt`;
    const filepath = path.join(debugDir, filename);
    fs.writeFileSync(filepath, generated, 'utf8');
    console.log(`💾 Debug output saved to: ${filepath}`);
  }

  // Interactive mode to choose fixes
  promptForFix(suggestions) {
    console.log('\n🛠️  Suggested fixes:');
    suggestions.forEach((suggestion, index) => {
      console.log(`${index + 1}. ${suggestion.suggestion}`);
    });

    console.log('\n📝 Review the differences above and manually edit scripts/tree.js');
    console.log('   Press Enter when ready to test again, or type "exit" to quit:');

    // In a real implementation, you might want to add readline for interactive input
    // For now, we'll just return and let the user manually edit
    return 'continue';
  }

  // Main test loop
  async runTest() {
    console.log(`🚀 Starting tree generator test (max ${this.options.maxIterations} iterations)`);
    console.log(`📄 Reference file: ${this.options.referenceFile}`);
    console.log(`📏 Head limit: ${this.options.headLimit} lines\n`);

    const reference = this.readReference();
    if (!reference) {
      console.error('❌ Could not read reference file. Exiting.');
      return false;
    }

    for (let iteration = 1; iteration <= this.options.maxIterations; iteration++) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔄 ITERATION ${iteration}/${this.options.maxIterations}`);
      console.log(`${'='.repeat(60)}`);

      const generated = this.runTreeCommand();
      if (!generated) {
        console.error('❌ Could not generate tree output. Exiting.');
        return false;
      }

      // Save debug output
      this.saveDebugOutput(generated, iteration);

      // Compare outputs
      const comparison = this.compareOutputs(generated, reference);

      console.log(`\n📈 Results for iteration ${iteration}:`);
      console.log(`   Matching lines: ${comparison.matchingLines}/${comparison.totalLines}`);
      console.log(`   Match percentage: ${comparison.matchPercentage}%`);
      console.log(`   Differences: ${comparison.differences.length}`);

      if (comparison.isMatch) {
        console.log(
          `\n🎉 SUCCESS! Tree generator output matches reference after ${iteration} iteration(s)!`
        );
        return true;
      }

      // Analyze and suggest fixes
      const suggestions = this.analyzeDifferences(comparison);

      if (iteration < this.options.maxIterations) {
        console.log(
          `\n⏱️  Pausing for manual fixes. Edit scripts/tree.js and run this script again.`
        );
        console.log(`   Current match: ${comparison.matchPercentage}%`);
        console.log(`   ${this.options.maxIterations - iteration} iterations remaining.`);
        break; // Exit to allow manual editing
      } else {
        console.log(`\n⏰ Reached maximum iterations (${this.options.maxIterations})`);
        console.log(`   Final match: ${comparison.matchPercentage}%`);
        break;
      }
    }

    return false;
  }

  // Quick compare mode (just show differences)
  quickCompare() {
    console.log('⚡ Quick comparison mode');

    const reference = this.readReference();
    const generated = this.runTreeCommand();

    if (!reference || !generated) {
      console.error('❌ Could not read files for comparison');
      return;
    }

    const comparison = this.compareOutputs(generated, reference);
    console.log(`\n📊 Quick Results:`);
    console.log(`   Match: ${comparison.matchPercentage}%`);
    console.log(`   Differences: ${comparison.differences.length}`);

    if (comparison.differences.length > 0 && comparison.differences.length <= 10) {
      console.log('\n🔍 First few differences:');
      comparison.differences.slice(0, 5).forEach((diff, index) => {
        console.log(`\n${index + 1}. Line ${diff.lineNumber}:`);
        console.log(`   REF: "${diff.reference}"`);
        console.log(`   GEN: "${diff.generated}"`);
      });
    }
  }
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const helpFlag = args.includes('--help') || args.includes('-h');
  const quickFlag = args.includes('--quick') || args.includes('-q');

  if (helpFlag) {
    console.log(`
Tree Generator Tester

Usage: node test-tree.js [options]

Options:
  -h, --help     Show this help message
  -q, --quick    Quick comparison mode (no iteration)
  --head N       Limit output to N lines (default: 190)
  --ref FILE     Use FILE as reference (default: ./scripts/example.md)
  --max N        Maximum iterations (default: 10)

Examples:
  node test-tree.js                    # Full test with iteration
  node test-tree.js --quick            # Quick comparison only
  node test-tree.js --head 100         # Limit to 100 lines
  node test-tree.js --ref other.md     # Use different reference
`);
    process.exit(0);
  }

  // Parse options
  const options = {};

  const headIndex = args.indexOf('--head');
  if (headIndex !== -1 && args[headIndex + 1]) {
    options.headLimit = parseInt(args[headIndex + 1], 10);
  }

  const refIndex = args.indexOf('--ref');
  if (refIndex !== -1 && args[refIndex + 1]) {
    options.referenceFile = args[refIndex + 1];
  }

  const maxIndex = args.indexOf('--max');
  if (maxIndex !== -1 && args[maxIndex + 1]) {
    options.maxIterations = parseInt(args[maxIndex + 1], 10);
  }

  const tester = new TreeTester(options);

  if (quickFlag) {
    tester.quickCompare();
  } else {
    tester.runTest().then((success) => {
      process.exit(success ? 0 : 1);
    });
  }
}

module.exports = TreeTester;
