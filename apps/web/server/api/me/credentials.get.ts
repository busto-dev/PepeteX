import { defineEventHandler } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const credentials = await prisma.providerCredential.findMany({
    where: {
      scope: 'USER',
      ownerUserId: session.user.id
    },
    select: {
      id: true,
      label: true,
      apiKeyPreview: true,
      createdAt: true,
      updatedAt: true,
      providerDefinition: {
        select: {
          id: true,
          name: true,
          kind: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  return {
    credentials: credentials.map((credential) => ({
      id: credential.id,
      providerDefinitionId: credential.providerDefinition.id,
      providerName: credential.providerDefinition.name,
      providerKind: credential.providerDefinition.kind.toLowerCase().replaceAll('_', '-'),
      label: credential.label,
      apiKeyPreview: credential.apiKeyPreview,
      createdAt: credential.createdAt.toISOString(),
      updatedAt: credential.updatedAt.toISOString()
    }))
  };
});
