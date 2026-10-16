import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Controller } from './controller';
import { dispatch, request as requestSchema } from './protocol';

export async function serve(controller: Controller) {
  const server = new McpServer({ name: 'sovran-task-harness', version: '1.0.0' });
  server.registerTool('task', {
    description: 'Drive the durable Sovran workflow. Call next for the current dispatch ticket; stages and evidence gates cannot be skipped. Input uses the same JSON request as the CLI. The host is trusted; this is not a shell sandbox.',
    inputSchema: { request: requestSchema },
  }, async ({ request }) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await dispatch(controller, request)) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'Task operation failed' }] };
    }
  });
  await server.connect(new StdioServerTransport());
  return server;
}
