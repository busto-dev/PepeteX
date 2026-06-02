import { createError } from 'h3';

import { canManageUsers } from '@pepetex/rbac';

import type { AuthSessionResult } from './auth';

export function requireAuthenticatedSession(
  session: AuthSessionResult | null
): asserts session is AuthSessionResult {
  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Authentication required.'
    });
  }
}

export function requireGlobalAdminSession(
  session: AuthSessionResult | null
): asserts session is AuthSessionResult {
  requireAuthenticatedSession(session);

  if (!canManageUsers(session.user.globalRole)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Global admin access is required.'
    });
  }
}
