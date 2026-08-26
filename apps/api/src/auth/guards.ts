import type { AuthenticatedPrincipal, UserRole } from '../domain/authentication.js';
import { EXECUTION_ROLES } from '../domain/authentication.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../lib/errors.js';

/**
 * Centralized authorization helpers (Phase 8). Pure functions over the
 * authenticated principal — routes call these BEFORE any business logic.
 *
 * Invariants:
 * - merchant scope is ALWAYS derived from server-side memberships;
 * - caller-supplied merchantId is validated against that scope;
 * - cross-tenant objects surface as 404 (anti-enumeration), never 403 with
   tenant details.
 */

/** True when the principal may act within `merchantId`. */
export function hasMerchantAccess(
  principal: AuthenticatedPrincipal,
  merchantId: string | null
): boolean {
  if (merchantId === null) {
    return false; // unlinked legacy rows are inaccessible to authenticated tenants
  }
  return principal.memberships.some((membership) => membership.merchantId === merchantId);
}

/**
 * Resolves the effective merchant scope for a request.
 * - explicit merchantId: must be within the principal's memberships
 *   (403 FORBIDDEN otherwise — the tenant's existence is known to the caller).
 * - omitted: auto-derived when the principal belongs to exactly one tenant;
 *   multi-tenant principals must state their scope explicitly (400).
 */
export function requireMerchantScope(
  principal: AuthenticatedPrincipal,
  requestedMerchantId?: string
): string {
  if (requestedMerchantId !== undefined) {
    if (!hasMerchantAccess(principal, requestedMerchantId)) {
      throw new ForbiddenError('You do not have access to this merchant.');
    }
    return requestedMerchantId;
  }
  const unique = new Set(principal.memberships.map((m) => m.merchantId));
  if (unique.size === 0) {
    throw new ForbiddenError('No merchant membership is associated with this account.');
  }
  if (unique.size === 1) {
    return [...unique][0]!;
  }
  throw Object.assign(new Error('Multiple merchants are associated with this account; specify merchantId.'), {
    statusCode: 400,
    code: 'MERCHANT_SCOPE_REQUIRED',
  });
}

/** Set of merchant ids the principal can access (for aggregate scoping). */
export function allowedMerchantIds(principal: AuthenticatedPrincipal): Set<string> {
  return new Set(principal.memberships.map((m) => m.merchantId));
}

/**
 * Object-level authorization. Cross-tenant objects throw NotFoundError so
 * UUID enumeration cannot distinguish "missing" from "someone else's".
 * Unlinked (null-merchant) legacy rows are likewise hidden from tenants.
 */
export function assertObjectAccess(
  principal: AuthenticatedPrincipal,
  resourceMerchantId: string | null,
  resourceLabel: string
): void {
  if (!hasMerchantAccess(principal, resourceMerchantId)) {
    throw new NotFoundError(resourceLabel);
  }
}

/** Role gate for operational/dangerous actions (execution etc.). */
export function requireRole(
  principal: AuthenticatedPrincipal,
  merchantId: string | null,
  allowed: readonly UserRole[]
): void {
  if (!hasMerchantAccess(principal, merchantId)) {
    throw new NotFoundError('Resource');
  }
  const membership = principal.memberships.find((m) => m.merchantId === merchantId);
  if (membership === undefined || !allowed.includes(membership.role)) {
    throw new ForbiddenError('Your role does not permit this action.');
  }
}

/** Convenience for execution endpoints: OPERATOR or OWNER required. */
export function requireExecutionRole(
  principal: AuthenticatedPrincipal,
  merchantId: string | null
): void {
  requireRole(principal, merchantId, EXECUTION_ROLES);
}

/** Throws 401 unless authenticated; returns the principal for convenience. */
export function requireAuthenticated(
  principal: AuthenticatedPrincipal | null
): AuthenticatedPrincipal {
  if (principal === null) {
    throw new UnauthorizedError();
  }
  return principal;
}
