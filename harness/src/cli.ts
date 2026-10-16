#!/usr/bin/env bun
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Controller } from './controller';
import { dispatch } from './protocol';
import { serve } from './mcp';

const controller = new Controller(process.env.SOVRAN_HARNESS_STATE ?? join(homedir(), '.local/state/sovran-harness'));
try {
  if (process.argv[2] === 'mcp') {
    const server = await serve(controller);
    const shutdown = async () => { await server.close(); controller.close(); process.exit(0); };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } else {
    const path = process.argv[2];
    if (!path) throw new Error('Usage: bun run harness <request.json | ->; or bun run harness mcp');
    const input: unknown = JSON.parse(await (path === '-' ? Bun.stdin : Bun.file(path)).text());
    console.log(JSON.stringify(await dispatch(controller, input), null, 2));
    controller.close();
  }
} catch (error) {
  controller.close();
  console.error(error instanceof Error ? error.message : 'Task operation failed');
  process.exitCode = 1;
}
