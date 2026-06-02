import { createError } from 'h3';

import {
  createPasswordResetExpiry,
  createPasswordResetToken,
  hashPassword,
  hashPasswordResetToken
} from '@pepetex/auth';
import { prisma } from '@pepetex/db';

export interface PasswordResetRequestInput {
  email: string;
}

export interface PasswordResetConfirmationInput {
  token: string;
  password: string;
}

export function assertPasswordResetRequestInput(input: unknown): PasswordResetRequestInput {
  const candidate = input as Partial<PasswordResetRequestInput> | null;

  if (!candidate || typeof candidate !== 'object' || typeof candidate.email !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Email is required.'
    });
  }

  const email = candidate.email.trim().toLowerCase();

  if (!email || !email.includes('@')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A valid email address is required.'
    });
  }

  return { email };
}

export function assertPasswordResetConfirmationInput(
  input: unknown
): PasswordResetConfirmationInput {
  const candidate = input as Partial<PasswordResetConfirmationInput> | null;

  if (
    !candidate ||
    typeof candidate !== 'object' ||
    typeof candidate.token !== 'string' ||
    typeof candidate.password !== 'string'
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Token and password are required.'
    });
  }

  const token = candidate.token.trim();

  if (!token) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Password reset token is required.'
    });
  }

  return {
    token,
    password: candidate.password
  };
}

export async function requestPasswordReset(input: PasswordResetRequestInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true }
  });

  if (!user) {
    return;
  }

  const token = createPasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const expiresAt = createPasswordResetExpiry();

  await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.deleteMany({
      where: {
        userId: user.id,
        consumedAt: null
      }
    });

    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });
  });
}

export async function confirmPasswordReset(
  input: PasswordResetConfirmationInput
): Promise<void> {
  const now = new Date();
  const tokenHash = hashPasswordResetToken(input.token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      expiresAt: true,
      consumedAt: true
    }
  });

  if (!resetToken || resetToken.consumedAt || resetToken.expiresAt <= now) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Password reset token is invalid or has expired.'
    });
  }

  let passwordHash: string;

  try {
    passwordHash = await hashPassword(input.password);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage:
        error instanceof Error ? error.message : 'Password does not meet requirements.'
    });
  }

  await prisma.$transaction(async (tx) => {
    const consumeResult = await tx.passwordResetToken.updateMany({
      where: {
        id: resetToken.id,
        consumedAt: null,
        expiresAt: {
          gt: now
        }
      },
      data: {
        consumedAt: now
      }
    });

    if (consumeResult.count !== 1) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Password reset token is invalid or has expired.'
      });
    }

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash }
    });

    await tx.session.updateMany({
      where: {
        userId: resetToken.userId,
        revokedAt: null
      },
      data: {
        revokedAt: now
      }
    });

    await tx.passwordResetToken.deleteMany({
      where: {
        userId: resetToken.userId,
        id: {
          not: resetToken.id
        }
      }
    });
  });
}
