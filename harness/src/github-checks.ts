import { z } from 'zod';
import type { PublishPlan } from './publisher';

const text = z.string().min(1), sha = z.string().regex(/^[a-f0-9]{40}$/);
const requirement = z.object({ name: text, appId: z.number().int().nullable() });
const workflow = z.object({ databaseId: z.number().int(), runNumber: z.number().int(), runAttempt: z.number().int(),
  event: text, file: z.object({ path: text }), workflow: z.object({ databaseId: z.number().int(), name: text }) });
const context = z.discriminatedUnion('__typename', [
  z.object({ __typename: z.literal('CheckRun'), id: text, name: text, status: text, conclusion: z.string().nullable(),
    isRequired: z.boolean(), detailsUrl: z.string().nullable(), checkSuite: z.object({ databaseId: z.number().int(),
      commit: z.object({ oid: sha }), app: z.object({ databaseId: z.number().int(), slug: text }).nullable(), workflowRun: workflow.nullable() }) }),
  z.object({ __typename: z.literal('StatusContext'), id: text, context: text, state: text, isRequired: z.boolean(),
    targetUrl: z.string().nullable(), commit: z.object({ oid: sha }) }),
]);
const page = z.object({ data: z.object({ repository: z.object({ pullRequest: z.object({ headRefOid: sha, baseRefOid: sha,
  statusCheckRollup: z.object({ commit: z.object({ oid: sha }), contexts: z.object({ totalCount: z.number().int(),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }), nodes: z.array(context) }) }).nullable(),
}) }) }), errors: z.array(z.unknown()).optional() });
const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String) {
  repository(owner:$owner,name:$name) { pullRequest(number:$number) { headRefOid baseRefOid
    statusCheckRollup { commit { oid } contexts(first:100,after:$cursor) { totalCount pageInfo {hasNextPage endCursor} nodes {
      __typename
      ... on CheckRun { id name status conclusion isRequired(pullRequestNumber:$number) detailsUrl
        checkSuite { databaseId commit {oid} app {databaseId slug}
          workflowRun {databaseId runNumber runAttempt event file {path} workflow {databaseId name}} } }
      ... on StatusContext {id context state isRequired(pullRequestNumber:$number) targetUrl commit {oid}}
    } } }
  } }
}`;
type Api = (args: string[]) => { code: number; text: string };
const nameOf = (c: z.infer<typeof context>) => c.__typename === 'CheckRun' ? c.name : c.context;
const appOf = (c: z.infer<typeof context>) => c.__typename === 'CheckRun' ? c.checkSuite.app?.databaseId ?? null : null;

/** One read-only evidence boundary: policy, all returned attempts, and exact head/base association. */
export function githubChecks(p: PublishPlan, number: number, api: Api) {
  const get = (args: string[]) => {
    const out = api(args);
    if (out.code !== 0) throw new Error('GitHub CI evidence unavailable');
    const value: unknown = JSON.parse(out.text);
    return value;
  };
  const endpoint = `repos/${p.repository}`;
  const policy = () => {
    const branch = z.object({ protected: z.boolean(), commit: z.object({ sha }) })
      .parse(get([`${endpoint}/branches/${encodeURIComponent(p.base)}`]));
    if (branch.commit.sha !== p.baseHead) throw new Error('Base changed during policy discovery');
    const classic = branch.protected ? z.object({ required_status_checks: z.object({ contexts: z.array(text),
      checks: z.array(z.object({ context: text, app_id: z.number().int().nullable() })) }).nullable().optional() })
      .parse(get([`${endpoint}/branches/${encodeURIComponent(p.base)}/protection`])) : null;
    const rules = z.array(z.array(z.object({ type: text, parameters: z.unknown().optional() }).passthrough()))
      .parse(get([`${endpoint}/rules/branches/${encodeURIComponent(p.base)}?per_page=100`, '--paginate', '--slurp'])).flat();
    const required: z.infer<typeof requirement>[] = [];
    const classicChecks = classic?.required_status_checks;
    if (classicChecks) {
      required.push(...classicChecks.checks.map(c => ({ name: c.context, appId: c.app_id === -1 ? null : c.app_id })));
      required.push(...classicChecks.contexts.filter(name => !required.some(c => c.name === name)).map(name => ({ name, appId: null })));
    }
    for (const rule of rules) if (rule.type === 'required_status_checks') {
      const parameters = z.object({ required_status_checks: z.array(z.object({ context: text, integration_id: z.number().int().nullable().optional() })) }).parse(rule.parameters);
      required.push(...parameters.required_status_checks.map(c => ({ name: c.context, appId: c.integration_id ?? null })));
    }
    const unique = [...new Map(required.map(r => [JSON.stringify(r), r])).values()].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { branch, classic, rules, required: unique };
  };
  const beforePolicy = policy();
  const checks: z.infer<typeof context>[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let total: number | null = null;
  for (let n = 0; ; n++) {
    if (n >= 50) throw new Error('CI pagination exceeds bounded observation');
    const [owner, name] = p.repository.split('/');
    if (!owner || !name) throw new Error('Missing repository identity');
    const response = page.parse(get(['graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `name=${name}`,
      '-F', `number=${number}`, ...(cursor ? ['-f', `cursor=${cursor}`] : [])]));
    if (response.errors?.length) throw new Error('Partial GraphQL CI evidence');
    const pr = response.data.repository.pullRequest;
    if (pr.headRefOid !== p.head || pr.baseRefOid !== p.baseHead || (pr.statusCheckRollup && pr.statusCheckRollup.commit.oid !== p.head))
      throw new Error('CI evidence belongs to another head or base');
    if (!pr.statusCheckRollup) { if (checks.length) throw new Error('CI rollup disappeared during pagination'); break; }
    const contexts = pr.statusCheckRollup.contexts;
    if (total !== null && total !== contexts.totalCount) throw new Error('CI contexts changed during pagination');
    total = contexts.totalCount;
    for (const c of contexts.nodes) {
      if ((c.__typename === 'CheckRun' ? c.checkSuite.commit.oid : c.commit.oid) !== p.head) throw new Error('Stale check revision');
      if (checks.some(old => old.id === c.id)) throw new Error('Repeated CI context during pagination');
      checks.push(c);
    }
    if (!contexts.pageInfo.hasNextPage) { if (checks.length !== total) throw new Error('Incomplete CI context pages'); break; }
    cursor = contexts.pageInfo.endCursor;
    if (!cursor || seenCursors.has(cursor)) throw new Error('Invalid CI pagination cursor');
    seenCursors.add(cursor);
  }
  const required = [...beforePolicy.required, ...p.requiredChecks.map(name => ({ name, appId: null })),
    ...checks.filter(c => c.isRequired).map(c => ({ name: nameOf(c), appId: appOf(c) }))];
  const obligations = [...new Map(required.map(r => [JSON.stringify(r), r])).values()];
  const problems: string[] = [];
  let failed = false;
  const associations = new Map<number, unknown>();
  const selected: { requirement: z.infer<typeof requirement>; check: string }[] = [];
  for (const obligation of obligations) {
    let matches = checks.filter(c => nameOf(c) === obligation.name && (obligation.appId === null || appOf(c) === obligation.appId));
    // Run numbering has authority only within one app/workflow/file/event. Never choose any passing duplicate.
    if (matches.length > 1 && matches.every(c => c.__typename === 'CheckRun' && c.checkSuite.workflowRun)) {
      const identities = new Set(matches.map(c => c.__typename === 'CheckRun' ? JSON.stringify([
        appOf(c), c.checkSuite.workflowRun?.workflow.databaseId, c.checkSuite.workflowRun?.file.path, c.checkSuite.workflowRun?.event]) : c.id));
      if (identities.size === 1) {
        const ordered = matches.filter(c => c.__typename === 'CheckRun').sort((a,b) =>
          (b.checkSuite.workflowRun?.runNumber ?? 0) - (a.checkSuite.workflowRun?.runNumber ?? 0) ||
          (b.checkSuite.workflowRun?.runAttempt ?? 0) - (a.checkSuite.workflowRun?.runAttempt ?? 0));
        const latest = ordered[0]?.checkSuite.workflowRun;
        matches = ordered.filter(c => c.checkSuite.workflowRun?.runNumber === latest?.runNumber && c.checkSuite.workflowRun?.runAttempt === latest?.runAttempt);
      }
    }
    const check = matches.length === 1 ? matches[0] : undefined;
    if (!check) { problems.push(`${obligation.name}: ${matches.length ? 'ambiguous publishers or attempts' : 'missing'}`); continue; }
    if (check.__typename === 'CheckRun' && !check.checkSuite.app) {
      problems.push(`${obligation.name}: check publisher identity is missing`); continue;
    }
    if (check.__typename === 'CheckRun' && check.checkSuite.app?.slug === 'github-actions' && !check.checkSuite.workflowRun) {
      problems.push(`${obligation.name}: GitHub Actions workflow identity is missing`); continue;
    }
    if (check.__typename === 'CheckRun' && check.checkSuite.workflowRun) {
      const run = check.checkSuite.workflowRun;
      if (!associations.has(run.databaseId)) associations.set(run.databaseId, get([`${endpoint}/actions/runs/${run.databaseId}`]));
      const observed = z.object({ id: z.number().int(), head_sha: sha, run_attempt: z.number().int(), run_number: z.number().int(),
        event: text, workflow_id: z.number().int(), pull_requests: z.array(z.object({ number: z.number().int(),
          head: z.object({ sha }), base: z.object({ sha }) })) }).parse(associations.get(run.databaseId));
      if (observed.id !== run.databaseId || observed.head_sha !== p.head || observed.run_attempt !== run.runAttempt ||
        observed.run_number !== run.runNumber || observed.workflow_id !== run.workflow.databaseId || observed.event !== run.event ||
        !observed.pull_requests.some(pr => pr.number === number && pr.head.sha === p.head && pr.base.sha === p.baseHead)) {
        problems.push(`${obligation.name}: workflow run is not bound to this PR head and base`); continue;
      }
    }
    selected.push({ requirement: obligation, check: check.id });
    const state = check.__typename === 'CheckRun' ? (check.status === 'COMPLETED' ? check.conclusion : check.status) : check.state;
    if (state !== 'SUCCESS') problems.push(`${obligation.name}: ${state}`);
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(state ?? '')) failed = true;
  }
  // Checks outside the sealed and server-required sets bind nothing; they are disclosed, never selected.
  const chosen = new Set(selected.map(s => s.check));
  const outsideRequired = checks.filter(c => !chosen.has(c.id)).flatMap(c => {
    const state = c.__typename === 'CheckRun' ? (c.status === 'COMPLETED' ? c.conclusion : c.status) : c.state;
    return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state ?? '') ? [] : [`${nameOf(c)}: ${state}`];
  });
  const afterPolicy = policy();
  if (JSON.stringify(beforePolicy) !== JSON.stringify(afterPolicy)) throw new Error('GitHub requirements changed during observation');
  return { checks, selected, associations: [...associations].map(([id, evidence]) => ({ id, evidence })),
    serverPolicy: beforePolicy, sealedRequiredChecks: p.requiredChecks,
    requiredChecks: [...new Set(obligations.map(o => o.name))], problems, failed, outsideRequired };
}
