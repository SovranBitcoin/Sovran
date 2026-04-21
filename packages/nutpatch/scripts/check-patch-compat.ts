/**
 * patch compatibility check.
 *
 * parses cashu-ts crypto source files and our replacement files using the
 * typescript AST and compares every exported function / const signature.
 * exits 1 if any signature differs or is missing.
 *
 * ignored:
 *   - inline comments
 *   - trailing semicolons inside object types
 *   - explicit vs inferred return types
 *   - `export function foo()` vs `export const foo = () =>`
 *   - whitespace / formatting
 */

import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'


function parseFile(filepath: string): ts.SourceFile {
  const src = fs.readFileSync(filepath, 'utf8')
  return ts.createSourceFile(filepath, src, ts.ScriptTarget.ESNext, true)
}

/** strip // comments and normalise whitespace. */
function norm(s: string): string {
  return s
    .replace(/\/\/[^\n]*/g, '')   // strip line comments
    .replace(/;(\s*\})/g, '$1')   // remove trailing ; inside object types
    .replace(/\s+/g, ' ')
    .trim()
}

/** extract just the parameter list text from a function/arrow, normalised. */
function paramSig(params: ts.NodeArray<ts.ParameterDeclaration>, src: string): string {
  return '(' + params.map(p => norm(p.getFullText())).join(', ') + ')'
}

type ExportedSig = { params: string }

function extractExports(sf: ts.SourceFile): Map<string, ExportedSig> {
  const result = new Map<string, ExportedSig>()
  const src = sf.getFullText()

  function addFn(name: string, params: ts.NodeArray<ts.ParameterDeclaration>) {
    result.set(name, { params: paramSig(params, src) })
  }

  function visit(node: ts.Node) {
    const exported = (n: ts.Node) =>
      (n as ts.FunctionDeclaration).modifiers?.some(
        m => m.kind === ts.SyntaxKind.ExportKeyword,
      )

    // export function foo(...)
    if (ts.isFunctionDeclaration(node) && exported(node) && node.name) {
      addFn(node.name.text, node.parameters)
      return
    }

    // export const foo = (...) =>
    if (ts.isVariableStatement(node) && exported(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isArrowFunction(decl.initializer)
        ) {
          addFn(decl.name.text, decl.initializer.parameters)
        }
      }
      return
    }

    ts.forEachChild(node, visit)
  }

  ts.forEachChild(sf, visit)
  return result
}


const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const CASHU_TS = path.resolve(ROOT, '..', 'cashu-ts')

const FILES: Array<{ label: string; upstream: string; ours: string }> = [
  {
    label: 'core.ts',
    upstream: path.join(CASHU_TS, 'src', 'crypto', 'core.ts'),
    ours:     path.join(ROOT, 'src', 'crypto', 'core.ts'),
  },
  {
    label: 'NUT12.ts',
    upstream: path.join(CASHU_TS, 'src', 'crypto', 'NUT12.ts'),
    ours:     path.join(ROOT, 'src', 'crypto', 'NUT12.ts'),
  },
]

let failures = 0

for (const { label, upstream, ours } of FILES) {
  const upExports  = extractExports(parseFile(upstream))
  const ourExports = extractExports(parseFile(ours))

  const missing = [...upExports.keys()].filter(k => !ourExports.has(k))
  const changed = [...upExports.keys()].filter(k => {
    const our = ourExports.get(k)
    if (!our) return false
    return our.params !== upExports.get(k)!.params
  })
  const extra = [...ourExports.keys()].filter(k => !upExports.has(k))

  const covered = upExports.size - missing.length
  const pct = upExports.size === 0 ? 100 : Math.round((covered / upExports.size) * 100)

  console.log(`\n == ${label} == `)
  console.log(`coverage: ${covered}/${upExports.size} (${pct}%)`)

  if (missing.length === 0 && changed.length === 0) {
    console.log('  all signatures match!!')
  }

  if (missing.length > 0) {
    console.log(`  MISSING (${missing.length}):`)
    missing.forEach(n => console.log(`    ✗ ${n}`))
    failures += missing.length
  }

  if (changed.length > 0) {
    console.log(`  PARAMETER MISMATCH (${changed.length}):`)
    changed.forEach(n => {
      console.log(`    ~ ${n}`)
      console.log(`      upstream: ${n}${upExports.get(n)!.params}`)
      console.log(`      ours:     ${n}${ourExports.get(n)!.params}`)
    })
    failures += changed.length
  }

  if (extra.length > 0) {
    console.log(`  extra (ours only): ${extra.join(', ')}`)
  }
}

if (failures > 0) {
  console.error(`\n${failures} issue(s) - patch incomplete or out of date`)
  process.exit(1)
} else {
  console.log('\nPatch coverage: PASS')
}
