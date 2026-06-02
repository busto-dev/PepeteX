import { defineEventHandler, readBody } from 'h3';

import { getAuthenticatedSession } from '../../utils/auth';
import { requireGlobalAdminSession } from '../../utils/authorization';
import { createExample } from '../../utils/examples';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const body = (await readBody(event)) as Record<string, unknown>;

  const example = await createExample({
    title: String(body?.title ?? ''),
    category: String(body?.category ?? ''),
    promptEn: String(body?.promptEn ?? ''),
    promptId: String(body?.promptId ?? ''),
    isEnabled: typeof body?.isEnabled === 'boolean' ? body.isEnabled : true,
    sortOrder: typeof body?.sortOrder === 'number' ? body.sortOrder : 0,
    designSystemId: typeof body?.designSystemId === 'string' ? body.designSystemId : null,
    customPromptId: typeof body?.customPromptId === 'string' ? body.customPromptId : null,
    textProviderKind: typeof body?.textProviderKind === 'string' ? body.textProviderKind : null,
    textModelId: typeof body?.textModelId === 'string' ? body.textModelId : null,
    imageEnabled: typeof body?.imageEnabled === 'boolean' ? body.imageEnabled : false,
    imageProviderKind: typeof body?.imageProviderKind === 'string' ? body.imageProviderKind : null,
    imageModelId: typeof body?.imageModelId === 'string' ? body.imageModelId : null
  });

  return example;
});
