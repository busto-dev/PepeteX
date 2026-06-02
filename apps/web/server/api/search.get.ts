import { defineEventHandler, getQuery } from 'h3';

import { prisma } from '@pepetex/db';

import { getAuthenticatedSession } from '../utils/auth';
import { requireAuthenticatedSession } from '../utils/authorization';
import { listUserWorkspaces } from '../utils/workspaces';

interface SearchResult {
  id: string;
  kind: 'deck' | 'prompt' | 'design-system';
  title: string;
  subtitle?: string;
  url: string;
  workspaceName?: string;
}

export default defineEventHandler(async (event) => {
  const session = await getAuthenticatedSession(event);
  requireAuthenticatedSession(session);

  const q = String(getQuery(event).q ?? '').trim();
  if (q.length < 2) {
    return { results: [] };
  }

  const workspaces = await listUserWorkspaces(session.user.id);
  const workspaceIds = workspaces.map((workspace) => workspace.id);
  const workspaceNameById = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  const textFilter = { contains: q, mode: 'insensitive' as const };

  const [decks, prompts, designSystems] = await Promise.all([
    prisma.deck.findMany({
      where: {
        workspaceId: { in: workspaceIds },
        title: textFilter
      },
      select: {
        id: true,
        title: true,
        workspaceId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 12
    }),
    prisma.customPrompt.findMany({
      where: {
        OR: [
          { ownerUserId: session.user.id },
          { workspaceId: { in: workspaceIds } },
          { scope: 'GLOBAL' }
        ],
        AND: [
          {
            OR: [
              { title: textFilter },
              { description: textFilter },
              { category: textFilter }
            ]
          }
        ]
      },
      select: {
        id: true,
        title: true,
        description: true,
        workspaceId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 8
    }),
    prisma.designSystem.findMany({
      where: {
        isEnabled: true,
        OR: [
          { ownerUserId: session.user.id },
          { workspaceId: { in: workspaceIds } },
          { scope: 'GLOBAL' }
        ],
        AND: [
          {
            OR: [
              { name: textFilter },
              { description: textFilter }
            ]
          }
        ]
      },
      select: {
        id: true,
        name: true,
        description: true,
        workspaceId: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' },
      take: 8
    })
  ]);

  const results: SearchResult[] = [
    ...decks.map((deck) => ({
      id: deck.id,
      kind: 'deck' as const,
      title: deck.title,
      subtitle: 'Deck',
      url: `/?deckId=${deck.id}`,
      workspaceName: workspaceNameById.get(deck.workspaceId)
    })),
    ...prompts.map((prompt) => ({
      id: prompt.id,
      kind: 'prompt' as const,
      title: prompt.title,
      subtitle: prompt.description ?? 'Prompt',
      url: '/prompts',
      workspaceName: prompt.workspaceId ? workspaceNameById.get(prompt.workspaceId) : undefined
    })),
    ...designSystems.map((designSystem) => ({
      id: designSystem.id,
      kind: 'design-system' as const,
      title: designSystem.name,
      subtitle: designSystem.description ?? 'Design system',
      url: `/design-systems/${designSystem.id}`,
      workspaceName: designSystem.workspaceId ? workspaceNameById.get(designSystem.workspaceId) : undefined
    }))
  ].slice(0, 24);

  return { results };
});
