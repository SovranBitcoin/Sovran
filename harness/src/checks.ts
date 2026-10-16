import { z } from 'zod';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const text = z.string().trim().min(1);
const base = { id: text, cwd: text.default('.'), timeoutMs: z.number().int().positive().max(3_600_000) };
export const requiredCase = z.object({ file: text, names: z.array(text).min(1) });
const inputPath = text.refine(p => !isAbsolute(p) && !p.includes('\\') && p.split('/').every(part => part && !['.', '..', '.git'].includes(part)), 'Use explicit repository test input paths');
export const regression = z.object({ testInputs: z.array(inputPath).min(1), cases: z.array(requiredCase).min(1) });
const nodeCheck = z.object({ ...base, cwd: z.literal('.').default('.'), kind: z.literal('node-tests'), files: z.array(text).min(1), requiredCases: z.array(requiredCase).min(1), regression: regression.optional() }).strict().superRefine((c, ctx) => {
  if (new Set(c.files).size !== c.files.length || c.requiredCases.some(r => !c.files.includes(r.file)) ||
      new Set(c.requiredCases.map(r => JSON.stringify(r))).size !== c.requiredCases.length)
    ctx.addIssue({ code: 'custom', message: 'Test selection requires unique files and unique cases in those files' });
  if (c.regression && (new Set(c.regression.testInputs).size !== c.regression.testInputs.length ||
    c.files.some(f => !c.regression?.testInputs.includes(f)) ||
    new Set(c.regression.cases.map(r => JSON.stringify(r))).size !== c.regression.cases.length ||
    c.regression.cases.some(r => !c.requiredCases.some(c => c.file === r.file && JSON.stringify(c.names) === JSON.stringify(r.names)))))
    ctx.addIssue({ code: 'custom', message: 'Regression inputs must include the selected files and unique cases from requiredCases' });
});
const platform = z.enum(['ios', 'android']);
/** Sealed stories played on fresh owned devices from bundled builds of the candidate (app/e2e/stories/bound.ts). */
const nativeCheck = z.object({ ...base, cwd: z.literal('.').default('.'), kind: z.literal('native-stories'),
  stories: z.array(inputPath.refine(p => p.startsWith('app/e2e/stories/') && p.endsWith('.json'), 'Stories live in app/e2e/stories')).min(1),
  platforms: z.array(platform).min(1) }).strict().superRefine((c, ctx) => {
  if (new Set(c.stories).size !== c.stories.length || new Set(c.platforms).size !== c.platforms.length)
    ctx.addIssue({ code: 'custom', message: 'Native checks name each story and platform once' });
});
export const command = z.union([nodeCheck, nativeCheck, z.object({ ...base, argv: z.array(text).min(1) }).strict()]);
type NodeCheck = z.infer<typeof nodeCheck>;
export type NativeCheck = z.infer<typeof nativeCheck>;
export const isNodeCheck = (c: z.infer<typeof command>): c is NodeCheck => 'kind' in c && c.kind === 'node-tests';
export const isNativeCheck = (c: z.infer<typeof command>): c is NativeCheck => 'kind' in c && c.kind === 'native-stories';

