import { createMachine, transition } from 'xstate';
import { z } from 'zod';

const text = z.string().trim().min(1);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const role = z.enum(['research', 'implementation', 'review', 'adversary', 'audit']);
export const model = z.object({ provider: text, model: text });
export const command = z.object({
  id: text, argv: z.array(text).min(1), cwd: text.default('.'),
  timeoutMs: z.number().int().positive().max(3_600_000),
});
export const contract = z.object({
  problem: text,
  requirements: z.array(z.object({ id: text, outcome: text })).min(1),
  scope: z.array(text).min(1),
  risks: z.array(z.enum(['ui', 'persistence', 'payments', 'performance'])),
  checks: z.array(command).min(1),
  auditChecks: z.array(command).min(1),
  contextFiles: z.array(text).min(1),
  allowedDependencies: z.array(text).default([]),
  models: z.object({ research: model, implementation: model, review: model, adversary: model, audit: model }),
  limits: z.object({ deadline: z.iso.datetime(), repairRounds: z.number().int().min(0).max(20) }),
  publish: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('local-only') }),
    z.object({ kind: z.literal('pull-request'), remote: text, base: text, branch: text }),
  ]),
}).superRefine((value, ctx) => {
  for (const [name, ids] of [
    ['requirements', value.requirements.map(r => r.id)],
    ['commands', [...value.checks, ...value.auditChecks].map(c => c.id)],
  ] satisfies [string, string[]][]) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${name}` });
  }
  if (value.models.implementation.provider === value.models.review.provider)
    ctx.addIssue({ code: 'custom', message: 'Implementation and independent review must use different providers' });
});
export type Contract = z.infer<typeof contract>;
export type Role = z.infer<typeof role>;
export const phase = z.enum(['researching', 'intake', 'implementing', 'verifying', 'reviewing', 'adversarial', 'auditing', 'publishable', 'publishing', 'ci', 'ready', 'incomplete', 'cancelled']);
export const artifact = z.object({ path: text, sha256: hash });
export const receipt = z.object({
  id: text, source: hash, artifacts: z.array(artifact).min(1),
  outcome: z.enum(['pass', 'fail', 'inconclusive']), summary: text,
});
export const assessment = z.object({
  verdict: z.enum(['pass', 'fail', 'inconclusive']),
  summary: text,
  observations: z.array(z.object({ requirement: text, evidence: text, observation: text })).min(1),
  findings: z.array(z.object({ id: text, severity: z.enum(['blocking', 'follow-up']), evidence: text, detail: text })),
  reuse: z.object({ searched: z.array(text).min(1), used: z.array(text), added: z.array(text), removed: z.array(text) }),
});
export const ticket = z.object({
  id: text, role, target: model,
  claim: z.object({ worker: text, provider: text, model: text }).nullable(),
});
export const task = z.object({
  version: z.literal(1), id: text, root: text, base: text, contract,
  phase, generation: z.number().int().nonnegative(),
  source: hash.nullable(), policy: hash, ticket: ticket.nullable(),
  context: z.array(artifact), receipts: z.array(receipt),
  assessments: z.array(z.object({ role, source: hash, worker: text, result: assessment, artifact })),
  pending: z.discriminatedUnion('kind', [z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('command'), id: text }),
    z.object({ kind: z.literal('publish'), head: text }),
  ]),
  reason: z.string(), pr: z.object({ url: z.url(), head: text }).nullable(),
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
    auditing: { on: { ACCEPT: 'publishable', REPAIR: 'implementing' } },
    publishable: { on: { PUBLISH: 'publishing' } },
    publishing: { on: { ACCEPT: 'ci' } },
    ci: { on: { ACCEPT: 'ready', REPAIR: 'implementing' } },
    ready: { type: 'final' }, incomplete: { type: 'final' }, cancelled: { type: 'final' },
  },
});

export function move(current: Task, event: 'ACCEPT' | 'SEAL' | 'REPAIR' | 'PUBLISH' | 'STOP' | 'CANCEL'): Task {
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
    default: return null;
  }
}
