import { prisma } from '@pepetex/db';
import { buildPptxExportDocument } from '@pepetex/export';

// Internal export render route — used exclusively by the Playwright export worker.
// Validates a one-time export job token, loads the deck revision, and returns a
// complete HTML document for dom-to-pptx to render and export.
export default defineEventHandler(async (event) => {
  const jobToken = getRouterParam(event, 'jobToken');
  if (!jobToken) {
    throw createError({ statusCode: 400, message: 'Missing job token' });
  }

  const now = new Date();

  const tokenRecord = await prisma.exportJobToken.findUnique({
    where: { token: jobToken }
  });

  if (!tokenRecord) {
    throw createError({ statusCode: 404, message: 'Export token not found' });
  }
  if (tokenRecord.expiresAt < now) {
    throw createError({ statusCode: 410, message: 'Export token expired' });
  }
  if (tokenRecord.usedAt) {
    throw createError({ statusCode: 410, message: 'Export token already used' });
  }

  // Load deck revision
  const revision = await prisma.deckRevision.findFirst({
    where: { id: tokenRecord.revisionId, deckId: tokenRecord.deckId }
  });

  if (!revision) {
    throw createError({ statusCode: 404, message: 'Deck revision not found' });
  }

  const deck = revision.deckJson as {
    title?: string;
    slides?: Array<{ id: string; title: string; html: string; css: string }>;
    fonts?: Array<{ id?: string; fontFamily: string; fontAliases?: string[]; mimeType: string; dataUrl: string; fontWeight?: number | string | null; fontStyle?: string | null }>;
  } | null;

  const slides = deck?.slides ?? [];

  const doc = buildPptxExportDocument({
    slides: slides.map((s) => ({
      id: s.id,
      title: s.title,
      html: s.html,
      css: s.css
    })),
    fileName: `${deck?.title ?? 'presentation'}.pptx`,
    domToPptxScriptUrl: '/_pepetex/dom-to-pptx.bundle.js',
    ...(deck?.fonts ? { fontFaces: deck.fonts } : {})
  });

  setResponseHeader(event, 'Content-Type', doc.contentType);
  setResponseHeader(event, 'Content-Security-Policy', doc.csp);
  // No caching — one-time render page
  setResponseHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate');
  setResponseHeader(event, 'X-Robots-Tag', 'noindex');

  return doc.html;
});
