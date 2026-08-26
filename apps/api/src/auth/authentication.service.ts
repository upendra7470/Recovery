import type {
  AuthenticatedPrincipal,
  AuthenticationStore,
  LoginInput,
} from '../domain/authentication.js';
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from './credentials.js';

export interface AuthenticationConfig {
  sessionTtlHours: number;
}



export interface LoginResult {
  token: string;
  expiresAt: Date;
  principal: AuthenticatedPrincipal;
}

/**
 * Authentication service: credentials → session token → principal.
 *
 * Security properties:
 * - passwords hashed with scrypt; never logged, never returned;
 * - only the SHA-256 hash of the session token is persisted;
 * - unknown email and wrong password are indistinguishable;
 * - expired/revoked sessions resolve to null like unknown tokens.
 */
export class AuthenticationService {
  constructor(
    private readonly store: AuthenticationStore,
    private readonly config: AuthenticationConfig,
    private readonly logger?: { warn(obj: Record<string, unknown>, msg?: string): void }
  ) {}

  async login(input: LoginInput): Promise<LoginResult | null> {
    const user = await this.store.findUserByEmail(input.email);
    if (user === null) {
      // Burn comparable time so response latency doesn't reveal existence.
      await hashPassword(input.password);
      return null;
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      this.logger?.warn(
        { event: 'auth_login_failed', userId: user.id },
        'Login failed: invalid credentials'
      );
      return null;
    }

    const memberships = await this.store.findMembershipsByUser(user.id);
    const token = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 60 * 60 * 1000);
    await this.store.createSession({
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });

    return {
      token,
      expiresAt,
      principal: toPrincipal(user, memberships),
    };
  }

  /** Resolves the principal for a raw session token (null when invalid). */
  async resolvePrincipal(rawToken: string | undefined): Promise<AuthenticatedPrincipal | null> {
    if (rawToken === undefined || rawToken.trim() === '') {
      return null;
    }
    const found = await this.store.findActiveSessionByTokenHash(
      hashSessionToken(rawToken),
      new Date()
    );
    if (found === null) {
      return null;
    }
    return toPrincipal(found.user, found.memberships);
  }

  /** Revokes the session for a raw token (idempotent; safe on unknown tokens). */
  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken === undefined || rawToken.trim() === '') {
      return;
    }
    await this.store.revokeSession(hashSessionToken(rawToken));
  }

  /** Provisioning helper for seeding/tests — hashes before persisting. */
  async createUser(email: string, password: string) {
    return this.store.createUser({
      email: email.trim().toLowerCase(),
      passwordHash: await hashPassword(password),
    });
  }

  async createMembership(userId: string, merchantId: string, role: Parameters<AuthenticationStore['createMembership']>[0]['role']) {
    return this.store.createMembership({ userId, merchantId, role });
  }
}

function toPrincipal(
  user: { id: string; email: string },
  memberships: { merchantId: string; role: 'OWNER' | 'OPERATOR' | 'VIEWER' }[]
): AuthenticatedPrincipal {
  return {
    userId: user.id,
    email: user.email,
    memberships: memberships.map((m) => ({ merchantId: m.merchantId, role: m.role })),
  };
}
