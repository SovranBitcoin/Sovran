import { z } from 'zod';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const text = z.string().trim().min(1);
const base = { id: text, cwd: text.default('.'), timeoutMs: z.number().int().positive().max(3_600_000) };
export const requiredCase = z.object({ file: text, names: z.array(text).min(1) });
export const nodeCheck = z.object({ ...base, cwd: z.literal('.').default('.'), kind: z.literal('node-tests'), files: z.array(text).min(1), requiredCases: z.array(requiredCase).min(1) }).strict().superRefine((c, ctx) => {
  if (new Set(c.files).size !== c.files.length || c.requiredCases.some(r => !c.files.includes(r.file)) ||
      new Set(c.requiredCases.map(r => JSON.stringify(r))).size !== c.requiredCases.length)
    ctx.addIssue({ code: 'custom', message: 'Test selection requires unique files and unique cases in those files' });
});
export const command = z.union([nodeCheck, z.object({ ...base, argv: z.array(text).min(1) }).strict()]);
export type NodeCheck = z.infer<typeof nodeCheck>;

const eventData = z.object({
  file: z.string().optional(), name: z.string().optional(), nesting: z.number().int().nonnegative().optional(),
  line: z.number().int().positive().optional(), column: z.number().int().positive().optional(),
  skip: z.union([z.boolean(), z.string()]).optional(), todo: z.union([z.boolean(), z.string()]).optional(),
  details: z.object({ type: z.string(), passed: z.boolean().optional() }).optional(),
  success: z.boolean().optional(),
  counts: z.object({ tests: z.number().int().nonnegative(), passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(), todo: z.number().int().nonnegative() }).optional(),
}).passthrough();
const record = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('start'), invocation: text, node: text }),
  z.object({ kind: z.literal('event'), event: z.object({ type: text, data: eventData }) }),
  z.object({ kind: z.literal('end'), invocation: text }),
]);

/** Interpret the host collector's stream, never the test's printed JSON or a test-written report. */
export function inspectNodeTests(raw: string, expected: { invocation: string; root: string; files: string[]; requiredCases: NodeCheck['requiredCases'] }) {
  const records = raw.trim().split('\n').map(line => record.parse(JSON.parse(line)));
  const first = records[0], last = records.at(-1);
  if (first?.kind !== 'start' || last?.kind !== 'end' || first.invocation !== expected.invocation || last.invocation !== expected.invocation ||
    records.slice(1, -1).some(r => r.kind !== 'event')) throw new Error('Incomplete or mismatched test invocation');
  const normalize = (file: string) => {
    const value = relative(realpathSync(expected.root), realpathSync(file));
    if (value === '..' || value.startsWith('../') || isAbsolute(value)) throw new Error('Test event escapes source workspace');
    return value;
  };
  const files = expected.files.map(file => normalize(resolve(expected.root, file)));
  const requiredCases = expected.requiredCases.map(c => ({ ...c, file: normalize(resolve(expected.root, c.file)) }));
  if (new Set(files).size !== files.length) throw new Error('Test files alias the same source');
  const stacks = new Map<string, string[]>();
  const started = new Map<string, { file: string; names: string[] }>();
  const completed = new Map<string, { passed: boolean; type: string }>();
  const cases: { file: string; names: string[]; passed: boolean; skipped: boolean; todo: boolean }[] = [];
  const terminal = new Set<string>();
  const summaries = new Map<string, z.infer<typeof eventData>['counts']>();
  const problems: string[] = [];
  const identity = (d: z.infer<typeof eventData>) => JSON.stringify([d.file && normalize(d.file), d.line, d.column, d.name, d.nesting]);
  for (const r of records) {
    if (r.kind !== 'event') continue;
    const { type, data: d } = r.event;
    if (type === 'test:summary') {
      const file = d.file ? normalize(d.file) : '<all>';
      if (summaries.has(file)) problems.push(`Duplicate run summary: ${file}`);
      if (!d.counts) throw new Error('Runner summary lacks case counts');
      summaries.set(file, d.counts);
      if (d.success !== true) problems.push(`Runner reports failure: ${file}`);
    }
    if (!['test:start', 'test:complete', 'test:pass', 'test:fail'].includes(type)) continue;
    if (!d.file || !d.name || d.nesting === undefined || !d.line || !d.column) throw new Error('Test identity is incomplete');
    const file = normalize(d.file);
    if (!files.includes(file)) throw new Error(`Unexpected test file: ${file}`);
    // Node counts an empty file's process wrapper as a passing test. It is never a case.
    if (d.name === d.file) continue;
    const key = identity(d);
    if (type === 'test:start') {
      if (started.has(key)) problems.push(`Duplicate case start: ${key}`);
      const parents = stacks.get(file) ?? [];
      if (d.nesting > parents.length) throw new Error('Missing parent test identity');
      const names = [...parents.slice(0, d.nesting), d.name];
      stacks.set(file, names); started.set(key, { file, names });
    } else if (type === 'test:complete') {
      if (!d.details || d.details.passed === undefined) throw new Error('Test completion lacks result');
      if (completed.has(key)) problems.push(`Duplicate case completion: ${key}`);
      completed.set(key, { passed: d.details.passed, type: d.details.type });
    } else {
      const start = started.get(key), completion = completed.get(key);
      if (!start || !completion || !d.details || completion.type !== d.details.type || completion.passed !== (type === 'test:pass'))
        throw new Error('Case terminal result disagrees with its lifecycle');
      if (terminal.has(key)) problems.push(`Duplicate case result: ${key}`);
      terminal.add(key);
      if (type === 'test:fail') problems.push(`Test failed: ${start.names.join(' > ')}`);
      if (d.details.type === 'test') cases.push({ ...start, passed: type === 'test:pass', skipped: d.skip !== undefined && d.skip !== false, todo: d.todo !== undefined && d.todo !== false });
    }
  }
  if (!summaries.has('<all>')) problems.push('Missing overall runner summary');
  for (const file of files) {
    if (!summaries.has(file)) problems.push(`Missing file summary: ${file}`);
    if (!cases.some(c => c.file === file && c.passed && !c.skipped && !c.todo)) problems.push(`No ordinary executed cases: ${file}`);
  }
  for (const [file, counts] of summaries) {
    const selected = file === '<all>' ? cases : cases.filter(c => c.file === file);
    if (!counts || counts.tests !== selected.length || counts.passed !== selected.filter(c => c.passed && !c.skipped && !c.todo).length ||
      counts.skipped !== selected.filter(c => c.skipped).length || counts.todo !== selected.filter(c => c.todo).length || counts.failed || counts.cancelled)
      problems.push(`Summary disagrees with ordinary case results: ${file}`);
  }
  if (started.size !== terminal.size || completed.size !== terminal.size) problems.push('Unfinished test lifecycle');
  const named = new Set<string>();
  for (const c of cases) {
    const key = JSON.stringify([c.file, c.names]);
    if (named.has(key)) problems.push(`Ambiguous duplicate case: ${key}`);
    named.add(key);
  }
  for (const required of requiredCases) {
    const found = cases.find(c => c.file === required.file && JSON.stringify(c.names) === JSON.stringify(required.names));
    if (!found?.passed || found.skipped || found.todo) problems.push(`Required case did not pass ordinarily: ${required.file}: ${required.names.join(' > ')}`);
  }
  return { outcome: problems.length ? 'fail' as const : 'pass' as const, problems, cases, node: first.node, invocation: expected.invocation };
}
