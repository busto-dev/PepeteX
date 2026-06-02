import { defineEventHandler, readBody } from 'h3';

import {
  assertCreateProviderDefinitionInput,
  assertUpsertProviderCredentialInput,
  createProviderDefinition,
  createProviderCredential
} from '../../utils/providers';
import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const body = await readBody(event);

  const provider = await createProviderDefinition(
    assertCreateProviderDefinitionInput(body)
  );

  // If the form included a credential payload (apiKey), save it as a system credential.
  const rawCred = body?.credentialPayload;
  if (rawCred && typeof rawCred === 'object' && rawCred.apiKey) {
    const credInput = assertUpsertProviderCredentialInput(
      {
        providerDefinitionId: provider.id,
        label: 'Default',
        apiKey: rawCred.apiKey,
        organizationId: rawCred.orgId ?? rawCred.organizationId,
        projectId: rawCred.projectId,
        customHeaders: rawCred.customHeaders,
        manualModels: rawCred.manualModels,
        scope: 'system',
      },
      'create'
    );
    await createProviderCredential(session.user.id, true, credInput);
  }

  event.node.res.statusCode = 201;

  return {
    ok: true,
    provider
  };
});
