import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { assertDesignSystemId, getDesignSystemForUser } from '../../../utils/design-systems';

const MAX_FETCH_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain', 'application/xhtml+xml'];

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const designSystemId = assertDesignSystemId(getRouterParam(event, 'designSystemId'));
  await getDesignSystemForUser(designSystemId, session.user.id);

  const body = await readBody(event);
  const url = body?.url;

  if (typeof url !== 'string' || !url.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'url is required.' });
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'url must be a valid URL.' });
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw createError({ statusCode: 400, statusMessage: 'url must use http or https.' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let fetchedText = '';
  let contentType = '';
  let fetchError: string | null = null;
  let truncated = false;

  try {
    const response = await fetch(parsedUrl.toString(), {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PepeteX-DesignSystemBot/1.0',
        Accept: 'text/html,text/plain,application/xhtml+xml'
      },
      redirect: 'follow'
    });

    clearTimeout(timeout);
    contentType = response.headers.get('content-type') ?? '';
    const isTextLike = ALLOWED_CONTENT_TYPES.some((ct) => contentType.startsWith(ct));

    if (!isTextLike) {
      fetchError = `URL returned unsupported content type: ${contentType}`;
    } else {
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      if (bytes.byteLength > MAX_FETCH_BYTES) {
        fetchedText = new TextDecoder().decode(bytes.slice(0, MAX_FETCH_BYTES));
        truncated = true;
        fetchError = 'URL content was truncated to 512 KB.';
      } else {
        fetchedText = new TextDecoder().decode(bytes);
      }
    }
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      fetchError = 'URL fetch timed out after 10 seconds.';
    } else {
      fetchError = error instanceof Error ? error.message : 'URL fetch failed.';
    }
  }

  return {
    ok: fetchError === null || truncated,
    url: parsedUrl.toString(),
    contentType,
    fetchedText,
    fetchError,
    truncated
  };
});
