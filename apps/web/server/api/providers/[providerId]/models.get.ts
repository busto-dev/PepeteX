import { defineEventHandler, getQuery } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { listProviderModels } from '../../../utils/providers';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const query = getQuery(event);
  const credentialId =
    typeof query.credentialId === 'string' && query.credentialId.trim()
      ? query.credentialId.trim()
      : undefined;
  const workspaceId =
    typeof query.workspaceId === 'string' && query.workspaceId.trim()
      ? query.workspaceId.trim()
      : undefined;
  const manualModelIds = normalizeManualModelIds(query.manualModelNames);

  return {
    ok: true,
    result: await listProviderModels(
      event.context.params?.providerId,
      session.user.id,
      session.user.globalRole === 'GLOBAL_ADMIN',
      {
        ...(workspaceId ? { workspaceId } : {}),
        ...(credentialId ? { credentialId } : {}),
        ...(manualModelIds.length > 0 ? { manualModelIds } : {})
      }
    )
  };
});

function normalizeManualModelIds(value: unknown): string[] {
  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
