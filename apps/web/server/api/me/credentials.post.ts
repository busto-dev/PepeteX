import { createError, defineEventHandler, readBody } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireAuthenticatedSession } from '../../utils/authorization';
import {
  assertUpsertProviderCredentialInput,
  createProviderCredential
} from '../../utils/providers';

type CreateCredentialBody = Record<string, unknown>;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const body = await readBody<CreateCredentialBody>(event);
  const providerReference = text(body.provider);
  let providerDefinitionId = text(body.providerDefinitionId) ?? text(body.definitionId);

  if (!providerDefinitionId && providerReference) {
    const provider = await prisma.providerDefinition.findFirst({
      where: {
        OR: [
          { id: providerReference },
          { name: providerReference }
        ]
      },
      select: { id: true }
    });
    providerDefinitionId = provider?.id;
  }

  if (!providerDefinitionId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Provider is required.'
    });
  }

  const credential = await createProviderCredential(
    session.user.id,
    session.user.globalRole === 'GLOBAL_ADMIN',
    assertUpsertProviderCredentialInput({
      providerDefinitionId,
      label: text(body.label) ?? text(body.name),
      apiKey: text(body.apiKey) ?? text(body.key),
      scope: 'user'
    }, 'create')
  );

  return {
    success: true,
    credential
  };
});
