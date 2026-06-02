import { createError, defineEventHandler, getRouterParam, readFormData } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { assertDesignSystemId } from '../../../utils/design-systems';
import {
  designSystemAssetRoles,
  uploadDesignSystemAsset
} from '../../../utils/design-system-reference-files';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  const formData = await readFormData(event);
  const fileEntry = formData?.get('file');

  if (!(fileEntry instanceof File)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Multipart form data must include a file field.'
    });
  }

  const roleRaw = formData.get('assetRole');
  const assetRole =
    typeof roleRaw === 'string' && designSystemAssetRoles.includes(roleRaw as 'logo' | 'image' | 'font' | 'other')
      ? (roleRaw as 'logo' | 'image' | 'font' | 'other')
      : 'other';

  const asset = await uploadDesignSystemAsset(
    designSystemId,
    session.user.id,
    assetRole,
    fileEntry
  );

  event.node.res.statusCode = 201;

  return { ok: true, asset };
});
