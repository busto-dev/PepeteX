import { defineEventHandler, readBody } from 'h3';

import {
  assertUpdateProviderDefinitionInput,
  assertUpsertProviderCredentialInput,
  updateProviderDefinition,
  createProviderCredential,
  updateProviderCredential,
  updateProviderCredentialManualModels
} from '../../../utils/providers';
import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const body = await readBody(event);

  const provider = await updateProviderDefinition(
    assertUpdateProviderDefinitionInput(event.context.params?.providerId, body)
  );

  // If the form included a credential payload, upsert the system credential or update manual model metadata.
  const rawCred = body?.credentialPayload;
  if (rawCred && typeof rawCred === 'object') {
    const existingSystemCred = provider.systemCredentials?.[0];

    if (rawCred.apiKey) {
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

      if (existingSystemCred) {
        await updateProviderCredential(existingSystemCred.id, session.user.id, true, credInput);
      } else {
        await createProviderCredential(session.user.id, true, credInput);
      }
    } else if (existingSystemCred && Array.isArray(rawCred.manualModels)) {
      await updateProviderCredentialManualModels(
        existingSystemCred.id,
        session.user.id,
        true,
        rawCred.manualModels
      );
    }
  }

  return {
    ok: true,
    provider
  };
});
