import type { APIRoute } from 'astro';
export const GET: APIRoute = () => new Response('healthy\n', { headers: { 'Content-Type': 'text/plain' } });
