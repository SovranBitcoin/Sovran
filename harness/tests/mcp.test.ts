import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('the official MCP client reaches the controller and receives a failed gate as an error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'harness-mcp-'));
  const client = new Client({ name: 'harness-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(import.meta.dir, '../src/cli.ts'), 'mcp'], env: { SOVRAN_HARNESS_STATE: dir }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map(t => t.name)).toEqual(['task']);
    const result = await client.callTool({ name: 'task', arguments: { request: { action: 'seal', id: '00000000-0000-4000-8000-000000000001', policy: 'missing' } } });
    expect(result.isError).toBe(true);
  } finally { await client.close(); rmSync(dir, { recursive: true, force: true }); }
});
