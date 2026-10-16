import { z } from 'zod';
import { Controller } from './controller';
import { assessment, contract } from './workflow';

const id = z.string().uuid();
const text = z.string().min(1);
export const request = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), root: text, contract }),
  z.object({ action: z.literal('status'), id }),
  z.object({ action: z.literal('next'), id }),
  z.object({ action: z.literal('seal'), id, policy: text }),
  z.object({ action: z.literal('claim'), id, ticket: text, worker: text, provider: text, model: text }),
  z.object({ action: z.literal('submit'), id, ticket: text, worker: text, assessment }),
  z.object({ action: z.literal('verify'), id, audit: z.boolean().default(false) }),
  z.object({ action: z.literal('repair'), id, reason: text }),
  z.object({ action: z.literal('stop'), id, key: text, reason: text, cancel: z.boolean().default(false) }),
]);

export async function dispatch(controller: Controller, input: unknown) {
  const r = request.parse(input);
  switch (r.action) {
    case 'create': return controller.create(r.root, r.contract);
    case 'status': return controller.read(r.id);
    case 'next': return controller.next(r.id);
    case 'seal': return controller.seal(r.id, r.policy);
    case 'claim': return controller.claim(r.id, r.ticket, r.worker, r.provider, r.model);
    case 'submit': return controller.submit(r.id, r.ticket, r.worker, r.assessment);
    case 'verify': return controller.verify(r.id, r.audit);
    case 'repair': return controller.repair(r.id, r.reason);
    case 'stop': return controller.stop(r.id, r.key, r.reason, r.cancel);
  }
}
