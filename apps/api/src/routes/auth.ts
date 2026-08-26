import type { FastifyPluginAsync } from 'fastify';
import { parseWith } from '../validation/parse.js';
import { loginSchema } from '../domain/authentication.js';
import { UnauthorizedError } from '../lib/errors.js';

/**
 * Authentication surface (Phase 8): login, current principal, logout.
 *
 * - Responses never contain secrets; the session token travels ONLY as an
 *   HttpOnly cookie.
 * - Invalid credentials return the SAME generic message for unknown emails
 *   and wrong passwords (no account enumeration).
 */
export const authRoutes: FastifyPluginAsync = async (app) => {
  const enabled = app.config.AUTH_ENABLED;

  app.post('/auth/login', async (request, reply) => {
    if (!enabled) {
      return reply.status(503).send({
        error: { code: 'AUTH_DISABLED', message: 'Authentication is disabled.', requestId: request.id },
      });
    }

    // Fastify already parsed the JSON body; validate shape/size here.
    const input = parseWith(loginSchema, request.body);
    const result = await app.authService.login(input);
    if (result === null) {
      throw new UnauthorizedError('Invalid email or password.');
    }

    void reply.header(
      'set-cookie',
      app.sessionCookieBuilder.build(result.token, app.sessionCookieBuilder.maxAgeSeconds, app.config.AUTH_COOKIE_SECURE)
    );
    return reply.status(200).send({
      user: {
        id: result.principal.userId,
        email: result.principal.email,
        memberships: result.principal.memberships,
      },
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  app.get('/auth/me', async (request, reply) => {
    if (!enabled) {
      return reply.status(503).send({
        error: { code: 'AUTH_DISABLED', message: 'Authentication is disabled.', requestId: request.id },
      });
    }
    if (request.principal === null) {
      throw new UnauthorizedError();
    }
    return reply.send({
      user: {
        id: request.principal.userId,
        email: request.principal.email,
        memberships: request.principal.memberships,
      },
    });
  });

  app.post('/auth/logout', async (request, reply) => {
    if (!enabled) {
      return reply.status(503).send({
        error: { code: 'AUTH_DISABLED', message: 'Authentication is disabled.', requestId: request.id },
      });
    }
    await app.authService.logout(request.sessionToken);
    void reply.header('set-cookie', app.sessionCookieBuilder.clear(app.config.AUTH_COOKIE_SECURE));
    return reply.status(204).send();
  });
};