const failure = z.object({ code: z.string().optional(), failureType: z.string().optional(),
  cause: z.union([z.string(), z.object({ name: z.string().optional(), code: z.string().optional() }).passthrough()]).optional(),
}).passthrough();
const eventData = z.object({
  file: z.string().optional(), name: z.string().optional(), nesting: z.number().int().nonnegative().optional(),
  line: z.number().int().positive().optional(), column: z.number().int().positive().optional(),
  skip: z.union([z.boolean(), z.string()]).optional(), todo: z.union([z.boolean(), z.string()]).optional(),
  expectFailure: z.boolean().optional(),
  details: z.object({ type: z.string(), passed: z.boolean().optional(), error: failure.optional() }).optional(),
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
export function inspectNodeTests(raw: string, expected: { invocation: string; root: string; files: string[]; requiredCases: NodeCheck['requiredCases']; expectedFailures?: NodeCheck['requiredCases'] }) {
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
  const expectedFailures = (expected.expectedFailures ?? []).map(c => ({ ...c, file: normalize(resolve(expected.root, c.file)) }));
  if (new Set(files).size !== files.length) throw new Error('Test files alias the same source');
  const stacks = new Map<string, string[]>();
  const started = new Map<string, { file: string; names: string[] }>();
  const completed = new Map<string, { passed: boolean; type: string }>();
  const cases: { file: string; names: string[]; passed: boolean; skipped: boolean; todo: boolean; failure?: z.infer<typeof failure> }[] = [];
  const results: { file: string; names: string[]; passed: boolean; failure?: z.infer<typeof failure> }[] = [];
  const terminal = new Set<string>();
  const summaries = new Map<string, z.infer<typeof eventData>['counts']>();
  const problems: string[] = [];
  const identity = (d: z.infer<typeof eventData>) => JSON.stringify([d.file && normalize(d.file), d.line, d.column, d.name, d.nesting]);
  for (const r of records) {
    if (r.kind !== 'event') continue;
    const { type, data: d } = r.event;
    if (d.expectFailure) problems.push('Expected-failure assertions cannot establish ordinary behavior');
    if (type === 'test:summary') {
      const file = d.file ? normalize(d.file) : '<all>';
      if (summaries.has(file)) problems.push(`Duplicate run summary: ${file}`);
      if (!d.counts) throw new Error('Runner summary lacks case counts');
      summaries.set(file, d.counts);
      if (d.success !== (d.counts.failed === 0 && d.counts.cancelled === 0)) problems.push(`Runner success disagrees with counts: ${file}`);
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
      // Concurrent subtests can repeat this notification before their ordered terminal event.
      const previous = completed.get(key);
      if (previous && (previous.passed !== d.details.passed || previous.type !== d.details.type))
        problems.push(`Conflicting case completion: ${key}`);
      completed.set(key, { passed: d.details.passed, type: d.details.type });
    } else {
      const start = started.get(key), completion = completed.get(key);
      if (!start || !completion || !d.details || completion.type !== d.details.type || completion.passed !== (type === 'test:pass'))
        throw new Error('Case terminal result disagrees with its lifecycle');
      if (terminal.has(key)) problems.push(`Duplicate case result: ${key}`);
      terminal.add(key);
      const failed = type === 'test:fail' ? { failure: d.details.error } : {};
      results.push({ ...start, passed: type === 'test:pass', ...failed });
      if (d.details.type === 'test') cases.push({ ...start, ...failed, passed: type === 'test:pass', skipped: d.skip !== undefined && d.skip !== false, todo: d.todo !== undefined && d.todo !== false });
    }
  }
  if (!summaries.has('<all>')) problems.push('Missing overall runner summary');
  for (const file of files) {
    if (!summaries.has(file)) problems.push(`Missing file summary: ${file}`);
    if (!cases.some(c => c.file === file && !c.skipped && !c.todo)) problems.push(`No ordinary executed cases: ${file}`);
  }
  for (const [file, counts] of summaries) {
    const selected = file === '<all>' ? cases : cases.filter(c => c.file === file);
    if (!counts || counts.tests !== selected.length || counts.passed !== selected.filter(c => c.passed && !c.skipped && !c.todo).length ||
      counts.skipped !== selected.filter(c => c.skipped).length || counts.todo !== selected.filter(c => c.todo).length || counts.failed !== selected.filter(c => !c.passed && !c.todo && !c.skipped).length || counts.cancelled)
      problems.push(`Summary disagrees with ordinary case results: ${file}`);
  }
  if (started.size !== terminal.size || completed.size !== terminal.size) problems.push('Unfinished test lifecycle');
  const named = new Set<string>();
  for (const c of cases) {
    const key = JSON.stringify([c.file, c.names]);
    if (named.has(key)) problems.push(`Ambiguous duplicate case: ${key}`);
    named.add(key);
  }
  const same = (a: { file: string; names: string[] }, b: { file: string; names: string[] }) => a.file === b.file && JSON.stringify(a.names) === JSON.stringify(b.names);
  const isLeaf = (c: { file: string; names: string[] }) => !results.some(other => other.file === c.file && other.names.length > c.names.length && c.names.every((name,i) => other.names[i] === name));
  const acceptedFailures = cases.filter(c => expectedFailures.some(expected => same(c,expected)) && !c.passed && !c.skipped && !c.todo && isLeaf(c) &&
    c.failure?.code === 'ERR_TEST_FAILURE' && c.failure.failureType === 'testCodeFailure' &&
    typeof c.failure.cause === 'object' && c.failure.cause.name === 'AssertionError' && c.failure.cause.code === 'ERR_ASSERTION');
  for (const required of requiredCases) {
    const found = cases.find(c => same(c,required));
    const expectsFailure = expectedFailures.some(c => same(c,required));
    if (expectsFailure ? !acceptedFailures.some(c => same(c,required)) : !found?.passed || found.skipped || found.todo)
      problems.push(`Required case did not ${expectsFailure ? 'expose the baseline assertion' : 'pass ordinarily'}: ${required.file}: ${required.names.join(' > ')}`);
  }
  for (const result of results.filter(r => !r.passed)) {
    const propagated = result.failure?.failureType === 'subtestsFailed' && acceptedFailures.some(c => c.file === result.file &&
      c.names.length > result.names.length && result.names.every((name,i) => c.names[i] === name));
    if (!acceptedFailures.some(c => same(c,result)) && !propagated) problems.push(`Unexpected test failure: ${result.names.join(' > ')}`);
  }
  return { outcome: problems.length ? 'fail' as const : 'pass' as const, problems, cases, node: first.node, invocation: expected.invocation };
}

export const verificationPolicy = z.object({ version: z.literal(1), requirements: z.array(z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), requirement: text, check: text, cases: z.array(requiredCase).min(1), regression: z.boolean() }),
  z.object({ kind: z.literal('native'), requirement: text, check: text, stories: z.array(text).min(1), platforms: z.array(platform).min(1) }),
  z.object({ kind: z.literal('inspection'), requirement: text, rationale: text }),
])).min(1) });
export const oracleReview = z.object({ requirement: text, verdict: z.enum(['valid', 'invalid', 'unproven']),
  behavior: text, testInputs: text, negativeControl: text, producer: text, evidence: z.array(text).min(1) });

