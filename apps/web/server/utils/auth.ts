import {
  createError,
  deleteCookie,
  getCookie,
  H3Event,
  setCookie
} from 'h3';

import {
  createSessionExpiry,
  createSessionToken,
  hashSessionToken,
  SESSION_COOKIE_NAME,
  verifyPassword
} from '@pepetex/auth';
import type { AuthenticatedUser } from '@pepetex/auth';
import { prisma } from '@pepetex/db';

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthSessionResult {
  sessionId: string;
  user: AuthenticatedUser;
}

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function assertLoginInput(input: unknown): LoginInput {
  const candidate = input as Partial<LoginInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.password !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Email and password are required.'
    });
  }

  return {
    email: candidate.email.trim().toLowerCase(),
    password: candidate.password
  };
}

export async function loginWithPassword(
  event: H3Event,
  input: LoginInput
): Promise<AuthSessionResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { profile: true }
  });

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid email or password.'
    });
  }

  const sessionToken = createSessionToken();
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt: createSessionExpiry()
    }
  });

  setSessionCookie(event, sessionToken, session.expiresAt);

  return {
    sessionId: session.id,
    user: toAuthenticatedUser(user)
  };
}

export async function getAuthenticatedSession(event: H3Event): Promise<AuthSessionResult | null> {
  const token = getCookie(event, SESSION_COOKIE_NAME);

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        include: { profile: true }
      }
    }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    clearSessionCookie(event);
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() }
  });

  return {
    sessionId: session.id,
    user: toAuthenticatedUser(session.user)
  };
}

export async function logoutCurrentSession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE_NAME);

  clearSessionCookie(event);

  if (!token) {
    return;
  }

  await prisma.session.updateMany({
    where: {
      tokenHash: hashSessionToken(token),
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
}

function setSessionCookie(event: H3Event, token: string, expiresAt: Date): void {
  setCookie(event, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS
  });
}

function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production'
  });
}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  globalRole: 'USER' | 'GLOBAL_ADMIN';
  profile: {
    name: string;
    avatarUrl: string | null;
    uiLanguage: string;
    themePreference: string;
    defaultWorkspaceId: string | null;
  } | null;
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    globalRole: user.globalRole,
    profile: user.profile
      ? {
          name: user.profile.name,
          avatarUrl: user.profile.avatarUrl,
          uiLanguage: user.profile.uiLanguage,
          themePreference: user.profile.themePreference,
          defaultWorkspaceId: user.profile.defaultWorkspaceId
        }
      : null
  };
}
