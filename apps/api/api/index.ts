import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance } from 'fastify';

let cachedApp: FastifyInstance | null = null;

async function getApp(): Promise<FastifyInstance> {
  if (cachedApp) return cachedApp;
  const { buildApp } = await import('../src/app.js');
  cachedApp = await buildApp();
  await cachedApp.ready();
  return cachedApp;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();

  const url = req.url ?? '/';
  const method = (req.method ?? 'GET') as string;

  const body = await new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

  const response = await app.inject({
    method,
    url,
    headers: req.headers as Record<string, string>,
    payload: body.length > 0 ? body : undefined,
  });

  res.writeHead(response.statusCode, response.headers);
  res.end(response.payload);
}
