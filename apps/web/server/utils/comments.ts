import { createError } from 'h3';

import { prisma, type CommentStatus } from '@pepetex/db';
import { canComment, canEditDeck, type WorkspaceRole } from '@pepetex/rbac';

import { getWorkspaceForUser } from './workspaces';

export interface CommentInput {
  slideId?: string | null;
  elementIds?: string[];
  text: string;
}

export interface CommentUpdateInput {
  text?: string;
  slideId?: string | null;
  elementIds?: string[];
}

export interface ListDeckCommentsOptions {
  statuses?: CommentStatus[];
  slideId?: string | null;
}

export interface CommentSummary {
  id: string;
  deckId: string;
  slideId: string | null;
  elementIds: string[];
  text: string;
  status: CommentStatus;
  isOwn: boolean;
  author: { id: string; email: string; name: string | null };
  createdAt: string;
  updatedAt: string;
}

async function getDeckAccessRole(
  deckId: string,
  userId: string
): Promise<{ deckId: string; workspaceId: string; role: WorkspaceRole }> {
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    select: { id: true, workspaceId: true }
  });

  if (!deck) {
    throw createError({ statusCode: 404, statusMessage: 'Deck not found.' });
  }

  const workspace = await getWorkspaceForUser(deck.workspaceId, userId);

  return { deckId, workspaceId: deck.workspaceId, role: workspace.currentUserRole as WorkspaceRole };
}

function formatComment(
  comment: {
    id: string;
    deckId: string;
    slideId: string | null;
    elementIds: string[];
    text: string;
    status: CommentStatus;
    authorId: string;
    createdAt: Date;
    updatedAt: Date;
    author: { id: string; email: string; profile: { name: string } | null };
  },
  currentUserId: string
): CommentSummary {
  return {
    id: comment.id,
    deckId: comment.deckId,
    slideId: comment.slideId,
    elementIds: comment.elementIds,
    text: comment.text,
    status: comment.status,
    isOwn: comment.authorId === currentUserId,
    author: {
      id: comment.author.id,
      email: comment.author.email,
      name: comment.author.profile?.name ?? null
    },
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString()
  };
}

const commentSelect = {
  id: true,
  deckId: true,
  slideId: true,
  elementIds: true,
  text: true,
  status: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
  author: {
    select: {
      id: true,
      email: true,
      profile: { select: { name: true } }
    }
  }
} as const;

export async function listDeckComments(
  deckId: string,
  userId: string,
  options: ListDeckCommentsOptions = {}
): Promise<CommentSummary[]> {
  await getDeckAccessRole(deckId, userId);

  const statusFilter =
    options.statuses && options.statuses.length > 0
      ? { status: { in: options.statuses } }
      : {};
  const slideFilter = options.slideId !== undefined
    ? { slideId: options.slideId }
    : {};

  const comments = await prisma.comment.findMany({
    where: { deckId, ...statusFilter, ...slideFilter },
    select: commentSelect,
    orderBy: { createdAt: 'asc' }
  });

  return comments.map((comment) => formatComment(comment, userId));
}

export async function createComment(
  deckId: string,
  userId: string,
  input: CommentInput
): Promise<CommentSummary> {
  const { role } = await getDeckAccessRole(deckId, userId);

  if (!canComment(role)) {
    throw createError({ statusCode: 403, statusMessage: 'You do not have permission to comment.' });
  }

  const text = input.text.trim();
  if (!text || text.length > 2000) {
    throw createError({ statusCode: 400, statusMessage: 'Comment text must be 1–2000 characters.' });
  }

  const comment = await prisma.comment.create({
    data: {
      deckId,
      slideId: input.slideId ?? null,
      elementIds: input.elementIds ?? [],
      text,
      authorId: userId
    },
    select: commentSelect
  });

  return formatComment(comment, userId);
}

export async function updateComment(
  deckId: string,
  commentId: string,
  userId: string,
  input: CommentUpdateInput
): Promise<CommentSummary> {
  const { role } = await getDeckAccessRole(deckId, userId);

  const existing = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, deckId: true, authorId: true, status: true }
  });

  if (!existing || existing.deckId !== deckId) {
    throw createError({ statusCode: 404, statusMessage: 'Comment not found.' });
  }

  if (existing.status !== 'OPEN') {
    throw createError({ statusCode: 409, statusMessage: 'Only OPEN comments can be edited.' });
  }

  const isAuthor = existing.authorId === userId;
  const canEdit = isAuthor || canEditDeck(role);

  if (!canEdit) {
    throw createError({ statusCode: 403, statusMessage: 'You do not have permission to edit this comment.' });
  }

  const updates: Record<string, unknown> = {};
  if (input.text !== undefined) {
    const text = input.text.trim();
    if (!text || text.length > 2000) {
      throw createError({ statusCode: 400, statusMessage: 'Comment text must be 1–2000 characters.' });
    }
    updates.text = text;
  }
  if ('slideId' in input) updates.slideId = input.slideId ?? null;
  if (input.elementIds !== undefined) updates.elementIds = input.elementIds;

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: updates,
    select: commentSelect
  });

  return formatComment(updated, userId);
}

export async function deleteComment(
  deckId: string,
  commentId: string,
  userId: string
): Promise<void> {
  const { role } = await getDeckAccessRole(deckId, userId);

  const existing = await prisma.comment.findUnique({
    where: { id: commentId },
    select: { id: true, deckId: true, authorId: true, status: true }
  });

  if (!existing || existing.deckId !== deckId) {
    throw createError({ statusCode: 404, statusMessage: 'Comment not found.' });
  }

  if (existing.status !== 'OPEN') {
    throw createError({ statusCode: 409, statusMessage: 'Only OPEN comments can be deleted.' });
  }

  const isAuthor = existing.authorId === userId;
  const canDelete = isAuthor || canEditDeck(role);

  if (!canDelete) {
    throw createError({ statusCode: 403, statusMessage: 'You do not have permission to delete this comment.' });
  }

  await prisma.comment.delete({ where: { id: commentId } });
}

export async function submitComments(
  deckId: string,
  userId: string
): Promise<{ submittedCount: number; comments: CommentSummary[] }> {
  const { role } = await getDeckAccessRole(deckId, userId);

  if (!canEditDeck(role)) {
    throw createError({ statusCode: 403, statusMessage: 'You need editor or higher role to submit comments.' });
  }

  const submittedComments = await prisma.$transaction(async (tx) => {
    const openComments = await tx.comment.findMany({
      where: { deckId, status: 'OPEN' },
      select: { id: true },
      orderBy: { createdAt: 'asc' }
    });

    if (openComments.length === 0) return [];

    const ids = openComments.map((comment) => comment.id);
    await tx.comment.updateMany({
      where: { id: { in: ids }, deckId, status: 'OPEN' },
      data: { status: 'SUBMITTED' }
    });

    return tx.comment.findMany({
      where: { id: { in: ids } },
      select: commentSelect,
      orderBy: { createdAt: 'asc' }
    });
  });

  return {
    submittedCount: submittedComments.length,
    comments: submittedComments.map((comment) => formatComment(comment, userId))
  };
}
