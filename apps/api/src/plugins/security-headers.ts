import type { FastifyInstance } from 'fastify';

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (_request, reply) => {
    void reply
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cache-control', 'no-store');
  });
}
