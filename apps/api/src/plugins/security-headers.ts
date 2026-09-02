import type { FastifyInstance } from 'fastify';

export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (_request, reply) => {
    void reply
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      .header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cache-control', 'no-store');
  });
}
