import { z } from 'zod';

/**
 * Phase 8 — authentication & authorization domain.
 *
 * Separation of concerns:
 *   Authentication = who is this caller? (credentials → session → principal)
 *   Authorization  = which merchants/resources may this caller access?
 *
 * The authenticated principal and its SERVER-SIDE memberships are the only
 * source of merchant scope. Client-supplied merchantId is never trusted.
 */

export const USER_ROLES = ['OWNER', 'OPERATOR', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Roles permitted to trigger recovery execution / operational actions. */
export const EXECUTION_ROLES: readonly UserRole[] = ['OWNER', 'OPERATOR'];

export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantMembershipRow {
  id: string;
  userId: string;
  merchantId: string;
  role: UserRole;
}

export interface SessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Minimum identity + authorization information attached to a request. */
export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  /** Server-derived tenant memberships — never caller-supplied. */
  memberships: { merchantId: string; role: UserRole }[];
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

export interface CreateMembershipInput {
  userId: string;
  merchantId: string;
  role: UserRole;
}

export interface CreateSessionInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Persistence boundary for identity/membership/session records. Implemented
 * by the Prisma adapter in repositories/prisma-stores.ts.
 */
export interface AuthenticationStore {
  findUserByEmail(email: string): Promise<UserRow | null>;
  createUser(input: CreateUserInput): Promise<UserRow>;
  findMembershipsByUser(userId: string): Promise<MerchantMembershipRow[]>;
  findMembership(userId: string, merchantId: string): Promise<MerchantMembershipRow | null>;
  createMembership(input: CreateMembershipInput): Promise<MerchantMembershipRow>;
  createSession(input: CreateSessionInput): Promise<SessionRow>;
  /**
   * Resolves an ACTIVE (non-revoked, non-expired) session with its user.
   * Returns null for unknown/expired/revoked tokens alike (no enumeration).
   */
  findActiveSessionByTokenHash(tokenHash: string, now: Date): Promise<{
    session: SessionRow;
    user: UserRow;
    memberships: MerchantMembershipRow[];
  } | null>;
  revokeSession(tokenHash: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Validation schemas (login payload)
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Session cookie name; the value is the raw session token (opaque). */
export const SESSION_COOKIE_NAME = 'recoveryos_session';
