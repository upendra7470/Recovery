import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthenticatedPrincipal } from '../domain/authentication.js';
import { SESSION_COOKIE_NAME } from '../domain/authentication.js';
import type { AuthenticationService } from '../auth/authentication.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated principal; null when unauthenticated (or auth disabled). */
    principal: AuthenticatedPrincipal | null;
    /** Raw session token from the cookie — never logged. */
    sessionToken?: string;
  }
  interface FastifyInstance {
    authService: AuthenticationService;
  }
}

/** Paths that NEVER require user authentication. Provider webhooks keep
 * their own signature-based authentication; health/readiness are probes;
 * /auth/* is the authentication surface itself. */
const PUBLIC_PATHS: readonly string[] = [
  '/health',
  '/ready',
  '/webhooks/razorpay',
];

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (PUBLIC_PATHS.includes(path)) return true;
  if (path.startsWith('/auth/')) return true;
  return false;
}

function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) {
      return rest.join('=');
    }
  }
  return undefined;
}

function buildSessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export interface AuthPluginOptions {
  enabled: boolean;
  cookieSecure: boolean;
  sessionTtlHours: number;
  allowedWebOrigin?: string;
}

/**
 * Authentication plugin (Phase 8).
 *
 * - Resolves the session cookie into a request principal on every request.
 * - When enabled, unauthenticated requests to non-public paths are rejected
 *   with a deterministic 401 BEFORE any business logic runs.
 * - When disabled (development/test), the gate is inert and existing
 *   behavior is preserved bit-for-bit.
 * - Minimal hand-rolled credentialed CORS restricted to ONE configured web
 *   origin — no wildcard, no new dependencies.
 */
export const authenticationPlugin = async (
  app: FastifyInstance,
  options: AuthPluginOptions
): Promise<void> => {
  app.decorateRequest('principal', null);
  app.decorateRequest('sessionToken');

  const logger: FastifyBaseLogger = app.log;
  // Credentialed CORS restricted to the single configured origin.
  if (options.allowedWebOrigin !== undefined) {
    const allowedOrigin = options.allowedWebOrigin.replace(/\/+$/, '');
    app.addHook('onRequest', async (request, reply) => {
      const origin = request.headers.origin;
      if (origin === undefined) return;
      if (origin.replace(/\/+$/, '') !== allowedOrigin) return;

      void reply.header('access-control-allow-origin', allowedOrigin);
      void reply.header('access-control-allow-credentials', 'true');
      void reply.header('vary', 'Origin');

      if (request.method === 'OPTIONS') {
        void reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
        void reply.header('access-control-allow-headers', 'content-type');
        void reply.header('access-control-max-age', '600');
        await reply.status(204).send();
        return reply;
      }
      return reply;
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    const token = parseSessionCookie(request.headers.cookie);
    request.sessionToken = token;
    request.principal = await app.authService.resolvePrincipal(token);

    if (!options.enabled || isPublicPath(request.url)) {
      return reply;
    }
    if (request.principal === null) {
      logger.info(
        { event: 'auth_unauthenticated_request', path: request.url.split('?')[0] },
        'Unauthenticated request rejected'
      );
      await reply.status(401).send({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
          requestId: request.id,
        },
      });
      return reply;
    }
    return reply;
  });

  app.decorate('sessionCookieBuilder', {
    build: buildSessionCookie,
    clear: clearSessionCookie,
    maxAgeSeconds: options.sessionTtlHours * 60 * 60,
  } satisfies SessionCookieTools);

  void logger;
};

export interface SessionCookieTools {
  build(token: string, maxAgeSeconds: number, secure: boolean): string;
  clear(secure: boolean): string;
  maxAgeSeconds: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    sessionCookieBuilder: SessionCookieTools;
  }
}

export function readSessionToken(request: FastifyRequest): string | undefined {
  return request.sessionToken;
}
