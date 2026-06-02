import { createError, defineEventHandler, getRouterParam, readFormData } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertDeckId,
  uploadDeckReferenceFile
} from '../../../utils/reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const formData = await readFormData(event);
  const fileEntry = formData?.get('file');

  if (!(fileEntry instanceof File)) {
    throw createUploadFormError();
  }

  const referenceFile = await uploadDeckReferenceFile(
    assertDeckId(getRouterParam(event, 'deckId')),
    session.user.id,
    fileEntry
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    referenceFile
  };
});

function createUploadFormError() {
  return createError({
    statusCode: 400,
    statusMessage: 'Multipart form data must include a file field.'
  });
}
