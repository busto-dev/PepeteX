import { createError, defineEventHandler, readBody } from 'h3';

import { hashPassword, verifyPassword } from '@pepetex/auth';
import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';

interface ChangePasswordInput {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const body = await readBody<ChangePasswordInput>(event);
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword || !newPassword) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Current password and new password are required.'
    });
  }

  if (newPassword.length < 8) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Password must be at least 8 characters.'
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true }
  });

  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'User not found.' });
  }

  const passwordMatches = await verifyPassword(currentPassword, user.passwordHash);
  if (!passwordMatches) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Current password is incorrect.'
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) }
  });

  return { success: true };
});
