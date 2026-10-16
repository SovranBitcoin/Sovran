import { createMachine, transition } from 'xstate';
import { z } from 'zod';
import { command, verificationPolicy, oracleReview } from './checks';
import { publishPlan } from './publisher';
import { reference } from './references';
import { historyPolicy, historyEntry, historyReview } from './history';
import { resolutionProposal, resolutionReview } from './evidence';
import { availability, dispatchRejection, model, models, role, runtimeTask } from './models';
export { role } from './models';

const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const contract = z.object({
  historyPolicy: historyPolicy.optional(),
  verificationPolicy: verificationPolicy.optional(),
  problem: text,
  requirements: z.array(z.object({ id: text, outcome: text })).min(1),
  scope: z.array(text).min(1),
  risks: z.array(z.enum(['ui', 'persistence', 'payments', 'performance'])),
  checks: z.array(command).min(1),
  auditChecks: z.array(command).min(1),
  contextFiles: z.array(text).min(1),
  references: z.array(reference).default([]),
  allowedDependencies: z.array(text).default([]),
  models,
  limits: z.object({ deadline: z.iso.datetime(), repairRounds: z.number().int().min(0).max(20) }),
  publish: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('local-only') }),
    z.object({ kind: z.literal('pull-request'), remote: text, base: text, branch: text,
      repository: text, remoteUrl: text, baseHead: text, previousRemoteHead: text.nullable(),
      requiredChecks: z.array(text).min(1) }),
  ]),
}).superRefine((value, ctx) => {
  for (const [name, ids] of [
    ['requirements', value.requirements.map(r => r.id)],
    ['commands', [...value.checks, ...value.auditChecks].map(c => c.id)],
  ] satisfies [string, string[]][]) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${name}` });
  }
  if ([...value.checks, ...value.auditChecks].some(c => c.id.startsWith('harness:')))
    ctx.addIssue({ code: 'custom', message: 'harness: check ids are reserved for controller gates' });
});
export type Contract = z.infer<typeof contract>;
export type Role = z.infer<typeof role>;
const phase = z.enum(['researching', 'intake', 'implementing', 'verifying', 'reviewing', 'adversarial', 'auditing', 'diversityReviewing', 'publishable', 'publishing', 'ci', 'ready', 'incomplete', 'cancelled']);
const artifact = z.object({ path: text, sha256: hash });
const receipt = z.object({
  id: text, source: hash, artifacts: z.array(artifact).min(1),
  outcome: z.enum(['pass', 'fail', 'inconclusive']), summary: text,
});
export const assessment = z.object({
  verdict: z.enum(['pass', 'fail', 'inconclusive']),
  summary: text,
  observations: z.array(z.object({ requirement: text, evidence: text, observation: text })).min(1),
  findings: z.array(z.object({ id: text, severity: z.enum(['blocking', 'follow-up']), evidence: text, detail: text })),
  reuse: z.object({ searched: z.array(text).min(1), used: z.array(text), added: z.array(text), removed: z.array(text) }),
  history: z.array(historyEntry).optional(),
  historyReview: z.array(historyReview).optional(),
  oracleReviews: z.array(oracleReview).optional(),
  resolutionProposals: z.array(resolutionProposal).optional(),
  resolutionReviews: z.array(resolutionReview).optional(),
  inspections: z.array(z.object({ path: text, sha256: hash, observation: text })).default([]),
});
// Parts only one role may submit. Each brief shows its role this narrower shape, so a
// worker is never offered a field the controller will refuse from it.
const roleOwnedFields = { history: 'research', historyReview: 'audit', resolutionProposals: 'implementation', resolutionReviews: 'audit' } as const;
export function assessmentFor(selected: Role) {
  const foreign = Object.entries(roleOwnedFields).filter(([, owner]) => owner !== selected).map(([field]) => [field, true]);
  return assessment.omit(Object.fromEntries(foreign) as Partial<Record<keyof typeof roleOwnedFields, true>>);
}
const ticket = z.object({
  id: text, role, target: model,
  claim: z.object({ worker: text, provider: text, model: text }).nullable(),
  candidateIndex: z.number().int().nonnegative().default(0),
  sourceAtIssue: hash.nullable().default(null),
  dispatch: z.object({ coordinator: text, session: text, requestId: text }).nullable().default(null),
  runtime: runtimeTask.nullable().default(null),
});
const legacyPublication = z.object({ kind: z.literal('pull-request'), remote: text, base: text, branch: text })
  .catchall(z.json()).transform(original => ({ kind: 'legacy-pull-request' as const, original }));
// Preserve earlier intake data for inspection/cancellation without inventing the
// repository, revisions or CI authority that it never recorded.
const storedContract = z.object({ ...contract.shape, publish: z.union([
  contract.shape.publish,
  z.object({ kind: z.literal('legacy-pull-request'), original: z.record(z.string(), z.json()) }),
  legacyPublication,
]) });
export const task = z.object({
  version: z.literal(1), id: text, root: text, base: text, contract: storedContract,
  phase, generation: z.number().int().nonnegative(),
  source: hash.nullable(), policy: hash, ticket: ticket.nullable(),
  context: z.array(artifact), receipts: z.array(receipt),
  history: z.array(receipt).default([]),
  referenceEvidence: artifact.nullable().default(null),
  historyEvidence: artifact.optional(),
  ciObservations: z.array(artifact).optional(),
  assessments: z.array(z.object({ role, source: hash, worker: text, result: assessment, artifact, generation: z.number().int().nonnegative().optional() })),
  attempts: z.array(z.object({
    ticket, generation: z.number().int().nonnegative(), sourceAfter: hash,
    completion: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('submitted'), verdict: assessment.shape.verdict, runtime: runtimeTask.nullable() }),
      z.object({ kind: z.literal('unavailable'), reason: availability, runtime: runtimeTask, detail: text }),
      z.object({ kind: z.literal('dispatch-rejected'), reason: availability, rejection: dispatchRejection }),
      z.object({ kind: z.literal('stopped'), reason: text }),
    ]),
  })).default([]),
  pending: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('command'), id: text, pid: z.number().int().positive().optional() }),
    z.object({ kind: z.literal('publish'), head: text }),
  ]),
  publication: publishPlan.nullable().default(null),
  reason: z.string(), pr: z.object({ url: z.url(), head: text, number: z.number().int().positive() }).nullable(),
});
export type Task = z.infer<typeof task>;

const machine = createMachine({
  id: 'full-send', initial: 'researching',
  on: { STOP: '.incomplete', CANCEL: '.cancelled' },
  states: {
    researching: { on: { ACCEPT: 'intake' } },
    intake: { on: { SEAL: 'implementing' } },
    implementing: { on: { ACCEPT: 'verifying' } },
    verifying: { on: { ACCEPT: 'reviewing', REPAIR: 'implementing' } },
    reviewing: { on: { ACCEPT: 'adversarial', REPAIR: 'implementing' } },
    adversarial: { on: { ACCEPT: 'auditing', REPAIR: 'implementing' } },
    auditing: { on: { ACCEPT: 'publishable', DIVERSITY: 'diversityReviewing', REPAIR: 'implementing' } },
    diversityReviewing: { on: { ACCEPT: 'publishable', REPAIR: 'implementing' } },
    publishable: { on: { PUBLISH: 'publishing' } },
    publishing: { on: { ACCEPT: 'ci' } },
    ci: { on: { ACCEPT: 'ready', REPAIR: 'implementing' } },
    ready: { type: 'final' }, incomplete: { type: 'final' }, cancelled: { type: 'final' },
  },
});

export function move(current: Task, event: 'ACCEPT' | 'SEAL' | 'REPAIR' | 'PUBLISH' | 'STOP' | 'CANCEL' | 'DIVERSITY'): Task {
  const before = machine.resolveState({ value: current.phase });
  if (!before.can({ type: event })) throw new Error(`Cannot ${event} from ${current.phase}`);
  const [after] = transition(machine, before, { type: event });
  return { ...current, phase: phase.parse(after.value) };
}

export function roleFor(state: Task['phase']): Role | null {
  switch (state) {
    case 'researching': return 'research';
    case 'implementing': return 'implementation';
    case 'reviewing': return 'review';
    case 'adversarial': return 'adversary';
    case 'auditing': return 'audit';
    case 'diversityReviewing': return 'diversityReview';
    default: return null;
  }
}