export function validateVerification(spec: { requirements: {id:string}[]; checks: z.infer<typeof command>[]; verificationPolicy?: z.infer<typeof verificationPolicy> }) {
  const policy = spec.verificationPolicy;
  if (!policy) return;
  if (new Set(policy.requirements.map(r=>r.requirement)).size !== policy.requirements.length ||
      policy.requirements.length !== spec.requirements.length || policy.requirements.some(r=>!spec.requirements.some(c=>c.id===r.requirement)))
    throw new Error('Verification policy must cover each requirement exactly once');
  for (const rule of policy.requirements) if (rule.kind === 'node') {
    const check = spec.checks.find(c=>c.id===rule.check);
    if (!check || !isNodeCheck(check)) throw new Error('Behavior verification needs a named Node check, not process exit alone');
    const same = (a:z.infer<typeof requiredCase>,b:z.infer<typeof requiredCase>)=>a.file===b.file && JSON.stringify(a.names)===JSON.stringify(b.names);
    if (rule.cases.some(c=>!check.requiredCases.some(r=>same(r,c)))) throw new Error('Verification case is not required by its check');
    if (rule.regression && rule.cases.some(c=>!check.regression?.cases.some(r=>same(r,c)))) throw new Error('Regression requirement lacks a sealed baseline comparison');
  } else if (rule.kind === 'native') {
    const check = spec.checks.find(c=>c.id===rule.check);
    if (!check || !isNativeCheck(check)) throw new Error('Native verification needs a named native-stories check');
    if (rule.stories.some(s=>!check.stories.includes(s)) || rule.platforms.some(p=>!check.platforms.includes(p)))
      throw new Error('Native verification names a story or platform its check does not play');
  }
}
