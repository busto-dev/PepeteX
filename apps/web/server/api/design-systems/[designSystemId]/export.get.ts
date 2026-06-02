import { defineEventHandler, getRouterParam, setHeader } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { assertDesignSystemId, exportDesignSystemForUser } from '../../../utils/design-systems';

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const payload = await exportDesignSystemForUser(
    assertDesignSystemId(getRouterParam(event, 'designSystemId')),
    session.user.id
  );

  const filename = `${slugifyFilename(payload.source.name)}.design-system.json`;

  setHeader(event, 'content-type', 'application/json; charset=utf-8');
  setHeader(event, 'content-disposition', `attachment; filename="${filename}"`);

  return payload;
});

function slugifyFilename(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'design-system';
}
