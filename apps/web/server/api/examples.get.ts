import { defineEventHandler, getQuery } from 'h3';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { listEnabledExamples } from '../utils/examples';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const query = getQuery(event);
  const language = typeof query.language === 'string' ? query.language : undefined;

  return { examples: await listEnabledExamples(language) };
});
