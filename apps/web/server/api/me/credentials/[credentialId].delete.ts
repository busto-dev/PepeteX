import { createError, defineEventHandler, getRouterParam } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const credentialId = getRouterParam(event, 'credentialId');
  if (!credentialId) {
    throw createError({ statusCode: 400, statusMessage: 'Credential id is required.' });
  }

  const credential = await prisma.providerCredential.findUnique({
    where: { id: credentialId },
    select: {
      ownerUserId: true,
      scope: true
    }
  });

  if (!credential) {
    throw createError({ statusCode: 404, statusMessage: 'Credential not found.' });
  }

  if (credential.scope !== 'USER' || credential.ownerUserId !== session.user.id) {
    throw createError({ statusCode: 403, statusMessage: 'You can delete only your own credentials.' });
  }

  await prisma.providerCredential.delete({ where: { id: credentialId } });

  return { success: true };
});
