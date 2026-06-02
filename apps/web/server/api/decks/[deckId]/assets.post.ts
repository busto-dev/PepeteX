import { createError, defineEventHandler, getRouterParam, readFormData } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import {
  assertDeckId,
  uploadDeckAsset
} from '../../../utils/reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const formData = await readFormData(event);
  const fileEntry = formData?.get('file');

  if (!(fileEntry instanceof File)) {
    throw createUploadFormError();
  }

  const assetRole =
    typeof formData.get('assetRole') === 'string'
      ? formData.get('assetRole') as string
      : 'other';

  const asset = await uploadDeckAsset(
    assertDeckId(getRouterParam(event, 'deckId')),
    session.user.id,
    assetRole,
    fileEntry
  );

  event.node.res.statusCode = 201;

  return {
    ok: true,
    asset
  };
});

function createUploadFormError() {
  return createError({
    statusCode: 400,
    statusMessage: 'Multipart form data must include a file field.'
  });
}
