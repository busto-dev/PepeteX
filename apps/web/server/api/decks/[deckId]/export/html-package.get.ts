import { createError, defineEventHandler, getRouterParam, setResponseHeader } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../../../../utils/auth';
import { requireAuthenticatedSession } from '../../../../utils/authorization';
import { getWorkspaceForUser } from '../../../../utils/workspaces';

interface StoredSlide {
  id: string;
  title: string;
  html: string;
  css: string;
}

interface DeckContentJson {
  title?: string;
  slides?: StoredSlide[];
}

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);
  const deckId = getRouterParam(event, 'deckId') ?? '';

  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { id: true, title: true, workspaceId: true, contentJson: true }
  });

  if (!deck) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });
  }

  await getWorkspaceForUser(deck.workspaceId, session.user.id);

  const content = deck.contentJson as DeckContentJson | null;
  const slides = content?.slides ?? [];
  const deckTitle = deck.title;
  const safeFilename = deckTitle.replace(/[^a-zA-Z0-9\-_\s]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'deck';

  const slideBlocks = slides.map((slide, index) => {
    const safeId = String(slide.id ?? `slide_${index}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const title = String(slide.title ?? `Slide ${index + 1}`);
    const html = String(slide.html ?? '');
    const css = String(slide.css ?? '');

    return [
      `  <!-- Slide ${index + 1}: ${escapeHtmlAttr(title)} -->`,
      `  <section data-slide-index="${index}" data-slide-id="${escapeHtmlAttr(safeId)}" style="page-break-after:always;position:relative;width:1920px;height:1080px;overflow:hidden;">`,
      `    <style>${css}</style>`,
      `    ${html}`,
      `  </section>`
    ].join('\n');
  });

  const htmlDocument = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(deckTitle)}</title>`,
    '  <style>',
    '    *, *::before, *::after { box-sizing: border-box; }',
    '    html, body { margin: 0; padding: 0; background: #f1f5f9; font-family: system-ui, sans-serif; }',
    '    .pepetex-slide { display: block; }',
    '    .slide-wrapper { margin: 32px auto; box-shadow: 0 8px 32px rgba(0,0,0,0.12); }',
    '  </style>',
    '</head>',
    '<body>',
    ...slideBlocks,
    '</body>',
    '</html>'
  ].join('\n');

  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${safeFilename}.html"`);

  return htmlDocument;
});

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;');
}
