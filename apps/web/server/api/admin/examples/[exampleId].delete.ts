import { defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';
import { deleteExample } from '../../../utils/examples';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const exampleId = getRouterParam(event, 'exampleId')?.trim() ?? '';
  await deleteExample(exampleId);

  return { success: true };
});
