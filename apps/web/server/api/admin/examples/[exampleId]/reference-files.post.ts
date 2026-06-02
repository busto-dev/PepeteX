import { createError, defineEventHandler, getRouterParam, readFormData } from 'h3';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireGlobalAdminSession } from '../../../../utils/authorization';
import { uploadPromptExampleReferenceFile } from '../../../../utils/examples';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireGlobalAdminSession(session);

  const exampleId = getRouterParam(event, 'exampleId')?.trim() ?? '';
  if (!exampleId) {
    throw createError({ statusCode: 400, statusMessage: 'Example id is required.' });
  }

  const formData = await readFormData(event);
  const fileEntry = formData?.get('file');
  if (!(fileEntry instanceof File)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Multipart form data must include a file field.'
    });
  }

  const purposeRaw = formData?.get('purpose');
  const purpose = purposeRaw === 'ASSET' ? 'ASSET' : 'REFERENCE';

  const referenceFile = await uploadPromptExampleReferenceFile(exampleId, purpose, fileEntry);

  event.node.res.statusCode = 201;
  return { ok: true, referenceFile };
});
