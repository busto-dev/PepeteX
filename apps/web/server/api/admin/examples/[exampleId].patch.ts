import { defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireGlobalAdminSession } from '../../../utils/authorization';
import { updateExample } from '../../../utils/examples';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const exampleId = getRouterParam(event, 'exampleId')?.trim() ?? '';
  const body = (await readBody(event)) as Record<string, unknown>;

  const example = await updateExample(exampleId, {
    title: typeof body?.title === 'string' ? body.title : undefined,
    category: typeof body?.category === 'string' ? body.category : undefined,
    promptEn: typeof body?.promptEn === 'string' ? body.promptEn : undefined,
    promptId: typeof body?.promptId === 'string' ? body.promptId : undefined,
    isEnabled: typeof body?.isEnabled === 'boolean' ? body.isEnabled : undefined,
    sortOrder: typeof body?.sortOrder === 'number' ? body.sortOrder : undefined,
    designSystemId:
      'designSystemId' in (body ?? {}) ? (body.designSystemId as string | null) : undefined,
    customPromptId:
      'customPromptId' in (body ?? {}) ? (body.customPromptId as string | null) : undefined,
    textProviderKind:
      'textProviderKind' in (body ?? {}) ? (body.textProviderKind as string | null) : undefined,
    textModelId:
      'textModelId' in (body ?? {}) ? (body.textModelId as string | null) : undefined,
    imageEnabled: typeof body?.imageEnabled === 'boolean' ? body.imageEnabled : undefined,
    imageProviderKind:
      'imageProviderKind' in (body ?? {}) ? (body.imageProviderKind as string | null) : undefined,
    imageModelId:
      'imageModelId' in (body ?? {}) ? (body.imageModelId as string | null) : undefined
  });

  return example;
});
