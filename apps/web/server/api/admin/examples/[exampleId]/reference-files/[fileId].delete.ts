import { createError, defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../../../utils/auth';
import { requireGlobalAdminSession } from '../../../../../utils/authorization';
import { deletePromptExampleReferenceFile } from '../../../../../utils/examples';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const exampleId = getRouterParam(event, 'exampleId')?.trim() ?? '';
  const fileId = getRouterParam(event, 'fileId')?.trim() ?? '';

  if (!exampleId || !fileId) {
    throw createError({ statusCode: 400, statusMessage: 'Example id and file id are required.' });
  }

  await deletePromptExampleReferenceFile(exampleId, fileId);
  return { success: true };
});
