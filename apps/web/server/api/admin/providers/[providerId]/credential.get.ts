import { createError, defineEventHandler } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireGlobalAdminSession } from '../../../../utils/authorization';
import { revealProviderCredential } from '../../../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const providerId = event.context.params?.providerId?.trim();
  if (!providerId) {
    throw createError({ statusCode: 400, statusMessage: 'Provider ID is required.' });
  }

  // Find the system credential for this provider definition
  const systemCredential = await prisma.providerCredential.findFirst({
    where: { providerDefinitionId: providerId, scope: 'SYSTEM' },
    select: { id: true },
  });

  if (!systemCredential) {
    throw createError({ statusCode: 404, statusMessage: 'No system credential found for this provider.' });
  }

  const revealed = await revealProviderCredential(systemCredential.id, session.user.id);

  return { credential: revealed };
});
