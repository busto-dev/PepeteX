import { createError, defineEventHandler, getRouterParam } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getExportJobStatus } from '../../../utils/exports';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const jobId = getRouterParam(event, 'jobId');
  if (!jobId) throw createError({ statusCode: 400, statusMessage: 'Missing jobId' });

  return getExportJobStatus({ jobId, userId: session.user.id });
});