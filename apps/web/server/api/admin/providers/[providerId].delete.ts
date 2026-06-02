import { defineEventHandler, createError } from 'h3';

import { prisma } from '@pepetex/db';
import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const providerId = event.context.params?.providerId?.trim();
  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: 'Provider ID is required.' });
  }

  const existing = await prisma.providerDefinition.findUnique({ where: { id: providerId } });
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Provider not found.' });
  }

  // Delete credentials first (cascade may not be set), then the definition
  await prisma.providerCredential.deleteMany({ where: { providerDefinitionId: providerId } });
  await prisma.providerDefinition.delete({ where: { id: providerId } });

  return { ok: true };
});
