import type { APIRoute } from 'astro';
import bytes from '../../../../copy/legal/documents.json?raw';

// Emit the canonical bytes, not a separately serialized or edited policy copy.
export const GET: APIRoute = () => new Response(bytes, { headers: { 'Content-Type': 'application/json' } });
