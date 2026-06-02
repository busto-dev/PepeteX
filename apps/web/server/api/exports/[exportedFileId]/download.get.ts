import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { getExportDownloadFile } from '../../../utils/exports';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const exportedFileId = getRouterParam(event, 'exportedFileId');
  if (!exportedFileId) throw createError({ statusCode: 400, message: 'Missing exportedFileId' });

  const file = await getExportDownloadFile({
    exportedFileId,
    userId: session.user.id
  });

  setResponseHeader(event, 'Content-Type', file.contentType);
  setResponseHeader(event, 'Content-Length', file.sizeBytes);
  setResponseHeader(event, 'Content-Disposition', createAttachmentDisposition(file.fileName));
  setResponseHeader(event, 'Cache-Control', 'private, no-store');

  return Buffer.from(file.body);
});

function createAttachmentDisposition(fileName: string): string {
  const asciiFilename = fileName
    .replace(/[\r\n"]/g, '_')
    .replace(/[^\x20-\x7E]/g, '_')
    .trim() || 'presentation.pptx';

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
