import { createError, defineEventHandler, getRouterParam, readBody } from 'h3';

import type { TweakScope } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../utils/auth';
import { requireAuthenticatedSession } from '../../../utils/authorization';
import { upsertTweakItem } from '../../../utils/tweaks';

const validScopes: TweakScope[] = ['DECK', 'SLIDE', 'ELEMENT'];

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';
  const body = await readBody(event);

  const scope = body?.scope;
  if (!validScopes.includes(scope)) {
    throw createError({ statusCode: 400, statusMessage: 'scope must be DECK, SLIDE, or ELEMENT.' });
  }

  if (typeof body?.category !== 'string' || !body.category) {
    throw createError({ statusCode: 400, statusMessage: 'category is required.' });
  }

  if (body?.value === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'value is required.' });
  }

  const batch = await upsertTweakItem(deckId, session.user.id, {
    scope,
    slideId: typeof body.slideId === 'string' ? body.slideId : null,
    elementId: typeof body.elementId === 'string' ? body.elementId : null,
    category: body.category,
    value: body.value
  });

  return { batch };
});
